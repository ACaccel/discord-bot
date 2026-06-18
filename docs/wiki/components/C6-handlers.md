# C6 — Handlers

## Responsibility

Discord interaction entry points. One folder per command / button / modal / select-menu / reaction; the folder name (snake_case) matches the Discord identifier. Each handler is registered via codegen and routed by the plugin runtime.

## Layout

```
src/handlers/
├── commands/<name>/index.ts
├── buttons/<name>/index.ts
├── modals/<name>/index.ts
├── select-menus/<name>/index.ts
├── reactions/<name>/index.ts
└── */registry.generated.ts   # produced by scripts/gen-registry.ts — do not hand-edit
```

## The 150-line rule

`src/handlers/<type>/<name>/index.ts` is capped at 150 lines (ESLint `max-lines`, including imports / JSDoc / blank lines). Pure helpers that exceed the cap are extracted into kebab-case sibling files inside the same handler folder (named exports, no `export default`) and unit-tested in `test/unit/handlers/<name>/`.

Discord I/O, permission checks, Translator calls, and Discord-reply assembly stay inside `index.ts` — these are the handler's core responsibilities and may not be hidden behind helpers to reduce line count. Helpers are private to one handler; if a second handler ever needs the same logic, lifting is evaluated then, not preemptively.

## Public surface

- `requireGuildRepos(bot, interaction): Promise<Repos | null>` — three-step guard (guild present / not disabled / repos resolvable). Disabled state is sourced from `bot.connectionManager?.isDisabled(...)`.
- `replyForError(interaction, bot, error, fallbackKey, guildId?)` and the pure helper `resolveErrorReply(translator, error, fallbackKey, traceId)` — `src/handlers/reply-for-error.ts`. Operator side always gets a structured log (full error + `traceId`); user side gets either the `DomainError.messageKey` rendering or a per-feature fallback (`replies:<feature>.failed`) with the same `traceId`.
- `Command` / `CommandConfig` / `CommandOption` / `CommandChoice` / `LocalizedCommandConfig` / `localizeCommandConfig` — `src/handlers/commands/command.ts` (re-exported through the `@cmd` barrel).
- `buildCommandJsonBody(config)` — `src/handlers/commands/command-builder.ts` (re-exported through `@cmd`). Used by both `src/deploy.ts` (build time) and runtime command registration.
- `buildButtonRows` / `msgReact` / `scheduleJob` / `listInOneImage` / `CanvasContent` / `CanvasOptions` — `src/handlers/commands/discord-helpers.ts`.

## i18n in command metadata

Command and option descriptions never embed CJK literals. `CommandConfig.description` and `CommandOption.description` are catalog keys resolved at build time via `localizeCommandConfig(config, translator)` against the `commands` namespace. Context-menu display names come from `commands:<id>.name`; `config.name` itself stores a stable ASCII id. The `commands.json` `choices` block holds localized choice labels keyed by stable `value`. The CJK scanner enforces zero literals across `src/handlers/`.

## Privacy-aware data commands

A command that surfaces aggregated guild data (message counts, rankings, traffic) must not reveal activity from channels the invoker cannot see. The pattern, realized by `/traffic` (whole-guild) and `/traffic_me` (the invoker's own stats), is a **dual filter**: a channel's data is included only when it clears BOTH the operator-defined rank ceiling AND the Discord-native `ViewChannel` check. Command-agnostic primitives — the `canvas` chart renderers, the `visibility-filter`, and window/bucket helpers — live in a shared, codegen-ignored module `src/handlers/commands/traffic-shared/` (no `index.ts`, so `gen-registry` does not treat it as a command); each command folder keeps only its own options / aggregation / view / index. This is the "lift shared logic when a second handler needs it" outcome (mirrors `discord-helpers.ts`).

- Resolve the policy via `bot.permissionRankPolicy` (C11) — handlers never touch the container / `TOKENS`. Resolve the invoking `GuildMember` via `guild.members.fetch(...)` so `roles.cache` and permission overwrites are populated.
- The rank ceiling tracks the reply audience, and BOTH modes check `ViewChannel` for the invoking member. `public` caps by `policy.visibilityCeiling(guildId, member roles, commandChannelId, commandAncestorIds)` = `min(userRank, channelRank(commandChannel))` — the reply is posted to the room, so it never exceeds the command channel's own (ancestry-aware) rank. `ephemeral` caps by `policy.userRank(guildId, member roles)` alone — only the invoker sees it, so the command channel does not lower it. A low-clearance invoker is always bounded by their own `userRank`, so nothing extra leaks in either mode.
- Build the allowed-channel set by walking `guild.channels.cache`; a channel present only in archived data (deleted / uncached) is never added — fail-safe exclusion. Each channel's effective rank is the max over its **full ancestry** (`ancestorChannelIdsOf` → parent channel → category), so a ranked category gates every channel and thread nested under it. Apply the filter before aggregation so excluded channels contribute nothing. Charts are rendered with `canvas` (see `discord-helpers`), and chart / table text is passed in pre-translated to keep the renderer CJK-free.
- Emoji rendering splits by surface. The chart font (Noto Sans CJK) has no emoji glyphs, so emoji in a channel / user name would draw as tofu boxes; `stripEmoji` (`traffic-shared/chart-common`) removes them from every canvas label and header, falling back to the original when stripping would empty the label. Discord-native **embed text** keeps emoji — `/traffic`'s "top reaction" field renders the actual emoji, building the `<:name:id>` (animated `<a:…>`) token for a custom emoji and using the character itself for a unicode one. Custom-vs-unicode identity is keyed by the persisted emoji `id` in `reactions.ts`.
- Keep user-facing copy neutral: option labels and the empty-result message must not hint that restricted channels exist (e.g. `/traffic`'s `visibility` choices are plain "Only you" / "Everyone", not "your full clearance view" / "public channels only"), so a low-clearance user cannot infer higher-clearance channels from the wording.
- Every overview statistic is derived only from the privacy-filtered set, including cross-window ones: `/traffic`'s "change vs previous" trend re-counts the immediately preceding equal-length window through the _same_ `allowed` channel set (`trend.ts`), so the comparison can never leak an unseen channel's volume. When an overview embed outgrows the 150-line cap, split the embed builder into a sibling file (e.g. `/traffic`'s `overview.ts`) rather than thinning the privacy logic.

## `/help` and command categories

`CommandConfig.category` (type `CommandCategory`, a stable ASCII union: `auto_reply | fun | server_activity | utility | admin | ai | other`) groups commands in the `/help` reply. Each handler sets it in `setConfig`; a command that omits it falls into `other`.

The `/help` handler (`src/handlers/commands/help/`) renders a public categorized embed. The pure builder `build-help-embed.ts` groups `bot.commandHandlers` by `category`, emits one embed field per non-empty category in a fixed order, and is unit-tested in `test/unit/handlers/help/`. Category labels and the footer are translator keys under `replies:help.*` (`title`, `intro_fallback`, `footer`, `category.<key>`); the per-personality intro comes from the bot's optional `helpMessageKey`. The builder imports `Command` / `localizeCommandConfig` from `../command` (not the `@cmd` barrel) to stay out of the generated-registry import cycle.

When adding a command, set its `category` so it lands in the right `/help` section instead of `other`.
