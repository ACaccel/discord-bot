# BotFleet

A multi-personality Discord bot framework built on TypeScript,
discord.js and MongoDB, with a layered plugin architecture, bilingual
i18n, and strict type safety.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.strict.json)

---

## What this is

`BotFleet` hosts several independent bot personalities on a single
shared core. Each personality is a thin composition root that opts
into the plugins it wants; the core takes care of lifecycle,
dependency injection, per-guild MongoDB connections, internationalised
replies, slash-command codegen, and structured error handling.

Highlights:

- **Layered architecture** with ESLint-enforced dependency direction (`core → persistence/infra → handlers/plugins → bot`).
- **Plugin system** with a four-phase lifecycle (`init`, `start`, `onReady`, `onShutdown`), per-plugin failure isolation, and config parsed by each plugin's own factory.
- **Typed IoC container** (no `reflect-metadata`, no DI framework) reachable from plugins only through a typed barrel.
- **Repository pattern** over Mongoose; tests inject in-memory fakes.
- **Strategy-based LLM provider layer** (OpenAI, Anthropic, Gemini, xAI).
- **Strict TypeScript** across the entire `src/`; CJK literals forbidden in handler / plugin code.
- **Bilingual catalogs** (`en`, `zh-TW`) with a CI parity check.

See [`docs/architecture.md`](docs/architecture.md) for the full
single-page overview.

## Built-in personalities

| Bot           | Yarn script        | Surface                                                      |
| ------------- | ------------------ | ------------------------------------------------------------ |
| `nijika`      | `yarn nijika`      | Web-facing; exposes an Express`/discord/earthquake` webhook  |
| `konata`      | `yarn konata`      | Full interactive feature set                                 |
| `tomori`      | `yarn tomori`      | Full interactive feature set                                 |
| `msg-archive` | `yarn msg-archive` | Worker-style; runs only the message-backup plugin            |
| `gopher`      | `yarn gopher`      | Database-free; self-hosted-LLM auto-reply and a settings API |

## Features

- Slash commands, buttons, modals, select menus, and reaction handlers.
- Multi-provider LLM chat with web-search toggle and per-user session persistence.
- Voice channel recording.
- Message backup to MongoDB.
- Giveaways with reaction-driven winner selection.
- Per-member activity tracking.
- Social-media share-link previews (Twitter/X, Instagram, Threads, Facebook, Reddit, Bahamut, Bilibili) with original-embed suppression.
- Earthquake alert broadcast via HTTP webhook.
- Scheduled jobs hosted by plugins.
- Built-in `en` / `zh-TW` locales; per-guild command localisation.

## Quick start

```bash
git clone https://github.com/ACaccel/BotFleet.git
cd BotFleet
yarn install --frozen-lockfile
```

Prerequisites:

- Node.js **>= 22.13** (see [`.nvmrc`](.nvmrc))
- Yarn 1 (classic)
- MongoDB (local or hosted) — only the bots that use persistent state need it
- `ffmpeg` on `PATH` if the voice plugin will be enabled

For **each** personality you want to run, create the two configuration
files in its directory:

```bash
cp src/bot/nijika/config.example.json src/bot/nijika/config.json
# then create src/bot/nijika/.env with TOKEN, CLIENT_ID, MONGO_URI, ...
```

Run the bot:

```bash
yarn nijika        # or yarn konata / yarn tomori / yarn msg-archive
```

Deploy / refresh slash commands (run once after editing commands):

```bash
yarn deploy
```

## Configuration

### `.env`

Each personality reads its own `.env` from `src/bot/<name>/.env`. The
authoritative schema lives in [`src/core/config/env.ts`](src/core/config/env.ts).

