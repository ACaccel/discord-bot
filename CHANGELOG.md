# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
one imperative line per notable change, grouped by kind under the release
it shipped in, each entry closing with a link to the commit that made it.
This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); entries marked
**breaking** need an operator action described in [`README.md`](README.md)
or [`CONTRIBUTING.md`](CONTRIBUTING.md).

## [Unreleased]

### Fixed

- Cache guild attachments on the bot host before deletion and retry the CDN proxy URL, so deleted-attachment archival stops losing files to Discord's near-synchronous purge (on by default — it retains a copy of every recent attachment for `guild_events.attachment_cache.ttlHours`, and pauses new cache writes while the volume has less than `guild_events.attachment_cache.minFreeDiskMb` free, default 5 GiB; see [`README.md`](README.md)) ([HASH](https://github.com/ACaccel/BotFleet/commit/HASH)).

## [1.1.0] - 2026-08-31

### Added

- Add the `social-link-preview` plugin — validating embed-proxy previews for Twitter/X, Instagram, Threads, Facebook, and Bahamut, with the original auto-embed suppressed ([2fefa76](https://github.com/ACaccel/BotFleet/commit/2fefa76)).
- Add a Reddit rewrite provider covering comment permalinks and mobile share links ([77d5e78](https://github.com/ACaccel/BotFleet/commit/77d5e78)).
- Add the database-free `gopher` personality with a ported self-hosted-LLM auto-reply, an owner-only settings REST API, and a daily identity sync ([74c7a44](https://github.com/ACaccel/BotFleet/commit/74c7a44)).
- Add the `permission_rank` privacy model and the `/traffic` / `/traffic_me` message-traffic commands ([0d65612](https://github.com/ACaccel/BotFleet/commit/0d65612)).
- Add the `migrate-timestamp` ops tool that audits, converts, and indexes `Message.timestamp` ([043e0e4](https://github.com/ACaccel/BotFleet/commit/043e0e4)).
- Add `/traffic_user` for a named target's message stats, gated by the invoker's clearance rather than the target's ([bf1c6a9](https://github.com/ACaccel/BotFleet/commit/bf1c6a9)).
- Add a Bilibili video preview provider ([b3a22af](https://github.com/ACaccel/BotFleet/commit/b3a22af)).
- Resolve `b23.tv` short links to their canonical Bilibili video URL before proxying ([5c383fc](https://github.com/ACaccel/BotFleet/commit/5c383fc)).
- Add `/temp_role` — open-to-all, permission-less self-claim notification roles with a hard 30-day expiry ([e4078f3](https://github.com/ACaccel/BotFleet/commit/e4078f3)).
- Enable social-link preview, `/temp_role`, and a custom ready-time presence on `tomori` ([6aef6ad](https://github.com/ACaccel/BotFleet/commit/6aef6ad)).
- Forward new image / video posts from followed X accounts to a guild feed channel, restart-safe via a per-handle cursor ([69e83b4](https://github.com/ACaccel/BotFleet/commit/69e83b4)).

### Changed

- Move the per-user lucky replies into the `auto_reply` config block (**breaking** — `luckyReplies` / `globalLuckyProbability` replace the compiled-in user ids, and the `auto_reply.fatcat_line` / `mubaimu_line` catalog keys are gone) ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Read the AccuWeather location from `weather_forecast.locationKey` (**breaking** — required whenever the command is enabled) ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Read the recommendation endpoint from `random_restaurant.apiUrl` (**breaking** — required whenever the command is enabled) ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Read slash-command options through typed accessors and a shared timeout-bounded HTTP client instead of unchecked casts and bare `axios` ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Move the option accessors, the error-to-reply boundary, and the bounded HTTP client into `infra/`, and fail the build on a `plugins` → `handlers` import ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Validate third-party JSON responses against a schema at the boundary, so a changed upstream shape stops surfacing as a friendly empty result ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Rename the last remaining `discord-bot` reference to BotFleet ([16cb24f](https://github.com/ACaccel/BotFleet/commit/16cb24f)).
- Fold effective channel rank over the full ancestry, so a ranked category gates every channel and thread beneath it ([7fabeca](https://github.com/ACaccel/BotFleet/commit/7fabeca)).
- Drop the `$toLong` predicate and index-serve `Message.timestamp` range reads ([7629d45](https://github.com/ACaccel/BotFleet/commit/7629d45)).
- Replace `/giveaway_create` and `/giveaway_delete` slash options with a modal and a select menu ([b238205](https://github.com/ACaccel/BotFleet/commit/b238205)).
- Expand role mentions in `/roll_call`'s `users` option, capped at 50 unique members ([e476c4c](https://github.com/ACaccel/BotFleet/commit/e476c4c)).
- Consolidate the three DB ops tools into one `yarn db <subcommand>` CLI (**breaking** — one merged `tools/db/config.json`) ([8a9c2cc](https://github.com/ACaccel/BotFleet/commit/8a9c2cc)).
- Narrow the `guild_events` rank ceiling to Discord disclosure only, so every edit/delete is recorded locally; make the msg-archive transcript log opt-in ([971f923](https://github.com/ACaccel/BotFleet/commit/971f923)).
- Collapse the plugin contract to `id` + `version` + lifecycle hooks + `events`, with config parsed by each plugin's own factory ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Run every lifecycle phase in registration order and isolate failures per plugin, so no plugin can abort startup ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Move the service-token catalog to `src/bot/tokens.ts`, fixing the layering violation that had `core` importing `infra`, `persistence`, and `plugins` ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Reduce the container to a single singleton lifetime ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Make `instanceof` the sole dispatch contract for `DomainError` and drop the parallel `kind` tag from the log record ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Fail the build on an unused export or type, and extend the scan to `tools/` ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Replace the unmaintained `sodium` voice-encryption backend with `libsodium-wrappers`, removing the native build step from `yarn install` ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).

### Fixed

- Handle `SIGINT` and `SIGTERM`, so Ctrl+C runs the graceful shutdown instead of hard-killing the process mid-backup; a second signal exits immediately ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Exit non-zero when a personality's startup fails, so a bad token no longer leaves a live process with nothing registered ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Tear down and unsubscribe plugins that were disabled after `start`, which previously leaked their HTTP listeners and event subscriptions ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Close the earthquake and settings-api HTTP servers under a bounded timeout instead of waiting on idle keep-alive sockets ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Return `ACCUWEATHER_KEY` from `loadEnv`, which silently disabled `/weather_forecast` on every deployment ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Reply with localised copy instead of raw English reasons when a giveaway or activity delete fails ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Match the `/roll_call` reaction tally against the catalog prefix, so the tally works on an English-locale bot ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Localise the `/ai_settings` modal labels and the LLM usage footer's unknown-price text ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Stamp the trace id on the `/record` failure reply the copy promises ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Degrade to stderr when a log file cannot be written, instead of escalating a full disk to a fatal crash ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Bound every model-list fetch, so a stalled provider no longer wedges the `/ai_settings` model menu for the process lifetime ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Cap session history and evict idle sessions, bounding both request size and memory growth ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Stream deleted attachments to disk with a timeout, a size cap, and a concurrency bound ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Discard a connection whose open finishes after `closeAll`, which previously leaked a socket no teardown knew about ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Log a rejected scheduled job instead of dropping it into an untraceable unhandled rejection ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Register commands independently so one misconfigured handler no longer aborts the rest, and report the failure at error level with its cause ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Distinguish a real upstream failure from an empty result set instead of reporting both as "no restaurants found" ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Answer unregistered guilds and malformed `level_roles` blocks instead of crashing ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Report the real command-registration outcome for a newly joined guild rather than always claiming success ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Log the failed timeout and the deleted-message fallback's own errors ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Report no connection manager for the database-free personality instead of throwing on every null check ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Escalate the exit status when a fault lands mid-teardown, so a crash during a clean stop is no longer reported to the supervisor as success ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Abort the deferred `ClientReady` body when startup failed, instead of registering guilds on a half-wired bot that is about to exit ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Release a partially started bot's port and connections before exiting on a failed startup ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Bound the shutdown drain and refuse new connections while `closeAll` runs, so a database outage during Ctrl+C no longer forces the hard-timeout kill ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Log a malformed `level_roles` block instead of reporting it as an unconfigured feature ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Expand Facebook share short links to their canonical permalink before proxying ([683c130](https://github.com/ACaccel/BotFleet/commit/683c130)).
- Unbreak the typecheck and unit-test gates after the gopher landing ([2b0384b](https://github.com/ACaccel/BotFleet/commit/2b0384b)).
- Tolerate a transient network reset instead of crashing, and stop `message-backup`'s repeat loop dying on a failed pass ([8992fec](https://github.com/ACaccel/BotFleet/commit/8992fec)).
- Restore Threads and X previews, reject login-wall cards, and move the embed-proxy host lists into operator config (**breaking** — the six `*ProxyHosts` lists are now required when the feature is enabled) ([ea4bec6](https://github.com/ACaccel/BotFleet/commit/ea4bec6)).

### Removed

- Remove the `todo_list` feature permanently, including its repository, schema, and catalog keys (**breaking**) ([a5b6764](https://github.com/ACaccel/BotFleet/commit/a5b6764)).
- Remove the deprecated `/pin_message` command, superseded by Discord's native thread-pin permission (**breaking**) ([1b8f144](https://github.com/ACaccel/BotFleet/commit/1b8f144)).
- Drop the completed phased-rollout scaffolding ([65eb7b6](https://github.com/ACaccel/BotFleet/commit/65eb7b6)).
- Strip refactoring-process residue and dead code ([ecbe555](https://github.com/ACaccel/BotFleet/commit/ecbe555)).
- Remove `/inspect_member_ids` (**breaking** — see the `commands` field in [`README.md`](README.md) for the operator step) ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Remove the unused `contributes` registries, plugin dependency graph, `critical` flag, `configSchema`, and `'guild'` scope; the codegen registry is the only handler-registration mechanism ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Remove the transient and scoped container lifetimes and `createScope`, which had no callers ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Remove the zero-reference `ValidationError`, `NotFoundError`, `ConflictError`, `PermissionError`, and `DiscordApiError` classes and their orphaned catalog keys ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Remove the unused `MessageId` / `UserId` / `RoleId` brands ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Remove seven orphaned `replies:*` keys ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).

### Security

- Set `pipefail` on the dependency-audit step, which reported success for every advisory because the pipeline's exit status came from `tee` ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Redact `XAI_API_KEY`, `ACCUWEATHER_KEY`, and `GOPHER_SETTINGS_API_KEY`, and strip credentials from URL query strings before they reach a log ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Send the Gemini API key in a header instead of the request URL ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Redact the `user:password@` credentials of a connection string, which reached the log verbatim inside a Mongo error message ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).
- Send operator-configured replies with mentions disabled, so a stray `@everyone` in `config.json` cannot ping ([a6e8a12](https://github.com/ACaccel/BotFleet/commit/a6e8a12)).

- Upgrade vitest / vite and pin `ws` + `form-data` to clear four HIGH/CRITICAL advisories in the test toolchain ([2a37a09](https://github.com/ACaccel/BotFleet/commit/2a37a09)).
- Bump transitive `undici` to 6.27.0 to clear GHSA-vxpw-j846-p89q ([f8a72fb](https://github.com/ACaccel/BotFleet/commit/f8a72fb)).
- Upgrade `axios` and re-resolve four transitive packages to clear the fixable HIGH+ advisories ([dce0457](https://github.com/ACaccel/BotFleet/commit/dce0457)).
- Re-resolve `nanoid` onto a patched release and allowlist the unfixable `tar` advisory ([fd370ea](https://github.com/ACaccel/BotFleet/commit/fd370ea)).

## [1.0.0] - 2026-05-31

Initial public release: the codebase was rebuilt from a flat script
collection into the layered, plugin-based architecture described in
[`docs/architecture.md`](docs/architecture.md). The notable changes of
that rebuild:

### Added

- Establish the engineering baseline — strict TypeScript, ESLint, prettier, vitest, and the i18n scaffolding ([d02ee4d](https://github.com/ACaccel/BotFleet/commit/d02ee4d)).
- Add typed schemas and the codegen handler registry with a CI drift check ([546e25a](https://github.com/ACaccel/BotFleet/commit/546e25a)).
- Add the typed manual IoC container and the persistence layer ([146edcc](https://github.com/ACaccel/BotFleet/commit/146edcc)).
- Complete the repository set and migrate the first batch of handlers onto it ([488b57e](https://github.com/ACaccel/BotFleet/commit/488b57e)).
- Add the `DomainError` taxonomy, `Result<T, E>`, the pino logger, and the process-level safety nets ([4287dc2](https://github.com/ACaccel/BotFleet/commit/4287dc2)).
- Add the plugin contract, `PluginHost`, `InteractionRouter`, and `EventDispatcher` ([73aadcd](https://github.com/ACaccel/BotFleet/commit/73aadcd)).
- Wire `PluginHost` into `BaseBot` ([954c7c9](https://github.com/ACaccel/BotFleet/commit/954c7c9)).
- Migrate the event handlers into the auto-reply and guild-events plugins ([fca53e7](https://github.com/ACaccel/BotFleet/commit/fca53e7)).
- Migrate the remaining features and msg-archive into plugins, slimming the composition roots ([c480b7c](https://github.com/ACaccel/BotFleet/commit/c480b7c)).
- Add the LLM provider Strategy layer (OpenAI, Anthropic, Gemini, xAI) with nock contract tests ([80e35ac](https://github.com/ACaccel/BotFleet/commit/80e35ac)).
- Add the CJK-literal scanner, `bot.translator`, and the seeded bilingual catalogs ([a4cd0b3](https://github.com/ACaccel/BotFleet/commit/a4cd0b3)).
- Land the bilingual catalog and per-feature failure copy ([b4c7906](https://github.com/ACaccel/BotFleet/commit/b4c7906)).
- Add `yarn smoke`, a pre-deploy boundary probe over env load, Mongo ping, and Discord login ([2422c69](https://github.com/ACaccel/BotFleet/commit/2422c69)).
- Add the knip and emit-verification gates ([7114323](https://github.com/ACaccel/BotFleet/commit/7114323)).
- Add vitest coverage thresholds and the coverage CI gate ([06e15c0](https://github.com/ACaccel/BotFleet/commit/06e15c0)).
- Add connection-manager retry with a disabled-set, so one guild's outage cannot stop the bot ([4950833](https://github.com/ACaccel/BotFleet/commit/4950833)).
- Add the guild-onboarding port and extract the bot lifecycle phases ([545d4d6](https://github.com/ACaccel/BotFleet/commit/545d4d6)).
- Add the earthquake plugin and route reactions through the structured logger ([8652208](https://github.com/ACaccel/BotFleet/commit/8652208)).
- Add structured guild-event details and local-date file routing ([e53c171](https://github.com/ACaccel/BotFleet/commit/e53c171)).
- Add the `msg_backup` full-history re-ingest tool ([f42a969](https://github.com/ACaccel/BotFleet/commit/f42a969)).
- Add the `verify_db` integrity-check tool ([11c4451](https://github.com/ACaccel/BotFleet/commit/11c4451)).
- Run the `tools` test project and cover the `dev` branch in triggers ([72e52c6](https://github.com/ACaccel/BotFleet/commit/72e52c6)).
- Give each backup pass a timestamped transcript path so a rerun cannot overwrite the prior one ([7536bbd](https://github.com/ACaccel/BotFleet/commit/7536bbd)).
- Add the cheapest-still-listed default-model resolver with a weekly refresh ([e8b7248](https://github.com/ACaccel/BotFleet/commit/e8b7248)).
- Add config-driven `language` and `admin`, optional guild channel maps, and a categorized `/help` ([cbaf8f7](https://github.com/ACaccel/BotFleet/commit/cbaf8f7)).
- Add `--dry-run` to verify localized command text without registering ([f7e24a6](https://github.com/ACaccel/BotFleet/commit/f7e24a6)).
- Prune guild-scoped commands on a global deploy so a stale registration cannot shadow the global one ([25fea6d](https://github.com/ACaccel/BotFleet/commit/25fea6d)).
- Add the self-hosted-LLM auto-reply plugin ([825bf38](https://github.com/ACaccel/BotFleet/commit/825bf38)).
- Expose `BaseBot.guildInfo` as a read-only accessor API ([4d30216](https://github.com/ACaccel/BotFleet/commit/4d30216)).
- Add `docs/architecture.md` as the single-page architecture overview ([9cbf68a](https://github.com/ACaccel/BotFleet/commit/9cbf68a)).
- Adopt the Git Flow branching model (`main` + `dev`) ([a134f72](https://github.com/ACaccel/BotFleet/commit/a134f72)).

### Changed

- Kebab-case the bot and handler-type directories ([ed9096f](https://github.com/ACaccel/BotFleet/commit/ed9096f)).
- Unify the repository boundary on `Result<T, DatabaseError>` ([05670ca](https://github.com/ACaccel/BotFleet/commit/05670ca)).
- Extend the strict tsconfig to the whole `src` tree ([a7a9c4b](https://github.com/ACaccel/BotFleet/commit/a7a9c4b)).
- Expand lint scope to `src/**` and sweep the remaining `any`s ([7f7a566](https://github.com/ACaccel/BotFleet/commit/7f7a566)).
- Move file-sink wiring out of `createLogger` into `createBootstrapLogger` ([aeecff0](https://github.com/ACaccel/BotFleet/commit/aeecff0)).
- Drop the redundant `clientId` parameter from the log helpers ([dffce92](https://github.com/ACaccel/BotFleet/commit/dffce92)).
- Strip the `bot` field from file output, since the path already encodes it ([1cb2dec](https://github.com/ACaccel/BotFleet/commit/1cb2dec)).
- Rename the project to BotFleet ([04d5357](https://github.com/ACaccel/BotFleet/commit/04d5357)).

### Fixed

- Register the `ClientReady` listener before login so the reboot message fires ([dec2700](https://github.com/ACaccel/BotFleet/commit/dec2700)).
- Tolerate a `model.init()` failure so DB-backed commands keep working ([831ae20](https://github.com/ACaccel/BotFleet/commit/831ae20)).
- Break the circular import between the handler barrel and the generated registry ([430c45a](https://github.com/ACaccel/BotFleet/commit/430c45a)).
- Restore tomori's guild-event logging and rework giveaway publishing ([fe59b60](https://github.com/ACaccel/BotFleet/commit/fe59b60)).
- Paginate the guild list so the command prune covers more than 200 guilds ([eb09993](https://github.com/ACaccel/BotFleet/commit/eb09993)).
- Back up archived private threads in `msg_backup` ([b1f9d54](https://github.com/ACaccel/BotFleet/commit/b1f9d54)).
- Paginate `msg_backup`'s archived threads by `hasMore` rather than page fill ([fcd4273](https://github.com/ACaccel/BotFleet/commit/fcd4273)).

### Removed

- Remove the TTS feature and rewrite source comments in a release voice ([6a9041f](https://github.com/ACaccel/BotFleet/commit/6a9041f)).
- Migrate message-backup onto repositories and delete the `src/db/` shim ([1e28b31](https://github.com/ACaccel/BotFleet/commit/1e28b31)).
- Fold `src/features/` into `plugins/<x>/internal` and delete the stale path aliases ([2dddacc](https://github.com/ACaccel/BotFleet/commit/2dddacc)).
- Drop the `_unbound` fallback bucket from the file-router transport ([42539dd](https://github.com/ACaccel/BotFleet/commit/42539dd)).
- Stop audit-logging `MESSAGE_CREATE`, which drowned every other event ([3cd9312](https://github.com/ACaccel/BotFleet/commit/3cd9312)).
- Stop audit-logging reaction events, for the same reason ([661a727](https://github.com/ACaccel/BotFleet/commit/661a727)).
- Delete the internal engineering working documents ([d8e2cd9](https://github.com/ACaccel/BotFleet/commit/d8e2cd9)).

### Security

- Allowlist GHSA-r5fr-rjxr-66jc, which has no in-range remediation via `@discordjs/builders` ([30e670c](https://github.com/ACaccel/BotFleet/commit/30e670c)).

[1.1.0]: https://github.com/ACaccel/BotFleet/releases/tag/v1.1.0
[1.0.0]: https://github.com/ACaccel/BotFleet/releases/tag/v1.0.0
