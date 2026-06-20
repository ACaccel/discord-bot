# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Standalone `verify_db` / `migrate_timestamp` / `drop_todo_collection` ops tools removed (breaking).** The three DB-maintenance tools — their `yarn <tool>` / `yarn <tool>:test` scripts and their `tools/<tool>/` directories — are gone, consolidated into the unified `db` ops CLI (see _Changed_). **Operator action required:** before pulling, migrate your gitignored per-tool `tools/<tool>/config.json` files into the single `tools/db/config.json` (a shared `mongo_uri` / `guilds` block plus a per-operation `operations` section — note `verify` now takes a single-element `guilds` array instead of `guild_id`) and switch invocations to `yarn db <subcommand>`.
- **`/pin_message` permanently removed.** The deprecated thread-pin command (pin / unpin a message in your own public thread by link) has been retired — Discord now provides a native thread-pin permission, so the command duplicated a built-in capability. Its command handler and the `commands:pin_message.*` / `replies:pin_message.*` catalog keys (both locales) are gone and the command registry was regenerated (43 → 42 commands). **Operator action required:** removing the code does not unpublish the command — remove `"pin_message"` from the `commands` list of any bot `config.json` that still carries it and re-run `yarn deploy -t <bot>` so Discord drops it. Decision `0008`.
- **`/todo_list` permanently removed.** The to-do list command (add / delete / list, on the `nijika` personality) has been retired. Its command handler, the `TodoRepo` / `MongoTodoRepo` repository, the `todoSchema` / `Todo` model registration, the `commands:todo_list.*` / `replies:todo_list.*` catalog keys (both locales), and the integration test are all gone. **Operator action required:** the feature stored its items in a `todos` collection inside each guild's own database, which is _not_ deleted automatically — run `yarn db drop-todo` (dry-run by default) to drop it per guild, and re-run `yarn deploy -t nijika` so Discord drops the `/todo_list` command (it has already been removed from that bot's `config.json` `commands` list). Decision `0007`.

### Added

- **`/temp_role` — temporary self-claim notification roles.** A new slash command (open to every member) creates a permission-less, mentionable role used only for `@mention` notifications and posts a claim message with a toggle button — reusing the existing `toggle_role` button so any member can self-claim / release it. The role auto-deletes after a selectable lifetime with a hard 30-day cap (default 30 days), at which point the claim message is marked expired and the database row is removed; pending expiries survive restarts via a giveaway-style `onReady` reboot sweep. Creation is rejected when the guild is at Discord's 250-role ceiling. Shipped as the general-purpose `temp-role` plugin (`src/plugins/temp-role/`) plus a new `TempRole` schema and repository, and loaded by the `nijika` personality (enable it by adding `temp_role` to that bot's `config.json` `commands` list). As part of this work, the shared `toggle_role` button's replies are now localised (`zh-TW` / `en`) instead of hardcoded English.

### Changed

- **DB-maintenance tools unified under one extensible CLI, `yarn db <subcommand>`.** `verify` / `migrate-timestamp` / `drop-todo` now run through a single entry point (`tools/db/`) backed by a `DbCommand` Strategy + registry and one shared connection / config / logging / per-guild-runner layer — adding a future operation is a command module plus one registry line. Driven by a single `tools/db/config.json` (a shared `mongo_uri` / `guilds` / `output_path` block plus a per-operation `operations` map). All commands now standardise on the production `buildGuildMongoUri` (per-guild db name + `authSource=admin` appended; any explicit non-admin `authSource` previously preserved by `verify_db` / `drop_todo_collection` is no longer honoured — every shipped example already uses `admin`). Behaviour, report shapes, modes, dry-run defaults, and exit codes of each operation are preserved.
- **`/roll_call` now accepts roles in its `users` field.** Alongside individual `@user` mentions, you can now `@mention` a role and the command expands it to every (non-bot) member holding that role, merged and de-duplicated with any directly-mentioned users before the roll-call announcement. `@everyone` / `@here` is rejected, and a single call is capped at 50 unique members (past that it asks you to trim roles or people) so one command cannot ping an unbounded crowd. The `users` field stays a single string option — roles and users are parsed from the raw mention text, so the command shape is unchanged; only the option's description text changed, so re-run `yarn deploy` to refresh it in Discord.

### Fixed