| Key                       | Required | Notes                                                                   |
| ------------------------- | -------- | ----------------------------------------------------------------------- |
| `TOKEN`                   | yes      | Discord bot token                                                       |
| `CLIENT_ID`               | yes      | Discord application client id                                           |
| `MONGO_URI`               | optional | Required for any personality that uses persistent state                 |
| `PORT`                    | optional | HTTP port for the earthquake webhook (nijika) / settings API (gopher)   |
| `NODE_ENV`                | optional | `development` (default), `test`, `production`                           |
| `LOG_LEVEL`               | optional | `trace`, `debug`, `info` (default), `warn`, `error`, `fatal`            |
| `OPENAI_API_KEY`          | optional | Enables OpenAI provider for the LLM chat plugin                         |
| `ANTHROPIC_API_KEY`       | optional | Enables Anthropic provider                                              |
| `GEMINI_API_KEY`          | optional | Enables Gemini provider                                                 |
| `XAI_API_KEY`             | optional | Enables xAI provider                                                    |
| `ACCUWEATHER_KEY`         | optional | Weather command                                                         |
| `GOPHER_SETTINGS_API_KEY` | optional | Bearer key for gopher's settings REST API (required when it is enabled) |

Secrets must never be committed. The schema rejects obvious
placeholders (`your_token`, `changeme`, etc.) at startup.

There is no root `.env.example`: the env contract is per-personality,
and the zod schema in `src/core/config/env.ts` plus the table above are
the authoritative definition. A template file would be a third copy
free to drift from both.

**Transport security for `GOPHER_SETTINGS_API_KEY`.** Bearer auth
authenticates the caller; it does not encrypt the request. Over plain
HTTP the `Authorization: Bearer <key>` header — and the endpoint being
written — travel in cleartext, so a firewall or source-IP allow-list
limits _who_ can connect but does not stop on-path eavesdropping. The
API binds to `127.0.0.1` by default. If you expose the port (router
port-forward, or `settings_api.host: "0.0.0.0"`), front it with TLS — a
reverse proxy such as Caddy or nginx terminating HTTPS and proxying to
`127.0.0.1:<PORT>` — or reach it through an encrypted tunnel (SSH,
Tailscale/WireGuard) and keep the bind on loopback. Rotate the key if it
may have been sent in cleartext.

### `config.json`

Per-personality static configuration, loaded as a sibling of each
composition root (`src/bot/<name>/config.json`). Every personality ships
a checked-in `config.example.json` — copy it, fill in the real IDs, and
keep your `config.json` out of git (it is `.gitignore`d). The shape is
`Config` in [`src/bot/index.ts`](src/bot/index.ts) plus per-personality
extensions. Snowflake ids exceed JavaScript's safe-integer range, so
every id must be a JSON **string**.

Common fields:

