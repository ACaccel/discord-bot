# Project: Discord Bot (TypeScript, Discord.js, MongoDB)

Multi-bot codebase hosting several Discord personalities
(`nijika`, `konata`, `tomori`, `msg-archive`) on a shared layered
core. Phase 0–7 refactor landed Clean Architecture layering, a manual
IoC container, a plugin host, Repository-pattern persistence, an LLM
provider Strategy, structured errors + Result types, full i18n
routing, and a CJK-literal scanner in strict mode.

For the day-to-day architecture overview, see
[`docs/architecture.md`](docs/architecture.md). For setup +
contribution flow, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

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
│   └── llm/               # OpenAI/Anthropic/Gemini/xAI Strategy
│
├── handlers/              # Discord interaction entry points
│   ├── commands/<name>/   # snake_case folder name = Discord command name
│   ├── buttons/<name>/
│   ├── modals/<name>/
│   ├── select-menus/<name>/
│   ├── reactions/<name>/
│   └── */registry.generated.ts   # codegen — do not hand-edit
│
├── interface/
│   └── locales/<lang>/{commands,errors,replies}.json
│
├── plugins/               # feature modules registered with PluginHost
│   ├── auto-reply/
│   ├── tts-reply/
│   ├── llm-chat/
│   ├── message-backup/
│   ├── giveaway/
│   ├── activity/
│   └── guild-events/
│
├── bot/                   # composition roots
│   ├── index.ts           # BaseBot
│   ├── nijika/            # Each bot: index.ts + <name>.ts + config.json
│   ├── konata/
│   ├── tomori/
│   └── msg-archive/
│
├── events/                # legacy event helpers (shrinking each phase)
├── utils/                 # transitional grab-bag; only `logger.ts` is strict
└── deploy.ts              # slash-command registration entry point
```

## Path aliases (`tsconfig.json`)

| Alias          | Resolves to                                                        |
| -------------- | ------------------------------------------------------------------ |
| `@bot`         | `src/bot/index`                                                    |
| `@cmd`         | `src/handlers/commands/index`                                      |
| `@button`      | `src/handlers/buttons/index`                                       |
| `@modal`       | `src/handlers/modals/index`                                        |
| `@select-menu` | `src/handlers/select-menus/index`                                  |
| `@reaction`    | `src/handlers/reactions/index`                                     |
| `@utils`       | `src/utils/index`                                                  |
| `@event`       | `src/events/index`                                                 |
| `@core/*`      | `src/core/*`                                                       |
| `@plugins`     | `src/plugins/index`                                                |

The `@db`, `@features`, and `@llm_chat` aliases were retired in
audit PR-E (C-2 + C-3) when the legacy `src/db/` shim and the
`src/features/` directory were folded into typed `Repos` and
`src/plugins/<x>/internal/` respectively.

## Key abstractions

### `BaseBot` (`src/bot/index.ts`)

Thin lifecycle owner. Builds the Discord client connection, the per-guild
Mongo `ConnectionManager`, the `GuildRegistry`, and the `Translator`,
then registers plugins via `this.use(...)`. The plugin host drives
everything after that: it topologically sorts plugins by their declared
dependencies, runs `init` / `start` / `onReady` / `onShutdown` hooks
with error isolation, and merges plugin-contributed handlers with the
codegen registries before the InteractionRouter dispatches events.

### Plugin contract (`src/core/plugin/types.ts`)

Each business feature is a `Plugin<Config>` with `id`, SemVer
`version`, `scope` (`'bot'` or `'guild'`), optional `critical` flag,
optional dependencies, an optional zod `configSchema` (existing
plugins parse in the factory and omit this field — see
`guild-events/plugin.ts`), lifecycle hooks, event subscriptions, and
a `contributes` block (commands / buttons / modals / select-menus /
reactions / jobs / locale namespaces). Plugins call
`ctx.resolve(TOKENS.X)` to fetch dependencies; the raw container is
never exposed, and Service Locator inside runtime hooks stays
unreachable.

### Handler codegen

`scripts/gen-registry.ts` scans `src/handlers/<type>/` and writes a
`registry.generated.ts` containing explicit imports and a typed
registry array. `yarn handlers:gen:check` runs in CI to fail on drift.

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
`src/interface/locales/<lang>/{commands,errors,replies}.json`. Key
format: `<namespace>:<feature>.<purpose>`. Phase 6 onwards: zero CJK
literals allowed in `src/handlers/`, `src/plugins/`, `src/events/`.

### IoC container

`src/core/ioc/container.ts` — manual ~150-line container, typed via
`ServiceToken<T>`. Standard tokens at `src/core/ioc/tokens.ts`. No
`reflect-metadata`, no DI framework.

## Special bots

### `msg-archive`

Worker-style bot. Suppresses interaction / reaction / guildCreate
listeners on its `BaseBot` subclass and runs the periodic
`MessageBackupPlugin`. Log files: `logs/msg-archive-<guildId>.log`.

### `nijika`

Web-facing bot. Exposes an Express HTTP route at `/discord/earthquake`
that broadcasts a translator-driven alert to every guild's configured
earthquake channel.

## Working in this repo

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full developer flow:
quality gates, the rules a reviewer agent will enforce, and step-by-step
recipes for adding a slash command or a plugin.

## Agent reviewers

The per-phase reviewer-agent definitions live in `.claude/agents/`:

- `.claude/agents/architecture-reviewer.md`
- `.claude/agents/type-system-reviewer.md`
- `.claude/agents/reliability-reviewer.md`
- `.claude/agents/test-architect.md`
- `.claude/agents/config-and-security-reviewer.md`
- `.claude/agents/i18n-discipline-reviewer.md`

Run the relevant agent in Consult / Review / Audit mode before
committing changes that touch `src/`. PR template asks for each
agent's verdict.
