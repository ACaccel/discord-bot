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

## `/help` and command categories

`CommandConfig.category` (type `CommandCategory`, a stable ASCII union: `auto_reply | fun | server_activity | utility | admin | ai | other`) groups commands in the `/help` reply. Each handler sets it in `setConfig`; a command that omits it falls into `other`.

The `/help` handler (`src/handlers/commands/help/`) renders a public categorized embed. The pure builder `build-help-embed.ts` groups `bot.commandHandlers` by `category`, emits one embed field per non-empty category in a fixed order, and is unit-tested in `test/unit/handlers/help/`. Category labels and the footer are translator keys under `replies:help.*` (`title`, `intro_fallback`, `footer`, `category.<key>`); the per-personality intro comes from the bot's optional `helpMessageKey`. The builder imports `Command` / `localizeCommandConfig` from `../command` (not the `@cmd` barrel) to stay out of the generated-registry import cycle.

When adding a command, set its `category` so it lands in the right `/help` section instead of `other`.
