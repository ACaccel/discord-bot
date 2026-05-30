# Contributing

Thanks for working on this codebase. This guide covers local setup,
the quality gates that must pass before review, and step-by-step
recipes for the two most common extensions: adding a slash command
and adding a plugin.

See [`docs/architecture.md`](docs/architecture.md) for the layered
architecture overview and why things are arranged the way they are.

## Local setup

Prerequisites:

- Node.js **>= 22.13** (see [`.nvmrc`](.nvmrc))
- Yarn 1 (classic) — `yarn install --frozen-lockfile`
- MongoDB for development (a free Atlas cluster works; integration
  tests use `mongodb-memory-server` and do not need a live database)
- `ffmpeg` on `PATH` if you plan to run the voice plugin

```bash
git clone git@github.com:ACaccel/BotFleet.git
cd BotFleet
yarn install --frozen-lockfile
```

Each personality under `src/bot/<name>/` ships a checked-in
`config.example.json`. Copy it and create the matching `.env`:

```bash
cp src/bot/nijika/config.example.json src/bot/nijika/config.json
# then write src/bot/nijika/.env (TOKEN, CLIENT_ID, ...)
```

Required env keys: `TOKEN`, `CLIENT_ID`. Optional: `MONGO_URI` (omit
for personalities that do not talk to Mongo), `PORT` (nijika's
earthquake webhook), and any LLM provider keys (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`). The full
schema lives in [`src/core/config/env.ts`](src/core/config/env.ts).

Notable `config.json` fields (shape: `Config` in
[`src/bot/index.ts`](src/bot/index.ts)):

- `admin` — optional `string[]` of Discord user ids with bot-admin
  privileges (e.g. `/ai_whitelist_*`, `/bug_report`). Snowflake ids
  must be JSON strings, e.g. `["671160708007854120"]`.
- `language` — optional default display locale, `"zh-TW"` (default) or
  `"en"`. An unsupported value logs a warning and falls back to the
  default.
- `guilds.<id>.channels` / `roles` — both optional. Omit a map (or the
  whole `guilds` block) to run without channel-bound side effects:
  debug logging and the guild-event mirror simply have nothing to send
  to. `tomori` ships with no `guilds` block for this reason.

Run a personality in development:

```bash
yarn nijika          # or konata / tomori / msg-archive
```

Register slash commands with Discord (run after editing commands):

```bash
yarn deploy -t nijika                          # GLOBAL — register global set AND prune guild-scoped commands (propagation ~minutes, up to 1h)
yarn deploy -t nijika --dev-guild <guild_id>   # guild-scoped fast iteration (instant)
yarn deploy -t nijika --dry-run                # print resolved command name/description locally, register nothing
yarn deploy -t nijika --keep-guild-commands    # global deploy WITHOUT pruning guild-scoped commands
yarn deploy -t nijika --cleanup-guild-commands # only clear guild-scoped registrations
```

The default global deploy now **prunes guild-scoped commands** from
every guild after registering the global set, so a stale guild-scoped
command (e.g. from a prior `--dev-guild` run) can no longer override the
global one in that guild. This walks every guild the bot is in under the
Discord rate limit; on bots with many hundreds of guilds, pass
`--keep-guild-commands` to skip the prune (or run it off-peak).

Command descriptions are localised to the bot's `config.language` (so
`"language": "en"` registers English text). When debugging command
text, `--dry-run` prints exactly what would be registered without
touching Discord, ruling out propagation delay (global takes up to an
hour) and guild-override effects.

The default is **global** registration so a freshly-invited guild
sees the full command set without an operator re-running deploy. Use
`--dev-guild` only while iterating on a test guild; production rolls
through the default global path.

## Quality gates

All gates run in CI; please run them locally before opening a PR.

| Command                   | What it checks                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn typecheck`          | Strict TypeScript (`tsconfig.strict.json`) over the whole `src/`                                                                               |
| `yarn typecheck:emit`     | Emit-mode compile (`tsconfig.build.json`); catches broken imports outside the strict include scope. Not a deploy build (runtime is `ts-node`). |
| `yarn lint`               | ESLint                                                                                                                                         |
| `yarn format:check`       | Prettier (use `yarn format` to fix)                                                                                                            |
| `yarn handlers:gen:check` | Codegen registries match the on-disk handler layout                                                                                            |
| `yarn test:unit`          | Unit tests (Vitest project `unit`)                                                                                                             |
| `yarn test:int`           | Integration tests with `mongodb-memory-server`                                                                                                 |
| `yarn test:contract`      | LLM provider contract tests via `nock`                                                                                                         |
| `yarn test:i18n`          | Catalog parity + CJK-literal scanner                                                                                                           |
| `yarn test`               | All four test projects                                                                                                                         |
| `yarn security`           | `yarn npm audit` + `gitleaks detect`                                                                                                           |
| `yarn knip`               | Unused files / dependencies / unlisted imports (errors); unused exports / types (warns)                                                        |
| `yarn smoke`              | Pre-deploy boundary probe: `.env` load + Mongo `admin.ping` + Discord login until `ready`. Manual; not in the CI matrix.                       |

## Architectural rules

The full picture is in [`docs/architecture.md`](docs/architecture.md).
Three rules are load-bearing — a CI gate or a reviewer will catch
violations:

1. **No CJK literals in user-facing layers.** Every user-visible
   string must come from a translator key in
   `src/i18n/locales/<lang>/{commands,errors,replies}.json`. Add
   `// i18n-ignore: <non-empty reason>` only when the literal is
   genuinely not user-facing (e.g. a trigger-match regex).
2. **No `process.env.X` outside `src/core/config/env.ts`.** Env
   access goes through the zod-parsed `Env` object so missing
   variables fail at boot, not at the first request.
3. **No new handler/plugin without a test.** New public functions in
   `core/` and `plugins/` need at least one happy-path and one
   error-path test; new repository methods need an integration test
   against `mongodb-memory-server`.

## Adding a slash command

Pick a snake_case name that matches the Discord command name
convention (e.g. `add_reply`). The directory name **becomes** the
command name; do not rename it after handlers are registered with
Discord.

1. **Create the handler.**

   ```ts
   // src/handlers/commands/my_command/index.ts
   import { ChatInputCommandInteraction } from 'discord.js';
   import { BaseBot } from '@bot';
   import { Command } from '@cmd';
   import { logger } from '@utils';

   export default class MyCommand extends Command {
     constructor() {
       super();
       this.setConfig({
         name: 'my_command',
         // Groups the command under a `/help` section. Pick the closest
         // CommandCategory: auto_reply | fun | server_activity | utility |
         // admin | ai | other. Omitting it defaults to `other`.
         category: 'utility',
         // i18n-ignore: command-builder metadata; localised via name_localizations.
         description: '<short description>',
         options: {
           /* … */
         },
       });
     }

     public override async execute(
       interaction: ChatInputCommandInteraction,
       bot: BaseBot,
     ): Promise<void> {
       await interaction.deferReply();
       try {
         // do work, then:
         await interaction.editReply({
           content:
             bot.translator?.t('replies:my_command.success', {
               /* params */
             }) ?? '',
         });
       } catch (err) {
         logger.errorLogger(bot.clientId, interaction.guild?.id, err);
         await interaction.editReply({
           content: bot.translator?.t('replies:my_command.failed') ?? '',
         });
       }
     }
   }
   ```

2. **Add the i18n keys — in every locale.** The catalog is bilingual
   (`zh-TW` and `en`). Open **both**
   `src/i18n/locales/zh-TW/replies.json` and
   `src/i18n/locales/en/replies.json` and add the same namespace
   to each:

   ```json
   // zh-TW/replies.json
   "my_command": {
     "success": "✅ {{thing}} 已建立",
     "failed": "唔...執行失敗了,稍後再試一次看看吧!(錯誤代碼:{{traceId}})"
   }
   ```

   ```json
   // en/replies.json
   "my_command": {
     "success": "✅ {{thing}} created",
     "failed": "Hmm... it failed. Give it another try later! (error code: {{traceId}})"
   }
   ```

   Rules the `yarn test:i18n` catalog-completeness gate enforces:
   - **Every key must exist in both locales.** A key added to one
     locale only fails the cross-locale parity check.
   - **`{{placeholder}}` sets must match across locales** for the same key.
   - The per-command `replies:<feature>.failed` fallback string must
     carry a `{{traceId}}` interpolation slot — `replyForError` uses it
     to surface a trace code for non-`DomainError` failures.
   - Command metadata (description / option descriptions / choices)
     lives under `commands.json`, again in both locales.

   Reuse `errors.json` keys for cross-cutting failures
   (`errors:db.not_found`, `errors:permission.denied`, etc.); those
   strings carry the bot-facing tone for `DomainError.messageKey`.

3. **Regenerate the codegen registry.**

   ```bash
   yarn handlers:gen
   ```

   This rewrites `src/handlers/commands/registry.generated.ts`. Commit
   the regenerated file.

4. **List the command in the bots that should expose it.** Edit each
   `src/bot/<name>/config.json` `commands` array.

5. **Add a test.** The minimum is a unit test asserting one happy and
   one failure path; if the command touches MongoDB, add an integration
   test under `test/integration/` that uses the `withFreshConnection`
   helper from `test/integration/helpers/mongo.ts` (it reuses the
   shared `mongodb-memory-server` started in `test/integration/setup.ts`).

6. **Register with Discord.** `yarn deploy -t <bot-name>` after the bot
   has been started at least once. Default is global; `--dev-guild <id>`
   is for fast iteration on a single test guild.

### Handler 150-line cap

Every `src/handlers/<type>/<name>/index.ts` must follow these five
rules. New handlers apply them from line one — no "future cleanup"
deferrals.

1. **`index.ts` is capped at 150 lines** (imports, JSDoc, and blank
   lines all count). Enforced by the `max-lines` rule in
   [`eslint.config.mjs`](eslint.config.mjs); a violation is an ESLint
   error, not a warning.
2. **Overflow goes to sibling files in the same directory.** Pure
   helpers (anything that does not touch Discord objects) move to
   kebab-cased files (e.g. `parse-range.ts`, `render-reactions.ts`)
   with **named** exports. Do not use `export default`.
3. **Do NOT extract Discord I/O, permission checks, or `Translator`
   calls to compress the line count.** Those four belong in
   `index.ts`: interaction input extraction; guild / repos / permission
   checks; `bot.translator.t(...)` calls; assembling the domain result
   into a Discord reply. They are the handler's job.
4. **Extracted helpers must have unit tests** under
   `test/unit/handlers/<name>/<helper>.test.ts`. Test happy path,
   boundary, and error path for pure functions; inject in-memory fakes
   for `Translator` / `Repos` consumers.
5. **Helpers stay in the handler's own directory.** Do not put them in
   `src/handlers/shared/` or a new common folder; they are
   implementation details of this handler. Promote only when a second
   handler legitimately needs the same logic.

## Adding a plugin

Plugins are the right home for behaviours that are bot-scoped, not
interaction-scoped: scheduled jobs, event subscriptions, message
listeners, etc.

1. **Create the plugin folder.** Mirror the layout existing plugins
   use:

   ```
   src/plugins/<plugin-name>/
     plugin.ts   # ConfigSchema (private const) + factory
     index.ts    # re-exports the factory + the inferred config type
   ```

   Keep the schema inside `plugin.ts` so the factory, the schema, and
   the inferred config type stay co-located.

2. **Implement the contract** (see `src/core/plugin/types.ts` for
   `Plugin`, `PluginRuntimeContext`, and friends):

   ```ts
   // src/plugins/<plugin-name>/plugin.ts
   import { z } from 'zod';
   import { type Plugin, TOKENS } from '../../core/plugin';

   const PLUGIN_ID = 'xxx';
   const PLUGIN_VERSION = '1.0.0';

   const ConfigSchema = z
     .object({
       blockedChannels: z.array(z.string()).default([]),
     })
     .strict();

   export type XxxConfig = z.infer<typeof ConfigSchema>;

   /**
    * The factory parses `rawConfig` up front so the returned Plugin
    * object can close over a fully-typed `config`.
    */
   export const createXxxPlugin = (rawConfig: unknown): Plugin => {
     const config: XxxConfig = ConfigSchema.parse(rawConfig);
     const isBlocked = (channelId: string): boolean => config.blockedChannels.includes(channelId);

     return {
       id: PLUGIN_ID,
       version: PLUGIN_VERSION,
       scope: 'bot',
       critical: false, // false = soft-disable on init/start failure

       events: {
         messageCreate: async (ctx, message): Promise<void> => {
           if (message.guildId === null) return;
           if (isBlocked(message.channelId)) return;

           const registry = ctx.resolve(TOKENS.GuildRegistry);
           ctx.logger.debug(
             { guildId: message.guildId, channelId: message.channelId },
             'xxx: handling message',
           );
           void registry;
         },
       },
     };
   };
   ```

   `init` / `start` / `onReady` / `onShutdown` are all optional. Add
   them only when the plugin has actual setup work.

   Tip: if your plugin contributes slash commands or other handlers,
   `Plugin.contributes.<type>` is a `Record<string, HandlerConstructor>`
   keyed by the handler name. Most plugins do not use this — handlers
   live under `src/handlers/` and are picked up by the codegen registry.

3. **Export the factory.**

   ```ts
   // src/plugins/<plugin-name>/index.ts
   export { createXxxPlugin, type XxxConfig } from './plugin';
   ```

   Then add the matching line to [`src/plugins/index.ts`](src/plugins/index.ts).

4. **Add i18n keys** for any user-facing strings (see the slash-command
   recipe above).

5. **Register the plugin** in the bots that want it:

   ```ts
   // src/bot/nijika/nijika.ts
   import { createXxxPlugin } from '@plugins';

   export class Nijika extends BaseBot<NijikaConfig> {
     public constructor(/* … */) {
       super(/* … */);
       this.use(createXxxPlugin({ blockedChannels: [] }));
     }
   }
   ```

   `this.use(...)` is fluent (returns `this`), so multiple registrations
   can chain.

6. **Add tests.** Pure logic gets unit tests; the wiring (event
   subscriptions, lifecycle hooks if any) gets a plugin-level test
   that constructs a fake `PluginEventContext` / `PluginRuntimeContext`.
   See `test/unit/plugins/` for the established shape.

### Plugin ↔ IoC contract

A plugin's only legal channel to the IoC container is the
`@core/plugin` barrel:

```ts
import { TOKENS, type ServiceToken } from '../../core/plugin';
```

Any direct import of `@core/ioc` from `src/plugins/**` is rejected by
ESLint at lint time. From `init`, `start`, `onReady`, `onShutdown`,
and event handlers, plugins:

- **Read** dependencies with `ctx.resolve(token)`.
- **Publish** instances with `ctx.registerInstance(token, instance)` —
  permitted **only inside `init`**.

There is no escape hatch to the `ServiceContainer`'s write face. Do
not cast `ctx` to gain access; tests and review will catch it.

New tokens go in [`src/core/ioc/tokens.ts`](src/core/ioc/tokens.ts);
the `@core/plugin` barrel re-exports `TOKENS`, so a token registered
in the central directory is automatically visible to plugins.

## Pre-deploy smoke

`yarn smoke` is a boundary-only sanity check intended to run against a
staging or production deployment **before** promoting a release. It
needs a real bot `.env` (TOKEN + CLIENT_ID, plus MONGO_URI for bots
that talk to Mongo) and live network access to Discord.

```bash
yarn smoke                 # defaults to --bot nijika
yarn smoke --bot konata
yarn smoke -b msg-archive
SMOKE_TIMEOUT_MS=60000 yarn smoke --bot tomori
```

What the script verifies, in order:

1. **Env load** — runs the same zod-parsed `loadEnv()` the bot uses at
   boot, so a missing or malformed value fails fast.
2. **Mongo `admin.ping`** — only if `MONGO_URI` is present in the
   loaded env. Confirms authentication and reachability without
   touching any guild database.
3. **Discord login + `clientReady`** — logs the bot in with TOKEN,
   waits for the ready event, and asserts the bot's user id matches
   `CLIENT_ID`.

Each step is timeboxed (default 30 s, override via `SMOKE_TIMEOUT_MS`).
The script does NOT register slash commands, start plugins, or open
HTTP routes — keep it cheap so it can sit in front of every deploy.
Exit status: `0` on full success, `1` on any failure (the failed step
is printed to stderr).

## Commit conventions

The Git history follows a `<type>(<scope>): <subject>` pattern where
`<type>` is `feat`, `fix`, `refactor`, `chore`, `docs`, or `test`, and
`<scope>` matches the area being touched (`llm-chat`, `scanner`,
etc.). Multi-line bodies are encouraged for non-trivial changes —
describe the _why_, not the _what_.

## Branching model

This repo follows a **Git Flow** variant with two long-lived branches:
`main` (released) and `dev` (integration).

- **`main`** — always equals the released / production state. Every merge
  into `main` is a release: it is tagged (`vX.Y.Z`) and a GitHub Release
  is cut from it. `main` is the **only** branch that enforces the full
  required CI gate set, on the `dev` → `main` release PR.
- **`dev`** — the integration branch, and the one you **commit to
  directly**. Routine work (features, fixes, docs) lands on `dev` without
  a per-change branch or PR. Before pushing, run the full local gate
  suite (see Quality gates) — that is the discipline that keeps `dev`
  healthy. A push to `dev` still triggers CI, but as a post-push safety
  signal, not a merge gate. `dev` branch protection only blocks
  force-pushes and deletion.
- **`feature/*` (optional)** — for large or risky changes, or when you
  want a pre-merge CI gate / review, branch off `dev`, open a PR back
  into `dev`, and delete the branch on merge. Otherwise commit straight
  to `dev`.
- **Releasing** — open a `dev` → `main` PR (optionally via a `release/*`
  stabilisation branch that takes only bug fixes, version bumps, and
  changelog edits). The full required CI gate set must be green. After
  merging into `main`, tag the release + cut the GitHub Release, then
  merge `main` back into `dev` so the branches do not drift.
- **`hotfix/*`** — for production-urgent fixes, branch off `main`; merge
  back into **both** `main` (tag a patch release) and `dev`.

The `dev` → `main` release PR (and any optional `feature/*` PR) must pass
the full required CI gate set before it can merge.

## Submitting a PR

PRs are for `dev` → `main` releases, hotfixes, and optional large /
risky `feature/*` work. **Routine `dev` work does not need a PR — commit
it directly to `dev`** after the local gate suite passes.

When you do open a PR:

1. Branch off `dev` (large features) or `main` (releases / hotfixes).
2. Run the full local gate suite (see the Quality gates table).
3. Fill in the PR template — it asks for a summary, gate evidence,
   and a rollback plan.
4. A maintainer will review. CI must be green before merge; the branch
   is deleted on merge.
