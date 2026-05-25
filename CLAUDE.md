# Project: Discord Bot (TypeScript, discord.js, MongoDB)

Multi-personality Discord bot framework with a layered plugin
architecture, a typed manual IoC container, Repository-pattern
persistence, an LLM-provider Strategy layer, structured errors plus
`Result` types, full i18n routing, and a CJK-literal scanner enforced
in strict mode.

For the architecture overview see [`docs/architecture.md`](docs/architecture.md).
For the contributor workflow see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Directory layout

```
src/
├── core/                  # pure infrastructure (no Discord / Mongo deps)
│   ├── config/            # zod-parsed Env
│   ├── errors/            # DomainError tree
│   ├── i18n/              # Translator (i18next-backed)
│   ├── ioc/               # ServiceContainer + tokens
│   ├── logger/            # structured logger + redaction
│   ├── plugin/            # Plugin contract, PluginHost, dispatcher, router
│   ├── result/            # Result<T,E>
│   ├── time/              # Clock
│   ├── guild-registry.ts  # per-guild channel/role/repo lookup
│   └── ids.ts             # branded ID types
│
├── persistence/           # Mongoose Repository pattern
│   ├── schemas/           # *.schema.ts (Mongoose + TS doc interface)
│   └── repositories/      # *.repo.ts (interface + Mongo<X>Repo)
│
├── infra/                 # third-party SDK adapters
│   ├── mongo/             # ConnectionManager (per-guild lifecycle)
│   └── llm/               # OpenAI / Anthropic / Gemini / xAI Strategy
│
├── handlers/              # Discord interaction entry points
│   ├── commands/<name>/   # snake_case folder name = Discord command name
│   ├── buttons/<name>/
│   ├── modals/<name>/
│   ├── select-menus/<name>/
│   ├── reactions/<name>/
│   └── */registry.generated.ts   # codegen — do not hand-edit
│
├── i18n/                  # locale catalogs (content layer)
│   └── locales/<lang>/{commands,errors,replies}.json
│
├── plugins/               # feature modules registered with PluginHost
│   ├── auto-reply/
│   ├── llm-chat/
│   ├── message-backup/
│   ├── giveaway/
│   ├── activity/
│   ├── guild-events/
│   ├── voice/
│   └── earthquake/
│
├── bot/                   # composition roots — one per personality
│   ├── index.ts                       # BaseBot — thin lifecycle owner
│   ├── guild-registrar.ts             # channels/roles resolution
│   ├── client-event-bridge.ts         # Discord raw event fan-out
│   ├── guild-db-connector.ts          # per-guild Mongo lifecycle
│   ├── nijika/                        # each personality: index.ts + <name>.ts + config.json
│   ├── konata/
│   ├── tomori/
│   └── msg-archive/
│
└── deploy.ts              # slash-command registration entry point
```

## Path aliases (`tsconfig.json`)

| Alias          | Resolves to                       |
| -------------- | --------------------------------- |
| `@bot`         | `src/bot/index`                   |
| `@cmd`         | `src/handlers/commands/index`     |
| `@button`      | `src/handlers/buttons/index`      |
| `@modal`       | `src/handlers/modals/index`       |
| `@select-menu` | `src/handlers/select-menus/index` |
| `@reaction`    | `src/handlers/reactions/index`    |
| `@core/*`      | `src/core/*`                      |
| `@plugins`     | `src/plugins/index`               |

## Key abstractions

### `BaseBot` (`src/bot/index.ts`)

Thin lifecycle owner. Composed with three single-purpose collaborators —
`GuildRegistrar`, `ClientEventBridge`, `GuildDbConnector`. `run()`
orchestrates startup in order: set up container → set up translator →
connect all guilds' DBs → register all guilds → attach client event
bridge → start plugin host → login & ready. Subclasses
(`nijika` / `konata` / `tomori` / `msg-archive`) opt plugins in via
`this.use(...)`.

### Plugin contract (`src/core/plugin/types.ts`)

