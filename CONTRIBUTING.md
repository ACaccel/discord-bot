# Contributing

Thanks for working on this codebase. This guide covers local setup,
the test workflow, and step-by-step recipes for the two most common
extensions: adding a slash command and adding a plugin.

See [`docs/architecture.md`](docs/architecture.md) for the layered
architecture overview and why things are arranged the way they are.

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
`config.example.json`) and `.env` file containing `TOKEN`, `CLIENT_ID`,
`MONGO_URI`, and `PORT` (Nijika only).

Run a bot in development:

```bash
yarn nijika          # or konata / tomori / msg-archive
yarn deploy -t nijika  # register slash commands with Discord
```

## Quality gates

All gates run in CI; please run them locally before opening a PR.

| Command                   | What it checks                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `yarn typecheck`          | Strict TypeScript (`tsconfig.strict.json`) — `any`, `as any`, un-narrowed `unknown`, etc. fail |
| `yarn lint`               | ESLint on every strict-mode directory                                                          |
| `yarn format:check`       | Prettier (use `yarn format` to fix)                                                            |
| `yarn handlers:gen:check` | Codegen registries match the on-disk handler layout                                            |
| `yarn test:unit`          | Unit tests (Vitest project `unit`)                                                             |
| `yarn test:int`           | Integration tests with mongodb-memory-server                                                   |
| `yarn test:contract`      | LLM provider contract tests via nock                                                           |
| `yarn test:i18n`          | Catalog parity + CJK-literal scanner                                                           |
| `yarn test`               | All four test projects                                                                         |
| `yarn security`           | `yarn npm audit` + `gitleaks detect`                                                           |

A handful of legacy directories (`src/handlers/`, `src/plugins/`,
`src/bot/`) are not yet on the strict tsconfig — they still pass
`yarn typecheck` because the strict project narrows its `include` to
the migrated layers. New code outside those legacy directories should
land strict-compliant.

## Architectural rules

The full list is in [`docs/architecture.md`](docs/architecture.md).
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

   export default classmy_command extends Command {
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

2. **Add the i18n keys.** Open
   `src/interface/locales/zh-TW/replies.json` and add a namespace:

   ```json
   "my_command": {
     "success": "✅ {{thing}} 已建立",
     "failed": "my_command 執行失敗,請稍後再試"
   }
   ```

   Reuse `errors.json` keys for cross-cutting failures
   (`errors:db.not_found`, `errors:permission.denied`, etc.).

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
   test that uses `createMongoTestHarness` from `test/fixtures/`.

6. **Register with Discord.** `yarn deploy -t <bot-name>` after the bot
   has been started at least once (so the slash command registration
   token cache is populated).

## Adding a plugin

Plugins are the right home for behaviours that are bot-scoped, not
interaction-scoped: scheduled jobs, event subscriptions, message
listeners, etc.

1. **Create the plugin folder.**

   ```
   src/plugins/<plugin-name>/
     plugin.ts          # createXxxPlugin(config?) factory
     config.schema.ts   # zod schema for the plugin's config
     index.ts           # re-exports the factory
   ```

2. **Implement the contract** (`Plugin<Config>` from
   `src/core/plugin/types.ts`):

   ```ts
   // src/plugins/<plugin-name>/plugin.ts
   import type { Plugin } from '../../core/plugin';
   import { TOKENS } from '../../core/ioc';
   import { configSchema, type PluginConfig } from './config.schema';

   export const createXxxPlugin = (config?: Partial<PluginConfig>): Plugin<PluginConfig> => {
     let logger; // captured during init
     let translator; // captured during init

     return {
       id: 'xxx',
       version: '1.0.0',
       scope: 'bot', // or 'guild'
       critical: false, // soft-disable on init failure
       configSchema,

       async init(ctx) {
         logger = ctx.logger;
         translator = ctx.translator;
         // resolve other deps here, NOT inside event handlers:
         // const conn = ctx.container.resolve(TOKENS.ConnectionManager);
       },

       events: {
         messageCreate: async (msg) => {
           // host wraps this call with try/catch — one failure does not
           // kill the listener for the next message.
         },
       },

       contributes: {
         // Optional: the plugin owns its own slash commands.
         // commands: [MyCommand],
       },
     };
   };
   ```

3. **Add the zod config schema.**

   ```ts
   // src/plugins/<plugin-name>/config.schema.ts
   import { z } from 'zod';

   export const configSchema = z.object({
     enabled: z.boolean().default(true),
     // …
   });
   export type PluginConfig = z.infer<typeof configSchema>;
   ```

4. **Add i18n keys** for any user-facing strings (see the slash-command
   recipe above).

5. **Register the plugin** in the bots that want it:

   ```ts
   // src/bot/nijika/nijika.ts
   import { createXxxPlugin } from '@plugins';

   export class Nijika extends BaseBot<NijikaConfig> {
     public constructor(/* … */) {
       super(/* … */);
       this.use(
         createXxxPlugin({
           /* config */
         }),
       );
     }
   }
   ```

6. **Add tests.** The plugin's pure logic gets unit tests; the wiring
   (init lifecycle, event subscriptions) gets a plugin-level test that
   uses a fake `Plugin*Context`. See `test/unit/plugins/` for examples.

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
