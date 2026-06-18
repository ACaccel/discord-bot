# Architecture

A single-page snapshot of the BotFleet codebase: how the layers
fit together, what the key abstractions are, how a Discord interaction
flows through the system, and how plugins are wired in.

For day-to-day contribution recipes (adding a command, adding a plugin,
running the quality gates) see `[CONTRIBUTING.md](../CONTRIBUTING.md)`.

---

## 1. Layering

The codebase is split into six layers. Dependencies flow strictly
downward; ESLint `no-restricted-imports` rules enforce the direction.

```
            bot/         composition roots — one per personality
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

| Layer         | Path               | Allowed to depend on           | Examples                                                             |
| ------------- | ------------------ | ------------------------------ | -------------------------------------------------------------------- |
| `core`        | `src/core/`        | nothing outside `core`         | `errors`, `result`, `i18n`, `ioc`, `plugin`, `logger`, `time`        |
| `persistence` | `src/persistence/` | `core`                         | Mongoose schemas + Repository interfaces and implementations         |
| `infra`       | `src/infra/`       | `core`                         | `MongoConnectionManager`, LLM provider strategies                    |
| `handlers`    | `src/handlers/`    | `core`, `persistence`, `infra` | slash command / button / modal / select-menu / reaction entry points |
| `plugins`     | `src/plugins/`     | `core`, `persistence`, `infra` | self-contained feature modules                                       |
| `bot`         | `src/bot/`         | everything above               | `BaseBot` and per-personality subclasses                             |

Plugins reach `core` only through the `@core/plugin` barrel; importing
`@core/ioc` directly from `src/plugins/**` is ESLint-forbidden so the
IoC container's write face stays inside the composition root.

## 2. Key abstractions

### `BaseBot` ([src/bot/index.ts](../src/bot/index.ts))

Thin lifecycle owner. Subclasses (`nijika`, `konata`, `tomori`,
`msg-archive`) opt plugins in via `this.use(...)` and override
configuration; `BaseBot.run()` orchestrates startup in a fixed order:

1. Load env + build composition-root container.
2. Initialise the i18n translator (in the bot's configured `language`, default `zh-TW`) and load locale catalogs.
3. Connect every configured guild's MongoDB via the shared connection manager.
4. Resolve each guild's channels, roles, and repositories.
5. Attach the Discord client event bridge.
6. Run plugin `init` → `start` hooks in topological order.
7. Login to Discord, await `ClientReady`, run `onReady` hooks.

Three single-purpose collaborators back the orchestrator:

- `**GuildRegistrar**` ([src/bot/guild-registrar.ts](../src/bot/guild-registrar.ts)) — pure assembly of per-guild `GuildInfo` (channels, roles) from Discord cache + bot config. Best-effort; never throws.
- `**ClientEventBridge**` ([src/bot/client-event-bridge.ts](../src/bot/client-event-bridge.ts)) — adapter from `client.on(...)` raw events to the `InteractionRouter`, the plugin `EventDispatcher`, the reaction port, and the `GuildCreate` fallback. Owns a single attach/detach cycle.
- `**GuildDbConnector**` ([src/bot/guild-db-connector.ts](../src/bot/guild-db-connector.ts)) — per-guild Mongo lifecycle. Drives the `ReposFactory` and normalises failure into `ConnectionManager`'s disabled-set so other guilds keep running.

### Plugin contract ([src/core/plugin/](../src/core/plugin/))

A `Plugin<Config>` declares:

- `id`, SemVer `version`, `scope` (`'bot'` or `'guild'`), optional `critical` flag.
- Optional zod `configSchema` validated at registration time.
- Optional `dependencies` (other plugin ids).
- Lifecycle hooks: `init`, `start`, `onReady`, `onShutdown`. `init` is the only phase allowed to publish singletons via `ctx.registerInstance(token, instance)`. `onShutdown` runs in **reverse** topological order; failures are logged but never fatal.
- Event subscriptions over discord.js `ClientEvents`.
- A `contributes` block enumerating commands, buttons, modals, select-menus, reactions, jobs, and locale namespaces.

`PluginHost` ([src/core/plugin/host.ts](../src/core/plugin/host.ts))
topologically sorts the graph, fans `Promise.allSettled` across event
subscribers, and merges plugin contributions with the codegen core
registries.

### IoC container ([src/core/ioc/](../src/core/ioc/))

A ~280-line manual `ServiceContainer` typed via `ServiceToken<T>`.
There is no `reflect-metadata` and no DI framework. Standard tokens
live at [src/core/ioc/tokens.ts](../src/core/ioc/tokens.ts). Plugins
see `TOKENS` through the `@core/plugin` barrel; the container itself
is not re-exported, so plugins cannot bypass DI.

### Repository pattern ([src/persistence/repositories/](../src/persistence/repositories/))

Each persistent entity has an `<X>Repo` interface and a `Mongo<X>Repo`
implementation. `buildRepos(connection)` returns the `Repos` bundle
bound to one guild's Mongo connection. Handlers and plugins depend on
interfaces; tests inject in-memory fakes.

### i18n ([src/core/i18n/](../src/core/i18n/) + [src/i18n/locales/](../src/i18n/locales/))

`Translator` wraps i18next. Catalogs live at
`src/i18n/locales/<lang>/{commands,errors,replies}.json` keyed
`<namespace>:<feature>.<purpose>`. The `localesDir` is injected from
the composition root so `core/i18n` has no knowledge of the content
layer's path. Each personality picks its default locale through its
`config.json` `language` field (`'zh-TW'` | `'en'`), validated by
`isLocale` and threaded into `createDefaultTranslator({ fallbackLocale })`;
an unsupported value falls back to `DEFAULT_LOCALE`. CJK literals are
forbidden inside `src/handlers/` and `src/plugins/`; a CI scanner
enforces this.

### Error taxonomy + Result ([src/core/errors/](../src/core/errors/), [src/core/result/](../src/core/result/))

`DomainError` is the root of a sealed taxonomy: `ValidationError`,
`NotFoundError`, `ConflictError`, `PermissionError`,
`ConfigurationError`, and the `ExternalServiceError` branch
(`DiscordApiError`, `DatabaseError`, `LlmProviderError`,
`LinkPreviewError`). Every error
carries `code`, `messageKey` (i18n), `messageParams`, and the original
`cause`. Use cases prefer `Result<T, DomainError>`; error-translator
modules at each infra boundary turn SDK failures into domain errors.

### Branded IDs ([src/core/ids.ts](../src/core/ids.ts))

`GuildId`, `ChannelId`, `UserId`, `RoleId`, `MessageId` are branded
strings so a `ChannelId` cannot be passed where a `GuildId` is
expected.

### `PermissionRankPolicy` ([src/core/plugin/permission-rank-policy.ts](../src/core/plugin/permission-rank-policy.ts))

Operator-defined privacy / clearance ranking for channels and users —
orthogonal to Discord's own permissions. Each guild's `config.json`
carries a `permission_rank` block: channels and roles get a non-negative
integer rank (higher = more private; a member's clearance is the max over
their ranked roles), and each rank-gated feature has a `maxChannelRank`
ceiling. A feature suppresses a channel when its effective rank —
`max(channel, parent-thread)` — exceeds the ceiling; the `channelRank` /
`userRank` / `visibilityCeiling` primitives let a visibility-gated feature —
realized by the `/traffic` command — show channel `T` only when
`channelRank(T) <= min(userRank, commandChannelRank)`, combined with a native
`ViewChannel` check (the dual filter, so an unconfigured rank map still never
leaks a Discord-private channel). The policy is a core interface built once
from static config in the `BaseBot` constructor and registered under
`TOKENS.PermissionRankPolicy` (same seam as `GuildOnboardingPort`):
discord.js-free, fail-fast validated, resolved per-event by the `guild-events`
/ `social-link-preview` plugins and the channel-logging middleware, and
per-invocation by the `/traffic` handler through the `bot.permissionRankPolicy`
accessor. It replaced the bot-wide `blocked_channels` list (suppression is now
per-guild).

### `MongoConnectionManager` ([src/infra/mongo/connection-manager.ts](../src/infra/mongo/connection-manager.ts))

Process-wide pool keyed by URI, shared across personalities. Owns
per-guild connection lifecycle, exponential-backoff retry, and the
disabled-set that lets the bot keep serving other guilds when one
guild's database is unreachable.

### LLM Strategy ([src/infra/llm/](../src/infra/llm/))

Four providers (`Anthropic`, `OpenAI`, `Gemini`, `xAI`) implement a
single `LLMProvider` interface and translate their SDK errors into
`LlmProviderError`. `LLMService` selects a provider per request;
`ModelCatalog` lists supported models and is published to the
container by `LlmChatPlugin` under `TOKENS.ModelCatalog`.

`SelfHostedLlmClient` (`selfhosted-client.ts`) is a separate outbound
adapter in the same layer for a lightweight self-hosted LLM endpoint. It
does not implement `LLMProvider` (the endpoint's request/response shape
and the absence of an API key / model differ), but it maps failures into
the same `ExternalServiceError` taxonomy and returns a `Result`. Consumed
by the `LlmAutoReplyPlugin`.

### Link-Preview Strategy ([src/infra/link-preview/](../src/infra/link-preview/))

A second Provider Strategy, mirroring the LLM layer, for the
`SocialLinkPreviewPlugin`. Each `LinkPreviewProvider` matches a URL
(`canHandle`) and `build`s a `LinkPreviewResult` — a discriminated union
of `rewritten-url` (an embed-proxy link Discord unfurls into a playable
video) and `card` (neutral OpenGraph data the plugin renders into a
static embed). The five rewrite providers (Twitter/X, Instagram, Threads,
Facebook, Reddit) are pure; `bahamut` scrapes OpenGraph via the SSRF-safe
`OgClient` (streamed, bounded redirect-following behind a `beforeRedirect`
SSRF guard, host allow-list).
Failures map into `LinkPreviewError`. `LinkPreviewProviderRegistry`
matches by URL in registration order.

## 3. Interaction request flow

```
discord.js event
   |
   v
ClientEventBridge          (src/bot/client-event-bridge.ts)
   |   .on('interactionCreate')
   v
InteractionRouter          (src/core/plugin/interaction-router.ts)
   |   Chain of Responsibility
   |   - subclass middleware (optional)
   |   - createDispatchMiddleware
   |   - createChannelLoggingMiddleware
   v
Generated registry         (src/handlers/<type>/registry.generated.ts)
   |   key = command / customId / componentId
   v
Handler index.ts           (src/handlers/<type>/<name>/index.ts)
```

Middleware lives in [src/bot/middlewares.ts](../src/bot/middlewares.ts).
Handler-thrown `DomainError`s are caught at the router edge and
rendered via `replyTranslated` ([src/handlers/reply-translated.ts](../src/handlers/reply-translated.ts) and
[src/handlers/reply-for-error.ts](../src/handlers/reply-for-error.ts)) as
i18n-aware ephemeral replies.

The registry files are produced by
[scripts/gen-registry.ts](../scripts/gen-registry.ts); a drift check
(`yarn handlers:gen:check`) fails CI if the directory tree and the
generated registry disagree.

## 4. Plugin lifecycle

Plugins are processed in topological order over their declared
dependency graph:

1. `**init**` — runs before Discord login. The only phase where a
   plugin may publish a singleton via
   `ctx.registerInstance(token, instance)`. Reads config and bootstraps
   collaborators.
2. `**start**` — runs after `init` but before `ClientReady`. Attaches
   subscriptions, registers low-frequency listeners, schedules jobs.
3. `**onReady**` — runs once after `ClientReady`. Used for boot
   messages, startup checks.
4. `**onShutdown**` — runs in **reverse** topological order during
   graceful shutdown (`SIGINT` / `SIGTERM`). Failures are logged but
   never fatal.

Critical plugins (`critical: true`) abort the bot on startup failure;
non-critical plugins are marked disabled and the bot keeps running.

## 5. Built-in plugins

| Plugin                    | Path                               | Summary                                                                                                      |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AutoReplyPlugin`         | `src/plugins/auto-reply/`          | `messageCreate` keyword + lucky replies and a dice roller                                                    |
| `GuildEventsPlugin`       | `src/plugins/guild-events/`        | guild / member lifecycle events                                                                              |
| `GiveawayPlugin`          | `src/plugins/giveaway/`            | scheduled giveaways with reaction-driven winner selection                                                    |
| `ActivityPlugin`          | `src/plugins/activity/`            | per-member activity tracking via message / reaction events                                                   |
| `MessageBackupPlugin`     | `src/plugins/message-backup/`      | message create / delete / update archival (used by the `msg-archive` worker)                                 |
| `LlmChatPlugin`           | `src/plugins/llm-chat/`            | multi-provider LLM chat with web-search toggle and session persistence                                       |
| `VoicePlugin`             | `src/plugins/voice/`               | voice channel join + recording controller                                                                    |
| `EarthquakePlugin`        | `src/plugins/earthquake/`          | earthquake alert broadcast (nijika exposes the HTTP webhook)                                                 |
| `LlmAutoReplyPlugin`      | `src/plugins/llm-auto-reply/`      | probability-gated, context-aware `messageCreate` reply via a self-hosted LLM (gopher)                        |
| `SocialLinkPreviewPlugin` | `src/plugins/social-link-preview/` | rewrites/embeds social-media share-link previews and suppresses the original (nijika)                        |
| `SettingsApiPlugin`       | `src/plugins/settings-api/`        | owner-only, bearer-authenticated HTTP REST API to update the LLM `endpoint` at runtime + persist it (gopher) |
| `IdentitySyncPlugin`      | `src/plugins/identity-sync/`       | daily avatar/nickname sync with a source user, or a static fallback identity (gopher)                        |

## 6. Personalities

Each composition root under `src/bot/<name>/` is a thin `BaseBot`
subclass that opts plugins in. Personalities ship with a
`config.example.json` checked into the repo; the real `config.json`
is per deployment and `.gitignore`d.

| Personality   | Notable surface                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `nijika`      | Web-facing; exposes an Express `/discord/earthquake` webhook                                                                              |
| `konata`      | Full interactive feature set                                                                                                              |
| `tomori`      | Full interactive feature set                                                                                                              |
| `msg-archive` | Worker-style; suppresses interaction / reaction / guildCreate listeners on its `BaseBot` subclass and runs only the `MessageBackupPlugin` |
| `gopher`      | Database-free ("老鼠人"); self-hosted-LLM auto-reply, an owner-only settings REST API, and a daily avatar/nickname identity sync          |

## 7. Locales

Two locales ship out of the box: `en` and `zh-TW`. Catalog files are
split into three namespaces:

- `commands.json` — slash-command names, options, descriptions.
- `errors.json` — error strings keyed by `DomainError.messageKey`.
- `replies.json` — user-facing prose (help text, confirmations).

A CI parity check ensures the two locales stay key-aligned.