- **A transient network blip no longer crashes the whole bot.** A momentary outbound-socket reset (`ECONNRESET` / "socket hang up", e.g. a discord.js gateway connection dropped by the network) used to surface as an unhandled client `error` event, which Node rethrows as an `uncaughtException` — tripping the process-level graceful-shutdown path and stopping the bot until a manual restart. Two defences now absorb it: the Discord client gains non-fatal `error` / `shardError` / `shardDisconnect` listeners (installed once for the client's full lifecycle, so the gateway error is logged while discord.js reconnects on its own), and the `uncaughtException` safety net classifies a narrow whitelist of transient network errors (via `isTransientNetworkError`) and logs + tolerates them instead of shutting down — genuine defects still crash loudly. A `getTransientNetworkErrorCount()` counter is exposed for /health.
- **`message-backup`'s repeat loop no longer dies silently on a failed pass.** The periodic backup `setTimeout` callback was a floating async promise with no error handling: a single failed pass (e.g. a Discord fetch timing out) leaked an `unhandledRejection` and killed the repeat loop, halting all further backups until restart. Each guild's pass is now failure-isolated (one guild's error no longer aborts the others in the same pass) and the loop always reschedules itself in a `finally`.
- **`social-link-preview` now previews Facebook share short links** (`https://www.facebook.com/share/r/<token>/`). The embed proxies cannot resolve Facebook's opaque share token — they return a login wall, which is correctly filtered as junk — so previously these links produced no preview at all. The Facebook provider now expands a share link to its canonical permalink (following Facebook's browser-UA redirect) before proxying it for a playable video, and falls back to a static OpenGraph card — scraped from Facebook's own crawler response — for any Facebook link no proxy can preview.
- **`social-link-preview` now honours a custom `bilibiliProxyHosts` setting.** The plugin built its provider registry without forwarding the operator's configured `bilibiliProxyHosts` list (every other platform's `*ProxyHosts` was forwarded), so a custom bilibili proxy list was silently ignored and only the built-in default (`[vxbilibili.com, bilibiliez.com]`) ever applied. The list is now wired through.

### Added

