# Adding a slash command

Part of the [contributing guide](../../CONTRIBUTING.md).

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
   one failure path. Build the Discord objects with the shared builders
   in [`test/fixtures/discord/`](../../test/fixtures/discord/README.md) —
   `buildFakeBot`, `buildGuild`, `buildSendableChannel` and friends —
   rather than hand-rolling another `as unknown as BaseBot` literal.

   If the command touches MongoDB, add an integration test under
   `test/integration/` that uses the `withFreshConnection` helper from
   `test/integration/helpers/mongo.ts` (it reuses the shared
   `mongodb-memory-server` started in `test/integration/setup.ts`).
   A suite that binds a real port but needs no database belongs in the
   `integration-nodb` project instead — add its path to
   `NO_DB_INTEGRATION` in `vitest.workspace.ts` so a memory-server
   failure cannot take it down.

6. **Register with Discord.** `yarn deploy -t <bot-name>` after the bot
   has been started at least once. Default is global; `--dev-guild <id>`
   is for fast iteration on a single test guild.

## Handler 150-line cap

Every `src/handlers/<type>/<name>/index.ts` must follow these five
rules. New handlers apply them from line one — no "future cleanup"
deferrals.

1. **`index.ts` is capped at 150 lines** (imports, JSDoc, and blank
   lines all count). Enforced by the `max-lines` rule in
   [`eslint.config.mjs`](../../eslint.config.mjs); a violation is an ESLint
   error, not a warning.
2. **Overflow goes to sibling files in the same directory.** Pure
   helpers (anything that does not touch Discord objects) move to
   kebab-cased files (e.g. `parse-range.ts`, `render-reactions.ts`)
   with **named** exports. Do not use `export default`. Every export
   from `src/` names its return type — `explicit-module-boundary-types`
   is an error, so an omitted annotation fails `yarn lint`. `any` is an
   error everywhere in `src/`; reach for `unknown` and narrow.
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

## Shared handler utilities

These cross-handler modules already exist. Use them rather than
re-deriving the behaviour:

- **`src/infra/discord/options.ts`** — `getRequiredString` /
  `getRequiredNumber` / `getOptionalString` / `getOptionalNumber` /
  `getOptionalChoice`. Never write
  `interaction.options.get('x')?.value as string`: that cast types a
  missing option as a present `string`, so the failure surfaces far
  from the read. Mirror the option's declared `required` flag — a
  `getRequired*` on an absent option throws a `TypeError`, which the
  handler's `replyForError` boundary turns into a trace-id-stamped
  reply and an operator log line.
- **`src/infra/http/`** — `boundedHttp` (an axios instance carrying a
  request timeout, a response-size ceiling and a redirect cap) plus
  `getJson` / `postJson`, which validate the body against a zod schema.
  Bare `axios` has no default timeout, so an upstream that accepts the
  connection and stalls leaves the deferred reply hanging for the life
  of the process — and its `response.data` is `any`, so a changed
  upstream shape surfaces as a `TypeError` somewhere far from the read.
  Prefer the JSON helpers; keep the raw instance for non-JSON bodies.

  Both of these live in `infra/`, not `handlers/`, because `handlers`
  and `plugins` are **sibling** layers: neither may import the other,
  and both may import `infra`. An ESLint rule enforces the
  `plugins -> handlers` half.

- **`src/core/regex-capture.ts`** — `requireCapture(match, group)`.
  Never write `match[1] as string`: under `noUncheckedIndexedAccess` a
  capture group is `string | undefined`, and the cast turns a pattern
  that later gains a `?` into an `undefined` flowing silently
  downstream. It lives in `core/` rather than `infra/` because it
  touches nothing but the standard library.

- **`Command.validateBotConfig(botConfig)`** — implement it when the
  handler needs a per-bot `config.json` block, and throw when the block
  is missing or malformed. `registerCommands` calls it once per enabled
  command, logs the failure with its cause, and skips just that
  command, so a misconfiguration shows up in the boot log instead of a
  puzzling reply. `weather_forecast` and `random_restaurant` are the
  worked examples; each keeps its zod schema in a sibling `config.ts`.

## Privacy-aware data commands

A command that surfaces aggregated guild data (message counts,
rankings, traffic) must not reveal activity from channels the invoker
cannot see. The full pattern — dual filtering, audience-driven
ceilings, fail-safe channel sets, neutral copy — is documented in
[`docs/architecture.md` §Privacy-aware data commands](../architecture.md#privacy-aware-data-commands);
follow it for any new command of this kind.