Each feature is a `Plugin<Config>` with `id`, SemVer `version`, `scope`
(`'bot'` or `'guild'`), optional `critical` flag, optional
dependencies, an optional zod `configSchema`, lifecycle hooks, event
subscriptions, and a `contributes` block (commands / buttons / modals /
select-menus / reactions / jobs / locale namespaces).

Plugins call `ctx.resolve(TOKENS.X)` to fetch dependencies and may
call `ctx.registerInstance(token, instance)` only inside the `init`
hook to publish constructed objects. Direct imports of `@core/ioc`
from `src/plugins/**` are ESLint-forbidden — `@core/plugin` is the
only legal source for `TOKENS`.

### Handler codegen + 150-line cap

`scripts/gen-registry.ts` scans `src/handlers/<type>/` and writes
`registry.generated.ts` (do not hand-edit). `yarn handlers:gen:check`
fails CI on drift. Each handler `index.ts` is capped at 150 lines via
ESLint `max-lines`; overflow pure helpers go to sibling files in the
same handler directory with named (not default) exports.

### Repository pattern

`src/persistence/repositories/<x>.repo.ts` exports an interface plus a
`Mongo<X>Repo` implementation. Plugins and handlers depend on the
interface; tests inject in-memory fakes. `buildRepos(connection)` in
`src/persistence/repositories/index.ts` returns the `Repos` bundle
bound to a given guild's Mongo connection.

### Error taxonomy + Result

`src/core/errors/` exposes `DomainError` and subclasses
(`ValidationError`, `NotFoundError`, `ConflictError`, `PermissionError`,
`ExternalServiceError` → `DiscordApiError` / `DatabaseError` /
`LlmProviderError`, `ConfigurationError`). Each error carries `code`,
`messageKey` (i18n), `messageParams`, and the original `cause`. Use
cases prefer `Result<T, DomainError>` (`src/core/result/`).

### i18n

`Translator` (`src/core/i18n/`) wraps i18next. Catalogs live at
`src/i18n/locales/<lang>/{commands,errors,replies}.json`. Key format:
`<namespace>:<feature>.<purpose>`. The catalog is bilingual
(`zh-TW`, `en`); the `yarn test:i18n` gate enforces parity.
`LoadCatalogOptions.localesDir` is injected from the composition root
so `core/i18n` has no dependency on the content layer's path.

### IoC container

`src/core/ioc/container.ts` — a ~280-line manual container, typed via
`ServiceToken<T>`. Standard tokens live at `src/core/ioc/tokens.ts`.
No `reflect-metadata`, no DI framework. Plugins reach `TOKENS` through
the `@core/plugin` barrel.

## Special personalities

### `msg-archive`

Worker-style. Suppresses interaction / reaction / guildCreate
listeners on its `BaseBot` subclass and runs the periodic
`MessageBackupPlugin`. Log files: `logs/msg-archive-<guildId>.log`.

### `nijika`

Web-facing. Exposes an Express HTTP route at `/discord/earthquake`
that broadcasts a translator-driven alert to every guild's configured
earthquake channel (`EarthquakePlugin`).

## Architectural rules

Three load-bearing rules; a CI gate or a reviewer will catch violations:

1. **No CJK literals in `src/handlers/` or `src/plugins/`.** Use translator keys; add `// i18n-ignore: <reason>` only when the literal is not user-facing.
2. **No `process.env.X` outside `src/core/config/env.ts`.**
3. **No new handler / plugin without a test.**

## Quality gates (non-negotiable)

```bash
yarn typecheck
yarn lint
yarn test
yarn format:check
yarn handlers:gen:check
yarn knip
```

No `--no-verify`, no skipped tests, no loosened assertions. If a gate
fails, root-cause it; do not bypass.

## Commit + PR conventions

- Commits: small, focused. `<type>(<scope>): <subject>` where `<type>` is `feat`, `fix`, `refactor`, `chore`, `docs`, or `test`.
- PRs: branch off `main`, run the full local gate suite, fill in the PR template, wait for CI green and reviewer approval.
