# Changelog

One line per notable change, grouped by kind under the release it
shipped in, each line naming the commit that made it. This project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html);
lines marked **breaking** need an operator action described in
[`README.md`](README.md) or [`CONTRIBUTING.md`](CONTRIBUTING.md).

## [Unreleased]

### Added

- 2fefa76 feat(plugins): add the `social-link-preview` plugin — validating embed-proxy previews for Twitter/X, Instagram, Threads, Facebook, and Bahamut, with the original auto-embed suppressed.
- 77d5e78 feat(plugins): add a Reddit rewrite provider covering comment permalinks and mobile share links.
- 74c7a44 feat(gopher): add the database-free `gopher` personality with a ported self-hosted-LLM auto-reply, an owner-only settings REST API, and a daily identity sync.
- 0d65612 feat(permission-rank): add the `permission_rank` privacy model and the `/traffic` / `/traffic_me` message-traffic commands.
- 043e0e4 feat(tools): add the `migrate-timestamp` ops tool that audits, converts, and indexes `Message.timestamp`.
- bf1c6a9 feat(traffic): add `/traffic_user` for a named target's message stats, gated by the invoker's clearance rather than the target's.
- b3a22af feat(social-link-preview): add a Bilibili video preview provider.
- 5c383fc feat(social-link-preview): resolve `b23.tv` short links to their canonical Bilibili video URL before proxying.
- e4078f3 feat(temp-role): add `/temp_role` — open-to-all, permission-less self-claim notification roles with a hard 30-day expiry.
- 6aef6ad feat(tomori): enable social-link preview, `/temp_role`, and a custom ready-time presence on `tomori`.
- 69e83b4 feat(x-media-feed): forward new image / video posts from followed X accounts to a guild feed channel, restart-safe via a per-handle cursor.

### Changed

- feat(auto-reply): move the per-user lucky replies into the `auto_reply` config block (**breaking** — `luckyReplies` / `globalLuckyProbability` replace the compiled-in user ids, and the `auto_reply.fatcat_line` / `mubaimu_line` catalog keys are gone).
- feat(weather-forecast): read the AccuWeather location from `weather_forecast.locationKey` (**breaking** — required whenever the command is enabled).
- feat(random-restaurant): read the recommendation endpoint from `random_restaurant.apiUrl` (**breaking** — required whenever the command is enabled).
- refactor(handlers): read slash-command options through typed accessors and a shared timeout-bounded HTTP client instead of unchecked casts and bare `axios`.
- refactor(architecture): move the option accessors, the error-to-reply boundary, and the bounded HTTP client into `infra/`, and fail the build on a `plugins` → `handlers` import.
- refactor(handlers): validate third-party JSON responses against a schema at the boundary, so a changed upstream shape stops surfacing as a friendly empty result.
- 16cb24f chore: rename the last remaining `discord-bot` reference to BotFleet.
- 7fabeca feat(permission-rank): fold effective channel rank over the full ancestry, so a ranked category gates every channel and thread beneath it.
- 7629d45 perf(persistence): drop the `$toLong` predicate and index-serve `Message.timestamp` range reads.
- b238205 feat(giveaway): replace `/giveaway_create` and `/giveaway_delete` slash options with a modal and a select menu.
- e476c4c feat(roll-call): expand role mentions in `/roll_call`'s `users` option, capped at 50 unique members.
- 8a9c2cc refactor(tools): consolidate the three DB ops tools into one `yarn db <subcommand>` CLI (**breaking** — one merged `tools/db/config.json`).
- 971f923 feat(guild-events): narrow the `guild_events` rank ceiling to Discord disclosure only, so every edit/delete is recorded locally; make the msg-archive transcript log opt-in.
- refactor(plugin): collapse the plugin contract to `id` + `version` + lifecycle hooks + `events`, with config parsed by each plugin's own factory.
- refactor(plugin): run every lifecycle phase in registration order and isolate failures per plugin, so no plugin can abort startup.
- refactor(ioc): move the service-token catalog to `src/bot/tokens.ts`, fixing the layering violation that had `core` importing `infra`, `persistence`, and `plugins`.
- refactor(ioc): reduce the container to a single singleton lifetime.
- refactor(errors): make `instanceof` the sole dispatch contract for `DomainError` and drop the parallel `kind` tag from the log record.
- chore(knip): fail the build on an unused export or type, and extend the scan to `tools/`.
- chore(deps): replace the unmaintained `sodium` voice-encryption backend with `libsodium-wrappers`, removing the native build step from `yarn install`.