| Field                         | Type                | Required | Notes                                                                                                                                                                         |
| ----------------------------- | ------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`                       | `string[]`          | no       | User ids with bot-admin privileges. Gates `/ai_whitelist_*`; `/bug_report` DMs every id. Default `[]`.                                                                        |
| `language`                    | `"zh-TW"` \| `"en"` | no       | Default display locale, also used for registered slash-command text. Default `"zh-TW"`; an unsupported value warns and falls back.                                            |
| `commands`                    | `string[]`          | no       | The slash commands this personality registers with Discord. Removing an entry only stops re-registering it — run `yarn deploy -t <name>` to take the command down on Discord. |
| `guilds.<id>.channels`        | `Record<name, id>`  | no       | Symbolic channel names (`"debug"`, `"event"`, `"x_feed"`, …) → Discord ids, so handlers look channels up by name.                                                             |
| `guilds.<id>.roles`           | `Record<name, id>`  | no       | Symbolic role names → Discord ids.                                                                                                                                            |
| `guilds.<id>.permission_rank` | object              | no       | Privacy / clearance ranks for this guild — see below. Validated at startup; a malformed block fails the boot naming the guild.                                                |

`guilds` and both of its maps are optional. A bot may omit a map, a
guild entry, or the whole block: unresolvable ids are dropped and the
bot keeps every feature while silently skipping channel-bound side
effects (the debug interaction log, the guild-event mirror). `tomori`
runs this way. The exception is `msg-archive`, whose backup pass
requires a `debug` channel and aborts without one.

`permission_rank` carries three optional maps: `channels`
(`channelId -> integer >= 0`, higher = more private; an unlisted channel
is rank 0), `roles` (`roleId -> integer >= 0`, keyed by raw Discord role
id — a member's clearance is the max over their ranked roles), and
`features` (per-feature `maxChannelRank` ceiling). A feature is
suppressed on a channel when the channel's effective rank — the max over
the channel and its full ancestry — exceeds that feature's ceiling;
`null` means unbounded. Defaults: `guild_events` `0`,
`channel_logging` `0`, `social_preview` `null`.

Feature blocks are per-personality and every one is optional. Each is
zod-validated with `.strict()` at startup, so an unknown key fails the
boot, and every scalar has a code default — the block may be partial or
omitted entirely. Note that `guild_events` names two unrelated things:
the top-level block below, and a rank-gated feature key inside each
guild's `permission_rank.features` map.

| Block                     | Loaded by      | Fields (default)                                                                                                                                                                                                                                                                                 |
| ------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `llm_auto_reply`          | gopher         | `enabled` (`false`), `probability` (`0.05`), `messageCount` (`5`), `windowSeconds` (`30`), `cooldownSeconds` (`30`), `endpoint` (placeholder), `timeoutMs` (`10000`)                                                                                                                             |
| `settings_api`            | gopher         | `enabled` (`false`), `host` (`127.0.0.1`), `basePath` (`/settings`). The bearer key comes from `GOPHER_SETTINGS_API_KEY`, never this block; an enabled API with no key refuses to start. The listen port is `PORT`.                                                                              |
| `identity_sync`           | gopher         | `enabled` (`false`), `syncWithSource` (`false`), `sourceUserId` (**required** when `enabled && syncWithSource`), `schedule` (`0 4 * * *`), `syncAvatar` / `syncNickname` (`true`), `fallbackNickname` (empty = leave untouched), `fallbackAvatarPath` (`assets/gopher.png`)                      |
| `social_link_preview`     | nijika, tomori | `enabled` (`false`), `originalMessageStrategy` (`suppress`), `providers` (all), `timeoutMs` (`4000`), `maxUrlsPerMessage` (`1`), plus six `*ProxyHosts` lists — see below                                                                                                                        |
| `x_media_feed`            | nijika         | `enabled` (`false`), `accounts` (`{ handle, channel? }[]`), `defaultChannel` (`x_feed`), `pollIntervalMs` (`300000`, floor `60000`), `fullSweepEveryPolls` (`12`), `apiBaseUrl` (`https://api.fxtwitter.com`), `timeoutMs` (`8000`), `maxPostsPerPoll` (`5`), `embedProxyHost` (`fxtwitter.com`) |
| `guild_events`            | nijika, tomori | `attachment_cache.enabled` (`true`), `attachment_cache.ttlHours` (`24`), `attachment_cache.minFreeDiskMb` (`5120`) — the pre-delete attachment cache; see below                                                                                                                                  |
| `level_roles`             | nijika         | `level_<n>` → role name for the level-role sync. Required by `/update_role`; a malformed block disables the command with `replies:update_role.no_config`.                                                                                                                                        |
| `auto_reply`              | nijika, tomori | `luckyReplies` (`{ userId, probability, reply }[]`, default `[]`) and `globalLuckyProbability` (`0.005`). Each entry fires `reply` verbatim for `userId` at `probability`; the lines are operator data, not catalog copy.                                                                        |
| `weather_forecast`        | nijika, tomori | `locationKey` (**required** when `/weather_forecast` is enabled) — the AccuWeather location id, e.g. `315078` for Taipei. The API key stays in `ACCUWEATHER_KEY`.                                                                                                                                |
| `random_restaurant`       | nijika, tomori | `apiUrl` (**required** when `/random_restaurant` is enabled) — absolute `http(s)` URL of the recommendation endpoint.                                                                                                                                                                            |
| `backup_log_enabled`      | msg-archive    | `false` — when `true`, each backup pass also writes a transcript under `logs/backup/`                                                                                                                                                                                                            |
| `backup_interval_minutes` | msg-archive    | `60` — minutes between backup passes                                                                                                                                                                                                                                                             |