- **`social-link-preview` now previews Bilibili `b23.tv` short links** (`https://b23.tv/<token>`). The short token carries no video id, so — like the Facebook share-link path — the bilibili provider first follows the `b23.tv` redirect to the canonical `bilibili.com/video/<BV|av>` URL, then proxies that for a playable Discord embed. A short link that resolves to a non-video page (live / dynamic / article / bangumi) is left untouched. Covered by the same `bilibili` provider, so it is enabled by the existing `social_link_preview.providers` entry.
- **`social-link-preview` now previews Bilibili videos** (`nijika`): a sixth rewrite provider matching `(www.|m.)?bilibili.com/video/<BV…|av…>` pages, rewritten onto an embed-proxy domain (default `bilibiliProxyHosts` `[vxbilibili.com, bilibiliez.com]` — BiliFix then BilibiliEZ) so Discord unfurls a playable video. The multi-part `?p=` selector is preserved and bilibili tracking params (`spm_id_from` / `vd_source`) are dropped; `b23.tv` short links are also supported (see below). Enabled by adding `bilibili` to a bot's `social_link_preview.providers` list. The proxy URL also drops the path's trailing slash, because vxbilibili answers a `/video/<BV>/` request with a 307 that downgrades to `http://` — a redirect Discord's crawler refuses, leaving no embed — whereas the canonical no-slash URL is served `200` directly.
- **Link-preview OpenGraph parsing now tolerates unquoted `<meta>` attribute values.** The `OgClient` `<head>` parser previously matched only quoted attributes; the primary Bilibili proxy (vxbilibili) emits unquoted ones (`property=og:video`, `content=http://…/img.jpg`) and sometimes omits the space before the next attribute, so every such tag was dropped and the preview silently fell through. The parser now reads double-quoted, single-quoted, and unquoted values, so vxbilibili's `og:video` is detected and the high-quality preview is posted.
- **`gopher` personality** (Discord display name "老鼠人"): a new, database-free bot that hosts the self-hosted-LLM auto-reply (ported from `nijika`) plus two gopher-only capabilities. Run with `yarn gopher`; registers only the `/help` command.
- `settings-api` plugin (gopher): an owner-only, bearer-authenticated HTTP REST API (`GET` / `PUT {basePath}/endpoint`) to read/update the self-hosted LLM `endpoint` at runtime and persist it to `config.json`. Bound to `127.0.0.1` by default; the key is read from `GOPHER_SETTINGS_API_KEY` (never `config.json`), and an enabled API with no key refuses to start (fail-closed).
- `identity-sync` plugin (gopher): a once-a-day check that mirrors a source user's avatar and **per-guild server nickname** (`syncWithSource`; the bot takes the source user's `GuildMember.displayName` in each guild, not their global name), guarding avatar re-uploads by the source avatar hash to respect Discord's rate limits; when sync is off it applies a static fallback identity (`fallbackNickname` + `fallbackAvatarPath`).
- `GOPHER_SETTINGS_API_KEY` environment variable (optional; required when gopher's settings API is enabled).
- **`permission_rank` config block** (`guilds.<id>.permission_rank`) and the `PermissionRankPolicy` core service: operator-defined privacy / clearance ranks for channels (`channels`) and users-via-roles (`roles`), plus a per-feature channel-rank `maxChannelRank` ceiling (`features`). Resolved once from static config at startup (fail-fast validated, discord.js-free) and consumed by the `guild-events` / `social-link-preview` plugins and the channel-logging middleware to decide which channels each feature acts on. The `channelRank` / `userRank` / `visibilityCeiling` primitives also power the `/traffic` command's visibility filter (`channelRank(T) <= min(userRank, commandChannelRank)`, see below).
- **`/traffic` command** (nijika): renders guild message-traffic charts and statistics from the persisted message archive across four dimensions — a time-trend **line chart** with dashed y-gridlines, integer ticks + unit label, and a gradient area fill (the primary traffic graph); Top-N channel and user rankings as polished horizontal bars carrying the per-row value + percentage of visible messages (no duplicate text table); and an overview (total messages, daily average, change vs the previous equal-length window, active channels / users, top-contributor share, busiest / quietest period, total reactions, and the window's top reaction emoji — the previous-window comparison is fetched through the same privacy filter, so it never counts an unseen channel; the top reaction renders the actual emoji (custom emojis as the `<:name:id>` / `<a:name:id>` token, unicode emojis as the character itself)). Options: `visibility` (`ephemeral` default / `public`), `range` (`24h` / `7d` / `30d`, default `7d`), and `top_n` (1–25, default 10). **Privacy:** a dual filter includes a channel's stats only when the invoker clears BOTH the operator `permission_rank` rank ceiling AND Discord-native `ViewChannel` (for the invoking member). The ceiling tracks the reply audience: `public` caps by `min(userRank, channelRank(commandChannel))` (a posted reply never exceeds the room's own rank), while `ephemeral` caps by `userRank` alone (only the invoker sees it, so the command channel does not lower it); either way the invoker can never surface a channel above their own clearance or one they cannot see, and a deleted / uncached channel is excluded fail-safe. The `visibility` choice labels and the no-data message are intentionally neutral so a low-clearance user is not made aware that higher-clearance channels exist. Charts are hand-rendered with `canvas`; emoji in channel / user names are stripped from chart labels (the chart font has no emoji glyphs, so they would otherwise render as tofu boxes), while Discord-native embed text keeps its emoji. The policy is reached through the new `bot.permissionRankPolicy` accessor.
- **`/traffic_me` command** (nijika): the invoker's own message-activity stats over a window (`range` `24h` / `7d` / `30d`, `top_n` 1–25) — an overview (total messages, daily average, share of visible traffic, busiest period, rank among active users, channels active in), a personal time-trend line chart, and a personal channel-distribution bar chart (each bar's percentage is the share of the user's own messages). Options mirror `/traffic`: `visibility` (`ephemeral` default / `public`), `range`, and `top_n`. Reuses the same dual visibility filter, so it counts only the user's activity in channels the chosen audience may see — a `public` reply is capped by both the invoker's clearance and the command channel's rank (never exceeding the room's level), while an `ephemeral` reply is capped by the invoker's clearance alone. Voice activity is out of scope (not currently persisted). The shared chart / visibility-filter / window primitives were lifted into `src/handlers/commands/traffic-shared/` (a codegen-ignored helper module, no `index.ts`) for reuse by both `/traffic` and `/traffic_me`.
- **`/traffic_user` command** (nijika): a specified target user's message-activity stats over a window — the same overview / time-trend line chart / channel-distribution bar chart as `/traffic_me`, but for a `user` you name (a required option). **Privacy is gated by the invoker, never the target:** the visible-channel set is built from the invoker's `permission_rank` clearance plus native `ViewChannel`, and the target's activity is counted only within it, so the target's own clearance never widens the view; a target with no visible activity — including one not in the guild — yields the same neutral no-data reply, never revealing a restricted channel or whether a user is a member. Options mirror `/traffic_me` (`visibility` `ephemeral` default / `public`, `range`, `top_n`); a `public` reply is additionally capped by the command channel's rank. The per-user `options` parser, `aggregation-user`, and the now-shared `user-view` (a `keyPrefix` selects each command's `replies:*` namespace) were lifted from `traffic_me/` into `src/handlers/commands/traffic-shared/`, so `/traffic_me` and `/traffic_user` share one tested implementation.
- **timestamp-migration ops tool** (now `yarn db migrate-timestamp`, see _Changed_): a multi-guild tool that audits, converts (legacy String → numeric), and indexes the `messages.timestamp` field so the `MessageRepo` range queries can drop the non-sargable `$toLong` predicate. Three modes — `audit` (read-only, prints a fleet recommendation), `convert`, `index`. Conversion takes a **mandatory, fail-fast** in-database snapshot before any write, only touches all-digit String values (non-numeric "garbage" is routed to manual triage, never auto-converted), and is value-preserving and idempotent (`dry_run` previews without writing). See [docs/wiki/ops/migrate-timestamp.md](docs/wiki/ops/migrate-timestamp.md).

### Changed

- **Giveaways are now run through interactive UI instead of slash-command options.** `/giveaway_create` no longer carries `duration` / `prize` / `winner_num` / `description` options — it opens a modal with those four text inputs (the parameters are collected and validated on submit; `winner_num` is parsed server-side since modals have no numeric input type, rejecting non-positive / non-integer values). `/giveaway_delete` no longer asks for a copied `message_id` — it lists the guild's active giveaways as a select menu (paged at 25 per row) and deletes the chosen one. The announcement embed, 🎉 reaction entry, scheduled draw, and restart-reboot behaviour are unchanged. Because the command shapes changed, re-run `yarn deploy` so Discord drops the old options. New `giveaway_create` modal handler and `giveaway_delete` select-menu handler; adds `replies:giveaway.modal_*`, `replies:giveaway.invalid_winner_num`, `replies:giveaway.no_active_giveaways`, `replies:giveaway.delete_select_placeholder`, and `replies:giveaway.delete_option_label` catalog keys (both locales) and removes the now-unused `commands:giveaway_*.options.*` keys.
- **Channel suppression for `guild-events`, `social-link-preview`, and channel-logging is now driven by `permission_rank`** (per-guild) instead of the bot-wide `blocked_channels` list. Default per-feature ceilings: `guild_events` and `channel_logging` act only on rank-0 channels; `social_preview` previews everywhere. **Behaviour change:** channels that were in `nijika`'s old `blocked_channels` now RECEIVE social-link previews (set a finite `social_preview.maxChannelRank` to suppress them again); they stay excluded from the event mirror and debug log by carrying a rank ≥ 1. Suppression scope narrowed from bot-wide to **per-guild** — migrate each previously-blocked channel id under the correct `guilds.<id>.permission_rank.channels`.
- **`permission_rank` effective rank now spans the full channel ancestry** (parent channel → category), not just the immediate parent. A category id in `permission_rank.channels` now gates every channel AND thread nested under it — including threads in a forum or text channel under a ranked category. Applies uniformly to all rank-gated features (`/traffic` + `/traffic_me` visibility, `guild-events`, `channel-logging`, `social-link-preview`): the ancestry is resolved via the new `ancestorChannelIdsOf` (`infra/discord`) and folded by `channelRank` / `isSuppressed` / `visibilityCeiling`, which now take an `ancestorChannelIds` array. Strictly additive — when a deeper ancestor is uncached the walk degrades to the prior one-level behaviour.
- The self-hosted-LLM auto-reply (`llm-auto-reply`) moved from `nijika` to the new `gopher` personality.
- `llm-auto-reply` transcript format: dropped the `[<channelName>]` prefix — each line is now `<displayName>: <content>`, so the channel name is no longer sent to the LLM.
- `llm-auto-reply` deterministic trigger changed from the `fatcat_reply` keyword to **@-mentioning the bot** (konata-style, `ignoreRepliedUser: true`); the bot's mention is stripped from the transcript. The probabilistic automatic reply is unchanged. The plugin now requires a `clientId` dep.
- `SelfHostedLlmClient` endpoint now also accepts a provider function (`() => string`) resolved per request, letting a composition root swap the endpoint at runtime.
- `BaseBot` now treats an empty `mongoURI` as "no database", so a database-free personality (gopher) boots without a `MONGO_URI` and its shutdown skips the connection-manager close.
- **`/traffic` / `/traffic_me` / `db_list_message` message reads are now index-served.** `MongoMessageRepo.findByTimestampRange` and `findByChannelAndTimestampRange` dropped the `$toLong` / `$expr` computed predicate in favour of a plain half-open range (`{ timestamp: { $gte, $lt } }`), and `message.schema.ts` now declares `{ timestamp: 1 }` and `{ channelId: 1, timestamp: 1 }` indexes — turning the per-query full collection scan into an index range scan (and removing the per-channel query's in-memory SORT). This requires every guild's stored `messages.timestamp` to be uniformly numeric first; the new `migrate_timestamp` ops tool performs that one-time backfill, and the predicate change must not deploy to a guild that still has String-typed timestamps. New writes are already numeric (mongoose casts to the `Number` schema type), so no String rows are reintroduced.

### Removed

- **`blocked_channels`** — the bot-wide, top-level config list that drove channel suppression for `guild-events`, `social-link-preview`, and channel-logging. Replaced by the per-guild `permission_rank` block (see Added / Changed). The `BaseBot.channelLoggingBlockedChannels()` subclass hook and the `blockedChannels` inputs to `createGuildEventsPlugin` / `createSocialLinkPreviewPlugin` were removed with it. (`llm-auto-reply`'s separate, gopher-only `blockedChannels` dep is unchanged — it intentionally predates the rank model.)
- `nijika` no longer registers `llm-auto-reply` (moved to `gopher`); its `llm_auto_reply` block was removed from `config.example.json`.

### Added

- Reddit link previews: a fifth rewrite provider (`src/infra/link-preview/providers/reddit.ts`) that rewrites comment permalinks (`/r/<sub>/comments/<id>`, bare `/comments/<id>`) and the mobile `/r/<sub>/s/<token>` share form — across `www`/`old`/`new`/`np`/`m`/`amp` reddit hosts — onto an embed-proxy domain so Discord unfurls a playable video. Default `redditProxyHosts` `[vxreddit.com, rxddit.com]` (vxreddit verified working; rxddit/FixReddit kept as a best-effort fallback — both are subject to Reddit's API limits). The validator's junk filter (`scoreMeta`) now also inspects `og:description` and recognises proxy-error placeholders (vxReddit's "Failed to get data from Reddit" / bare proxy-name title), so a failed Reddit probe is skipped rather than posted as a broken card.

### Fixed

- Social-link-preview no longer posts a broken "Log in or sign up to view" card for a login-gated Facebook post: `scoreMeta` now rejects login-wall / not-found placeholder titles (`isJunkPreviewTitle`) so a proxy OG that carries only such a title (no media) is skipped instead of posted as a text card. (facebed already resolves Facebook `/share/<type>/<token>/` short links for accessible posts — the failure was confined to posts whose media Facebook itself gates.)
- Tracking / share-attribution query params (`mibextid`, `utm_*`, `fbclid`, `igsh`/`igshid`, `si`, `ref*`, ...) are stripped from every extracted URL before provider routing (`extract-urls.ts` `stripTrackingParams`, a denylist preserving meaningful params like Facebook `v` / `story_fbid` / `id` and Bahamut `sn` / `bsn`), which also de-duplicates links differing only by tracking noise.

### Added

- `social-link-preview` plugin (nijika, opt-in, disabled by default): detects social-media share links (Twitter/X, Instagram, Threads, Facebook, Bahamut), posts a richer preview, and suppresses the user's original auto-embed. Hybrid mechanism — video-capable sources are rewritten to an embed-proxy domain so Discord unfurls a playable video, while sources without a proxy (Bahamut) are scraped for OpenGraph and rendered as a static embed.
- Pre-send embed validation with priority-ordered proxy host lists: each rewrite provider probes its `*ProxyHosts` list (with the Discord crawler UA — exactly what Discord's unfurl sees) and posts the first host that yields media (video > image > text), or nothing if none do, so a dead/empty proxy never leaves a bare link. Probing is bounded by a per-host `timeoutMs` and a cumulative `validationBudgetMs`. Default lists: Twitter/X `[fxtwitter.com, vxtwitter.com]`, Instagram `[kkinstagram.com, uuinstagram.com]`, Threads `[viewthreads.com, vxthreads.net]`, Facebook `[facebed.com, fixacebook.com]` (facebed covers text/photo posts that fixacebook does not; the archived `fixthreads.net`, the defunct ad-redirecting `facebookez.com`, and the now-JSON-only `threadsez.com` were dropped, and the verified-working `viewthreads.com` leads Threads). `OgClient` gained `og:video` + multi-image extraction and a small bounded success-only cache.
- Instagram preview reliability — two root causes fixed so IG links again produce a reply: (1) `OgClient` now **streams** the response and classifies it by `Content-Type` — a `video/*` / `image/*` response (e.g. `kkinstagram` redirects the bot UA straight to a reel `*.mp4`) is a playable preview with no body downloaded, and an HTML body is read only up to `</head>`, instead of the old `maxContentLength` cap that rejected both the multi-MB `*.mp4` and the ~900 KB `instagram.com` fallback (so IG returned nothing); and (2) the Instagram matcher now accepts the author-prefixed `/<username>/reel/<id>` share-link form, not only the canonical `/reel/<id>`. A media-file redirect is recognised even when the CDN is unreachable from the bot's host (Discord performs the unfurl and can reach it), so video previews are not lost to datacenter-IP peering. The validation fetch follows up to 3 redirects with a `beforeRedirect` SSRF guard that refuses hops to private/loopback/link-local/CGNAT addresses (IPv4, IPv6, IPv4-mapped, NAT64), internal hostnames (incl. trailing-dot FQDN forms), or non-`http(s)` schemes.
- Link-preview provider Strategy layer (`src/infra/link-preview/`) mirroring the LLM layer: a `LinkPreviewProvider` interface, an ordered URL-matching registry, four validating URL-rewrite providers, an OpenGraph provider, and an SSRF-safe `OgClient` (bounded redirect-following with a per-hop SSRF guard, streamed head-only reads, timeout caps, host allow-list).
- `LinkPreviewError` (an `ExternalServiceError` subclass) plus the `errors:link_preview.*` bilingual catalog group.

### Documentation

- Aligned the project documentation to the global engineering standard: added [docs/STATUS.md](docs/STATUS.md) (the authoritative current-state handoff) and a [docs/history/](docs/history/README.md) decision log (entries `0000`–`0004`, with an index), folded a "Design trade-offs" section into [docs/architecture.md](docs/architecture.md), and extended `CLAUDE.md` with a tech-stack/version block, a command cheat sheet, and key-document pointers.
- Captured the `permission_rank` design rationale — previously only in the local-only `docs/proposal.md` working document (gitignored since `1.0.0`, never under version control) — in the tracked decision log at [docs/history/0001](docs/history/0001-permission-rank-privacy-model.md), so the reasoning and rejected options now live in the repo.

### Security

- Upgraded `vitest` 2 → 3 (3.2.6) — which pulls `vite` 7.x — to clear a critical Vitest advisory (GHSA-5xrq-8626-4rwp) and a high Vite advisory (GHSA-fx2h-pf6j-xcff), and pinned `ws` `>=8.21.0` (GHSA-96hv-2xvq-fx4p) and `form-data` `>=4.0.6` (GHSA-hmw2-7cc7-3qxx) via `resolutions`. All four were HIGH/CRITICAL `yarn audit` advisories in the test toolchain. The Vitest workspace gained a 20s per-test `testTimeout`, since the heavy ESLint-rule and handler-codegen unit tests cross the 5s default under vite 7's cold transform in the full parallel suite.

## [1.0.0] — 2026-05-31

Initial public release.

### Added

- Layered architecture (`core` → `persistence` / `infra` → `handlers` / `plugins` → `bot`) with the dependency direction enforced by ESLint.
- Plugin system with a topologically-ordered four-phase lifecycle (`init`, `start`, `onReady`, `onShutdown`) and zod-validated config.
- Typed manual IoC container with a central `TOKENS` directory. Plugins reach `TOKENS` only through the `@core/plugin` barrel.
- Repository pattern over Mongoose, with `buildRepos(connection)` returning per-guild repository bundles.
- LLM provider Strategy layer covering OpenAI, Anthropic, Gemini, and xAI.
- Process-wide `MongoConnectionManager` with per-guild lifecycle, exponential-backoff retry, and a disabled-set so one guild's outage does not stop the bot.
- Slash-command codegen (`scripts/gen-registry.ts`) with a CI drift check.
- Bilingual i18n catalogs (`zh-TW`, `en`) split into `commands`, `errors`, and `replies` namespaces, with a parity check and a CJK-literal scanner.
- Strict TypeScript across the whole `src/`.
- Structured logging with redaction.
- Four built-in personalities: `nijika`, `konata`, `tomori`, `msg-archive`.
- Eight built-in plugins: `auto-reply`, `llm-chat`, `message-backup`, `giveaway`, `activity`, `guild-events`, `voice`, `earthquake`.
- Pre-deploy `yarn smoke` boundary probe (env load, Mongo ping, Discord login).
- Quality gates: `typecheck`, `typecheck:emit`, `lint`, `format:check`, `handlers:gen:check`, `test:unit`, `test:int`, `test:contract`, `test:i18n`, `knip`, `security`.
- Read-only public `BaseBot.guildInfo` API surface (accessor methods + readonly views).
- Self-hosted LLM auto-reply (`nijika`): a new `llm-auto-reply` plugin
  that, on each `messageCreate`, rolls a configurable probability and —
  on a hit — fetches the latest N messages, requires they form a burst
  within a time window, builds a transcript (bot/blank lines excluded),
  sends it to a self-hosted LLM HTTP endpoint, and posts one reply with
  mentions suppressed. Settings live in an optional `llm_auto_reply`
  block in `config.json` (`enabled`, `probability`, `messageCount`,
  `windowSeconds`, `cooldownSeconds`, `endpoint`, `timeoutMs`) with all
  defaults in code (disabled by default); `nijika`'s `blocked_channels`
  are excluded. A per-channel `cooldownSeconds` enforces a minimum gap
  between consecutive automatic replies (`0` disables it). The
  outbound call is a new `SelfHostedLlmClient` adapter in `src/infra/llm/`
  that maps failures into the shared error taxonomy and stays silent on
  failure. A message beginning with the `fatcat_reply` keyword
  force-triggers the reply (bypassing the probability roll, the
  time-window burst check, and the cooldown; the message-count
  requirement and all other guards still apply), and the keyword is
  stripped from the prompt transcript.
- Per-bot display language: a `language` field in each personality's
  `config.json` (`"zh-TW"` | `"en"`) selects the translator's default
  locale, validated by `isLocale` and threaded into
  `createDefaultTranslator({ fallbackLocale })`; an unsupported value
  warns and falls back to `zh-TW`. Applied both at runtime
  (`BaseBot.buildHost`) and by `src/deploy.ts`, so registered
  slash-command descriptions match the bot's configured locale. All
  four bundled bots set `"language": "zh-TW"` explicitly.
- `yarn deploy --dry-run`: builds the command payload and prints each
  command's resolved name/description without registering anything with
  Discord, so the configured-locale text can be verified locally
  without waiting on global-command propagation.
- Optional channel configuration: `guilds.<id>.channels` and `roles`
  are now optional in `config.json`. A bot may omit them (or the whole
  `guilds` block) and keeps every feature while silently skipping
  channel-bound side effects (debug logging, the guild-event mirror).
  `tomori` runs with no `guilds` block.
- Redesigned `/help`: a public categorized embed grouped by a new
  `CommandConfig.category` field (rendered by the unit-tested pure
  builder `src/handlers/commands/help/build-help-embed.ts`), with bot
  name / avatar in the author line and command / category counts in the
  footer. Every command handler is tagged with a category; `tomori`
  gained a `helpMessageKey` intro.
- File-router pino transport (`src/core/logger/file-router-transport.ts`)
  that writes JSON Lines to `<rootDir>/<botId>[/<guildId>]/<localDate>.log`,
  rotating on the local-time day boundary. Enabled by default via the
  `LOG_DIR` environment variable (defaults to `logs`).
- Structured `details` payload on `logGuildEvent` so every Discord
  event audit line carries per-field structured data (`command`,
  `user`, `channel`, `oldMessage`, `newMessage`, `added`, `removed`,
  `messageId`, `emoji`, ...) for `jq` / log-search consumers instead
  of pre-flattened strings.
- `GUILD_CREATE` audit line, promoted from `logSystem` to
  `logGuildEvent` so onboarding events file under the per-guild
  directory instead of the bot root.
- Standalone ops tools under `tools/`: `msg_backup` (backs up a guild's
  message history to a single human-readable transcript) and `verify_db`
  (scans a guild's backup database for integrity problems). Each ships
  pure, unit-tested internals plus operator docs under
  `docs/wiki/ops/`.
- `tools` vitest project plus a `test:tools` script and a `test-tools`
  CI job, so the ops-tool unit tests gate merges; the prettier glob and
  strict-tsconfig include now cover `tools/**`.
- `DefaultModelResolver` (`src/infra/llm/default-model-resolver.ts`):
  keeps each provider's default chat model pointed at the cheapest model
  still listed by the provider, published by `LlmChatPlugin.init` and
  refreshed weekly via the new `JobManager.scheduleRecurring`, so a
  retired model never strands a whitelist-entry default.
- Timestamped per-run backup transcript paths
  (`logs/backup/msg-archive-<guildId>-<YYYY-MM-DD_HH-MM-SS>.log`) so a
  truncating reopen no longer overwrites the prior run's artifact;
  `msg-archive` gains an optional `backup_interval_minutes` config.
- Git Flow branching model (long-lived `main` + `dev`), documented in
  `CONTRIBUTING.md` and `CLAUDE.md`; CI and CodeQL triggers now cover
  `dev`. Routine work is committed directly to `dev` (the local gate
  suite is the discipline; the `dev` push CI is a post-push signal, not a
  merge gate); PRs are reserved for `dev` → `main` releases, hotfixes,
  and optional large / risky `feature/*` work. Only `main` enforces the
  full required CI gate set.

### Changed

- File-router transport now strips the `bot` field from each JSON
  record before writing. The parent directory (`logs/<bot>/...`)
  already names the owning bot, so the in-record `bot` field was dead
  weight that bloated disk usage and `jq` output. `guildId` stays in
  the record — downstream aggregators (cross-guild dashboards,
  archival pipelines) need it as a join key when the file path is not
  available.
- `logSystem` / `logError` / `logGuildEvent` no longer take a
  `clientId` parameter and no longer re-bind `{ bot: clientId }` on
  every call. `createBootstrapLogger` attaches `{ bot }` via pino's
  `base` so the binding is ambient on every child; the duplicate
  binding the helpers produced caused two `bot` fields per JSON line.
  Every callsite is updated to the new shape.
- `createLogger` no longer builds the file-router transport. The sink
  is now exposed via a separate `createFileSink({ rootDir, level })`
  factory in `src/core/logger/file-router-transport.ts` and wired in
  by `createBootstrapLogger` via the new `extraStreams` option, so
  `core/logger/logger.ts` is free of file-system concerns. Tests build
  loggers via plain `createLogger` (no `extraStreams`) and therefore
  never open files, removing the prior `NODE_ENV === 'test'` branch
  inside `createBootstrapLogger`.
- `logSystem` now passes `msg` as the pino headline (positional
  argument) rather than under a `msg` binding, fixing a
  `messageKey` collision that silently dropped the operator-supplied
  text in pretty output.
- `pino-pretty` configuration: time format trimmed to seconds
  (`SYS:HH:MM:ss`) and the always-bound `bot` / `guildId` /
  `eventType` fields are hidden in the dev console (they remain in the
  JSON file sink). Closes the gap that made dev terminal output
  unreadable.
- Bot admins are now a list: `Config.admin` is `string[]` (was a single
  `string`) and `BaseBot` exposes `adminIds` plus an `isAdmin(userId)`
  check. `/ai_whitelist_add` / `/ai_whitelist_remove` gate on
  `isAdmin`, and `/bug_report` DMs every configured admin (best-effort)
  rather than only the first. Snowflake ids must be JSON strings.
- The default global `yarn deploy` now prunes guild-scoped command
  registrations from every guild after registering the global set, so a
  stale guild-scoped command (e.g. from a prior `--dev-guild` run) can no
  longer override the global one in that guild. The guild list is fetched
  with full pagination (`fetchAllUserGuilds`), since Discord caps
  `GET /users/@me/guilds` at 200 per page — a single request would
  silently skip guilds beyond the first page on large bots. Pass
  `--keep-guild-commands` to skip the prune on large bots or when
  guild-scoped commands are intentional.

### Removed

- Internal `docs/proposal.md` and `docs/tasks/` working-document
  artifacts. The gap-remediation work they tracked has shipped.
- `_unbound/` fallback bucket from the file-router transport. The
  composition root attaches `{ bot: clientId }` on the root logger so
  every record carries `bot` by construction; a missing binding is now
  a contract violation that surfaces as an error on the Writable
  stream instead of silently landing in a junk directory.
- `MESSAGE_CREATE` audit lines from `auto-reply` and `llm-chat`. These
  events sit on the hot path of normal use (every plugin reply would
  produce a log line) and operator feedback was that the volume drowned
  every other event without adding signal. `MESSAGE_CREATE` now joins
  reactions as an intentionally un-audited event type; the plugin reply
  behaviour itself is unchanged.

### Fixed

- `yarn deploy` crashed (exit 1) right after registering commands: the
  file-router log transport rejects records without a `bot` binding,
  which the deploy CLI's bootstrap logger lacked. Deploy now builds its
  logger with `createBootstrapLogger(base, { fileRouter: false })` —
  console-only — so it runs to completion and no longer creates a
  `logs/<botId>/` directory. The new `fileRouter` option on
  `createBootstrapLogger` (default `true`) is the opt-out.

### Documentation

- `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` rewritten for public contributors.
- New `docs/architecture.md` single-page architecture overview.
- `SECURITY.md` (GitHub Security Advisory workflow, 72-hour response, 90-day disclosure).
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- Repo wiki at `docs/wiki/` rewritten as a current-state component map.

[1.0.0]: https://github.com/ACaccel/BotFleet/releases/tag/v1.0.0