### Fixed

- fix(lifecycle): handle `SIGINT` and `SIGTERM`, so Ctrl+C runs the graceful shutdown instead of hard-killing the process mid-backup; a second signal exits immediately.
- fix(lifecycle): exit non-zero when a personality's startup fails, so a bad token no longer leaves a live process with nothing registered.
- fix(plugins): tear down and unsubscribe plugins that were disabled after `start`, which previously leaked their HTTP listeners and event subscriptions.
- fix(plugins): close the earthquake and settings-api HTTP servers under a bounded timeout instead of waiting on idle keep-alive sockets.
- fix(env): return `ACCUWEATHER_KEY` from `loadEnv`, which silently disabled `/weather_forecast` on every deployment.
- fix(i18n): reply with localised copy instead of raw English reasons when a giveaway or activity delete fails.
- fix(i18n): match the `/roll_call` reaction tally against the catalog prefix, so the tally works on an English-locale bot.
- fix(i18n): localise the `/ai_settings` modal labels and the LLM usage footer's unknown-price text.
- fix(record): stamp the trace id on the `/record` failure reply the copy promises.
- fix(logging): degrade to stderr when a log file cannot be written, instead of escalating a full disk to a fatal crash.
- fix(llm): bound every model-list fetch, so a stalled provider no longer wedges the `/ai_settings` model menu for the process lifetime.
- fix(llm-chat): cap session history and evict idle sessions, bounding both request size and memory growth.
- fix(guild-events): stream deleted attachments to disk with a timeout, a size cap, and a concurrency bound.
- fix(mongo): discard a connection whose open finishes after `closeAll`, which previously leaked a socket no teardown knew about.
- fix(scheduling): log a rejected scheduled job instead of dropping it into an untraceable unhandled rejection.
- fix(commands): register commands independently so one misconfigured handler no longer aborts the rest, and report the failure at error level with its cause.
- fix(random-restaurant): distinguish a real upstream failure from an empty result set instead of reporting both as "no restaurants found".
- fix(update-role): answer unregistered guilds and malformed `level_roles` blocks instead of crashing.
- fix(guild-onboarding): report the real command-registration outcome for a newly joined guild rather than always claiming success.
- fix(ban-user): log the failed timeout and the deleted-message fallback's own errors.
- fix(gopher): report no connection manager for the database-free personality instead of throwing on every null check.
- fix(lifecycle): escalate the exit status when a fault lands mid-teardown, so a crash during a clean stop is no longer reported to the supervisor as success.
- fix(lifecycle): abort the deferred `ClientReady` body when startup failed, instead of registering guilds on a half-wired bot that is about to exit.
- fix(lifecycle): release a partially started bot's port and connections before exiting on a failed startup.
- fix(mongo): bound the shutdown drain and refuse new connections while `closeAll` runs, so a database outage during Ctrl+C no longer forces the hard-timeout kill.
- fix(update-role): log a malformed `level_roles` block instead of reporting it as an unconfigured feature.
- 683c130 fix(social-link-preview): expand Facebook share short links to their canonical permalink before proxying.
- 2b0384b fix(gopher): unbreak the typecheck and unit-test gates after the gopher landing.
- 8992fec fix(reliability): tolerate a transient network reset instead of crashing, and stop `message-backup`'s repeat loop dying on a failed pass.
- ea4bec6 fix(link-preview): restore Threads and X previews, reject login-wall cards, and move the embed-proxy host lists into operator config (**breaking** — the six `*ProxyHosts` lists are now required when the feature is enabled).

### Removed