Several fields carry a required-when rule worth calling out:

- `weather_forecast.locationKey` and `random_restaurant.apiUrl` — both
  are **required whenever their command appears in `commands`**. There
  is no safe default for "which city" or "which recommendation
  service", so the handler validates its block at startup: a missing or
  malformed one is logged at error level and that single command is not
  registered, leaving the rest of the bot's command set intact. Copy the
  values from `config.example.json`.
- `social_link_preview.*ProxyHosts` — the six per-source embed-proxy
  lists (`twitterProxyHosts`, `instagramProxyHosts`, `threadsProxyHosts`,
  `facebookProxyHosts`, `redditProxyHosts`, `bilibiliProxyHosts`) have
  **no code defaults and are required whenever `enabled` is `true`**.
  They name third-party services whose availability changes faster than
  a release ships, so the operator owns them; enabling the feature
  without one fails the boot with an error naming the missing key. Copy
  the audited values from the personality's `config.example.json` rather
  than inventing hosts. While `enabled` is `false` the lists are
  accepted but unread. Each list is probed in order until a host yields
  a playable video or the list ends, so every dead host ahead of a live
  one costs `timeoutMs` before the preview is posted — keep the lists
  short and put the hosts that answer first.
- `x_media_feed.accounts[].channel` / `defaultChannel` — a symbolic
  channel name, so the guild's `channels` map must carry a matching
  entry. A guild without it silently opts out.
- `guild_events.attachment_cache` — Discord purges an attachment's CDN
  object nearly synchronously with the message deletion, so downloading
  it at delete time usually fails. With the cache on (the default), the
  bot downloads every non-bot guild attachment when its message is
  posted, into `./data/attachment_cache/`, and archives the local copy
  when the message is deleted. **This means a copy of every recent
  attachment — not only deleted ones — sits on the bot host for
  `ttlHours`** (default `24`, swept hourly); size that against your
  disk and your privacy posture, and set `enabled: false` to go back to
  downloading only on delete. There is no total-size cap; the per-file
  ceiling is 100 MB, and the bot stops writing new cache entries while
  the volume holding the cache tree (`./data/attachment_cache/`) has
  less than `minFreeDiskMb` free (default `5120`, i.e. 5 GiB) — a pause
  logged once and lifted once space returns. The floor is checked per
  message rather than per byte, so leave it comfortably above the
  ~400 MB that can already be downloading when it trips. That floor protects the host, not the archive:
  archiving an attachment that was already cached, and the delete-time
  download fallback, both keep running below it.

## Adding a command, button, modal, or plugin

See the step-by-step guides under
[`docs/contributing/`](docs/contributing/) —
[adding a slash command](docs/contributing/adding-a-command.md)
(recipe, the 150-line cap for handler `index.ts`, the i18n discipline)
and [adding a plugin](docs/contributing/adding-a-plugin.md) (the
plugin / IoC contract). The quality gates live in
[`CONTRIBUTING.md`](CONTRIBUTING.md#quality-gates).

## Architecture

```
            bot/         composition roots (one per personality)
              |
              v
   handlers/     plugins/        feature surface
              |
              v
    persistence/   infra/        adapters to external systems
              |
              v
            core/               pure domain — no Discord, no Mongo
```

Read [`docs/architecture.md`](docs/architecture.md) for the layer
breakdown, key abstractions, request flow, and plugin lifecycle.

## Development

Every check that gates a change — type-check, lint, format, codegen
drift, the six test projects, coverage, dead-code, and security — is
listed with what it covers in
[`CONTRIBUTING.md` §Quality gates](CONTRIBUTING.md#quality-gates).

## Contributing

Bug reports, feature suggestions, and pull requests are welcome. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md) first; it carries the quality
gates that must pass before review, the architectural rules a reviewer
will hold you to, how to report a security vulnerability privately, and
links to the per-topic guides (local setup, recipes, branching) under
[`docs/contributing/`](docs/contributing/).

## License

MIT — see [`LICENSE`](LICENSE).
