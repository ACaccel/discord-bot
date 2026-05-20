# Contributing

Thanks for working on this codebase. This guide covers local setup,
the test workflow, and step-by-step recipes for the two most common
extensions: adding a slash command and adding a plugin.

See [`docs/high-level-design.md`](docs/high-level-design.md) for the
layered architecture overview and why things are arranged the way they
are.

## Local setup

Prerequisites:

- Node.js 20+ (the CI matrix runs 20)
- Yarn classic (`yarn install --frozen-lockfile`)
- MongoDB connection string for development (a free Atlas cluster
  works; integration tests use `mongodb-memory-server` and do not need
  a live database)
- `ffmpeg` if you plan to run voice features (`sudo apt install ffmpeg`)

```bash
git clone git@github.com:ACaccel/discord-bot.git
cd discord-bot
yarn install --frozen-lockfile
```

Each bot under `src/bot/<name>/` needs its own `config.json` (copy
`config.example.json`) and `.env` file. Required keys: `TOKEN`,
`CLIENT_ID`. Optional keys: `MONGO_URI` (omit for bots that do not
talk to MongoDB), `PORT` (Nijika's earthquake webhook), and any
LLM provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GEMINI_API_KEY`, `XAI_API_KEY`) for LLM-chat-enabled bots. The full
schema lives in [`src/core/config/env.ts`](src/core/config/env.ts).

Run a bot in development:

```bash
yarn nijika          # or konata / tomori / msg-archive

# Slash-command registration (audit B-5 / 3.11):
yarn deploy -t nijika                          # GLOBAL — visible in every guild after Discord propagation (~minutes, up to 1h)
yarn deploy -t nijika --dev-guild <guild_id>   # guild-scoped fast iteration (instant)
yarn deploy -t nijika --cleanup-guild-commands # one-shot: remove legacy guild-scoped registrations
```

The default is **global** registration so a freshly-invited guild
sees the full command set without an operator re-running deploy. Use
`--dev-guild` only while iterating on a test guild; production rolls
through the default global path.

## Quality gates

All gates run in CI; please run them locally before opening a PR.

| Command                   | What it checks                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn typecheck`          | Strict TypeScript (`tsconfig.strict.json`) — `any`, `as any`, un-narrowed `unknown`, etc. fail                                                                                                                                                                          |
| `yarn lint`               | ESLint on every strict-mode directory                                                                                                                                                                                                                                   |
| `yarn format:check`       | Prettier (use `yarn format` to fix)                                                                                                                                                                                                                                     |
| `yarn handlers:gen:check` | Codegen registries match the on-disk handler layout                                                                                                                                                                                                                     |
| `yarn test:unit`          | Unit tests (Vitest project `unit`)                                                                                                                                                                                                                                      |
| `yarn test:int`           | Integration tests with mongodb-memory-server                                                                                                                                                                                                                            |
| `yarn test:contract`      | LLM provider contract tests via nock                                                                                                                                                                                                                                    |
| `yarn test:i18n`          | Catalog parity + CJK-literal scanner                                                                                                                                                                                                                                    |
| `yarn test`               | All four test projects                                                                                                                                                                                                                                                  |
| `yarn security`           | `yarn npm audit` + `gitleaks detect`                                                                                                                                                                                                                                    |
| `yarn knip`               | Unused files / dependencies / unlisted imports (errors); unused exports / types (warns; tracked for A.1 / A.2 / A.5).                                                                                                                                                   |
| `yarn typecheck:emit`     | `tsc -p tsconfig.build.json` — emit-mode compile of the whole `src/` tree; catches broken imports outside the strict-tsconfig include scope. NOT a deploy build (runtime is `ts-node` from source; dist retains path aliases and does not bundle config / locale JSON). |
| `yarn smoke`              | Pre-deploy boundary probe: `.env` load + Mongo admin.ping + Discord login until `ready`. Manual; not in the CI matrix.                                                                                                                                                  |

A handful of legacy directories (`src/handlers/`, `src/plugins/`,
`src/bot/`) are not yet on the strict tsconfig — they still pass
`yarn typecheck` because the strict project narrows its `include` to
the migrated layers. New code outside those legacy directories should
land strict-compliant.

### Required status checks

Merging a PR into `refactor/architecture-overhaul` is gated by branch
protection — all ten CI jobs must report success before the PR can
merge:

`lint`, `typecheck`, `typecheck-emit`, `test-unit`, `test-coverage`,
`test-int`, `test-contract`, `knip`, `security`, and `analyze` (CodeQL).

No human review is required on this integration branch; the status
checks are the gate. This keeps the autonomous gap-remediation
engineering (the `engineering-orchestrator` agent) able to open and
merge PRs without a person in the loop, while still blocking any red
gate. `yarn smoke` is a manual pre-deploy probe and is intentionally
not a required check.

**Auto-merge is the default merge method.** The repository has GitHub
auto-merge enabled; land a PR with `gh pr merge <n> --auto --merge` and
GitHub completes the merge automatically once all ten required checks
pass. Auto-merge cannot bypass branch protection — it only releases the
merge after the gate is green. A PR that should not merge unattended is
simply not opted into auto-merge (review it, then merge by hand).

Auto-merge fires **only on success**: if a required check fails, the PR
stays open and unmerged. It is not fire-and-forget — the author must
still confirm the PR reached `MERGED`. Fix a failed check by pushing to
the same PR branch; auto-merge stays armed and re-triggers when the new
run is green. Treat anything that depends on a PR as blocked until that
PR is actually merged, not merely opened.

Note: the `main` branch protection still lists two stale check
contexts (`test-integration`, `audit`) that predate a CI job rename
(now `test-int` and `security`); they must be corrected before work
targets `main` again.

## Architectural rules

The full list is in [`docs/high-level-design.md`](docs/high-level-design.md).
Three rules are load-bearing and a CI gate or a reviewer agent will
catch a violation:

1. **No CJK literals in user-facing layers.** Every user-visible
   string must come from a translator key in
   `src/interface/locales/<lang>/{commands,errors,replies}.json`.
   The scanner runs in strict mode from Phase 6 onwards; add
   `// i18n-ignore: <non-empty reason>` only when the literal is
   genuinely not user-facing (e.g. a trigger-match regex).
2. **No `process.env.X` outside `src/core/config/env.ts`.** Env access
   goes through the zod-parsed `Env` object so missing variables
   fail at boot, not at the first request.
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
   `src/interface/locales/zh-TW/replies.json` and
   `src/interface/locales/en/replies.json` and add the same namespace
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
   - **`{{placeholder}}` sets must match across locales** for the same
     key.
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
   has been started at least once (so the slash command registration
   token cache is populated). Default is global registration — new
   guilds the bot joins later see the command without re-running
   deploy. Use `--dev-guild <id>` only for fast iteration on a single
   test guild.

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

   None of the existing plugins (`auto-reply`, `tts-reply`, `llm-chat`,
   `giveaway`, `activity`, `guild-events`, `message-backup`) split the
   schema into its own file — keep it inside `plugin.ts` so the
   factory, the schema, and the inferred config type stay co-located.

2. **Implement the contract** (see `src/core/plugin/types.ts` for
   `Plugin`, `PluginRuntimeContext`, and friends):

   ```ts
   // src/plugins/<plugin-name>/plugin.ts
   import { z } from 'zod';
   import type { Plugin } from '../../core/plugin';
   import { TOKENS } from '../../core/ioc';

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
    * object can close over a fully-typed `config`. The host does NOT
    * re-validate at register time when the plugin omits the
    * `configSchema` field — this is how every existing plugin works
    * (see `guild-events/plugin.ts`).
    */
   export const createXxxPlugin = (rawConfig: unknown): Plugin => {
     const config: XxxConfig = ConfigSchema.parse(rawConfig);
     const isBlocked = (channelId: string): boolean => config.blockedChannels.includes(channelId);

     return {
       id: PLUGIN_ID,
       version: PLUGIN_VERSION,
       scope: 'bot', // 'guild' is reserved for Phase 4b
       critical: false, // false = soft-disable on init/start failure

       events: {
         // The host always passes the runtime context as the first
         // argument, then the discord.js event arguments verbatim.
         // Every call is wrapped in try/catch so one failure does not
         // break later dispatches.
         messageCreate: async (ctx, message): Promise<void> => {
           if (message.guildId === null) return;
           if (isBlocked(message.channelId)) return;

           // Resolve dependencies via the typed accessor — never reach
           // into the raw container. `ctx.resolve` is an O(1) map
           // lookup; calling it per event is the established pattern.
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
   them only when the plugin has actual setup work — `auto-reply`,
   `tts-reply`, and `guild-events` ship without any lifecycle hook,
   while `giveaway` and `activity` use `onReady` to re-schedule jobs.

   Tip: if your plugin needs to contribute slash commands or other
   handlers, `Plugin.contributes.<type>` is a
   `Record<string, HandlerConstructor>` keyed by the handler name (not
   an array). Most plugins do not use this field — handlers live under
   `src/handlers/` and are picked up by the codegen registry.

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
   can chain if you prefer.

6. **Add tests.** The plugin's pure logic gets unit tests; the wiring
   (event subscriptions, lifecycle hooks if any) gets a plugin-level
   test that constructs a fake `PluginEventContext` /
   `PluginRuntimeContext`. See `test/unit/plugins/` for the established
   shape — `auto-reply.test.ts` is the most representative example.

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
   `CLIENT_ID`. Catches token/id mismatches a deploy might otherwise
   only surface mid-traffic.

Each step is timeboxed (default 30 s, override via `SMOKE_TIMEOUT_MS`).
The script does NOT register slash commands, start plugins, or open
HTTP routes — keep it cheap so it can sit in front of every deploy.
Exit status: `0` on full success, `1` on any failure (the failed step
is printed to stderr).

## Commit conventions

The Git history follows a `<type>(<scope>): <subject>` pattern where
`<type>` is `feat`, `fix`, `refactor`, `chore`, `docs`, or `test`, and
`<scope>` matches the area being touched (`phase-7-pr-1`, `llm-chat`,
`scanner`, etc.). Multi-line bodies are encouraged for non-trivial
changes — describe the _why_, not the _what_.

Commits get co-authored with the AI assistant that helped via
`Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

## Submitting a PR

1. Branch off `refactor/architecture-overhaul` (until that lands on
   `main`) or `main` (after).
2. Run the full local gate suite.
3. Fill in the PR template — it asks for a summary, gate evidence, and
   a rollback plan.
4. The same reviewer agents listed in plan §7A will run on the PR:
   `architecture-reviewer`, `type-system-reviewer`,
   `reliability-reviewer`, `test-architect`,
   `config-and-security-reviewer`, and `i18n-discipline-reviewer`. A
   `BLOCK` verdict from any of them must be addressed before merge.