- a5b6764 feat(todo-list): remove the `todo_list` feature permanently, including its repository, schema, and catalog keys (**breaking**).
- 1b8f144 feat(pin-message): remove the deprecated `/pin_message` command, superseded by Discord's native thread-pin permission (**breaking**).
- 65eb7b6 refactor(i18n): drop the completed phased-rollout scaffolding.
- ecbe555 chore: strip refactoring-process residue and dead code.
- refactor(commands): remove `/inspect_member_ids` (**breaking** — see the `commands` field in [`README.md`](README.md) for the operator step).
- refactor(plugin): remove the unused `contributes` registries, plugin dependency graph, `critical` flag, `configSchema`, and `'guild'` scope; the codegen registry is the only handler-registration mechanism.
- refactor(ioc): remove the transient and scoped container lifetimes and `createScope`, which had no callers.
- refactor(errors): remove the zero-reference `ValidationError`, `NotFoundError`, `ConflictError`, `PermissionError`, and `DiscordApiError` classes and their orphaned catalog keys.
- refactor(ids): remove the unused `MessageId` / `UserId` / `RoleId` brands.
- refactor(i18n): remove seven orphaned `replies:*` keys.

### Security

- fix(ci): set `pipefail` on the dependency-audit step, which reported success for every advisory because the pipeline's exit status came from `tee`.
- fix(logging): redact `XAI_API_KEY`, `ACCUWEATHER_KEY`, and `GOPHER_SETTINGS_API_KEY`, and strip credentials from URL query strings before they reach a log.
- fix(llm): send the Gemini API key in a header instead of the request URL.
- fix(logging): redact the `user:password@` credentials of a connection string, which reached the log verbatim inside a Mongo error message.
- fix(auto-reply): send operator-configured replies with mentions disabled, so a stray `@everyone` in `config.json` cannot ping.

- 2a37a09 chore(deps): upgrade vitest / vite and pin `ws` + `form-data` to clear four HIGH/CRITICAL advisories in the test toolchain.
- f8a72fb fix(deps): bump transitive `undici` to 6.27.0 to clear GHSA-vxpw-j846-p89q.
- dce0457 chore(deps): upgrade `axios` and re-resolve four transitive packages to clear the fixable HIGH+ advisories.
- fd370ea chore(deps): re-resolve `nanoid` onto a patched release and allowlist the unfixable `tar` advisory.

## [1.0.0] — 2026-05-31

Initial public release: the codebase was rebuilt from a flat script
collection into the layered, plugin-based architecture described in
[`docs/architecture.md`](docs/architecture.md). The notable changes of
that rebuild:

### Added

- d02ee4d feat(phase-0): establish the engineering baseline — strict TypeScript, ESLint, prettier, vitest, and the i18n scaffolding.
- 546e25a feat(phase-1): add typed schemas and the codegen handler registry with a CI drift check.
- 146edcc feat(phase-2): add the typed manual IoC container and the persistence layer.
- 488b57e feat(phase-2): complete the repository set and migrate the first batch of handlers onto it.
- 4287dc2 feat(phase-3): add the `DomainError` taxonomy, `Result<T, E>`, the pino logger, and the process-level safety nets.
- 73aadcd feat(phase-4): add the plugin contract, `PluginHost`, `InteractionRouter`, and `EventDispatcher`.
- 954c7c9 feat(phase-4): wire `PluginHost` into `BaseBot`.
- fca53e7 feat(phase-4): migrate the event handlers into the auto-reply and guild-events plugins.
- c480b7c feat(phase-4): migrate the remaining features and msg-archive into plugins, slimming the composition roots.
- 80e35ac feat(phase-5): add the LLM provider Strategy layer (OpenAI, Anthropic, Gemini, xAI) with nock contract tests.
- a4cd0b3 feat(phase-6): add the CJK-literal scanner, `bot.translator`, and the seeded bilingual catalogs.
- b4c7906 feat(i18n): land the bilingual catalog and per-feature failure copy.
- 2422c69 feat(phase-7): add `yarn smoke`, a pre-deploy boundary probe over env load, Mongo ping, and Discord login.
- 7114323 chore(ci): add the knip and emit-verification gates.
- 06e15c0 feat(ci): add vitest coverage thresholds and the coverage CI gate.
- 4950833 feat(infra): add connection-manager retry with a disabled-set, so one guild's outage cannot stop the bot.
- 545d4d6 feat(core): add the guild-onboarding port and extract the bot lifecycle phases.
- 8652208 feat(plugins): add the earthquake plugin and route reactions through the structured logger.
- e53c171 feat(logger): add structured guild-event details and local-date file routing.
- f42a969 feat(tools): add the `msg_backup` full-history re-ingest tool.
- 11c4451 feat(tools): add the `verify_db` integrity-check tool.
- 72e52c6 ci: run the `tools` test project and cover the `dev` branch in triggers.
- 7536bbd feat(message-backup): give each backup pass a timestamped transcript path so a rerun cannot overwrite the prior one.
- e8b7248 feat(llm): add the cheapest-still-listed default-model resolver with a weekly refresh.
- cbaf8f7 feat(bot): add config-driven `language` and `admin`, optional guild channel maps, and a categorized `/help`.
- f7e24a6 feat(deploy): add `--dry-run` to verify localized command text without registering.
- 25fea6d feat(deploy): prune guild-scoped commands on a global deploy so a stale registration cannot shadow the global one.
- 825bf38 feat(plugins): add the self-hosted-LLM auto-reply plugin.
- 4d30216 refactor(bot): expose `BaseBot.guildInfo` as a read-only accessor API.
- 9cbf68a docs: add `docs/architecture.md` as the single-page architecture overview.
- a134f72 docs: adopt the Git Flow branching model (`main` + `dev`).

### Changed

- ed9096f refactor: kebab-case the bot and handler-type directories.
- 05670ca refactor(persistence): unify the repository boundary on `Result<T, DatabaseError>`.
- a7a9c4b feat(ci): extend the strict tsconfig to the whole `src` tree.
- 7f7a566 feat(ci): expand lint scope to `src/**` and sweep the remaining `any`s.
- aeecff0 refactor(logger): move file-sink wiring out of `createLogger` into `createBootstrapLogger`.
- dffce92 refactor(logger): drop the redundant `clientId` parameter from the log helpers.
- 1cb2dec refactor(logger): strip the `bot` field from file output, since the path already encodes it.
- 04d5357 chore: rename the project to BotFleet.

### Fixed

- dec2700 fix(bot): register the `ClientReady` listener before login so the reboot message fires.
- 831ae20 fix(persistence): tolerate a `model.init()` failure so DB-backed commands keep working.
- 430c45a fix(handlers): break the circular import between the handler barrel and the generated registry.
- fe59b60 fix(bot): restore tomori's guild-event logging and rework giveaway publishing.
- eb09993 fix(deploy): paginate the guild list so the command prune covers more than 200 guilds.
- b1f9d54 fix(tools): back up archived private threads in `msg_backup`.
- fcd4273 fix(tools): paginate `msg_backup`'s archived threads by `hasMore` rather than page fill.

### Removed

- 6a9041f refactor: remove the TTS feature and rewrite source comments in a release voice.
- 1e28b31 feat(persistence): migrate message-backup onto repositories and delete the `src/db/` shim.
- 2dddacc refactor: fold `src/features/` into `plugins/<x>/internal` and delete the stale path aliases.
- 42539dd refactor(logger): drop the `_unbound` fallback bucket from the file-router transport.
- 3cd9312 refactor(logger): stop audit-logging `MESSAGE_CREATE`, which drowned every other event.
- 661a727 refactor(logger): stop audit-logging reaction events, for the same reason.
- d8e2cd9 docs: delete the internal engineering working documents.

### Security

- 30e670c chore(security): allowlist GHSA-r5fr-rjxr-66jc, which has no in-range remediation via `@discordjs/builders`.

[1.0.0]: https://github.com/ACaccel/BotFleet/releases/tag/v1.0.0
