# Project: BotFleet (TypeScript, discord.js, MongoDB)

Multi-personality Discord bot framework with a layered plugin
architecture, a typed manual IoC container, Repository-pattern
persistence, an LLM-provider Strategy layer, structured errors plus
`Result` types, full i18n routing, and a CJK-literal scanner enforced
in strict mode.

For the architecture overview see [`docs/architecture.md`](docs/architecture.md).
For the contributor workflow see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Tech stack and versions

- Runtime: Node.js `>=22.13.0` (`.nvmrc`: `22.13.0`) · Yarn 1 (classic)
- Language: TypeScript `^5.6` (strict; `tsconfig.strict.json`)
- Discord: discord.js `^14.21` (+ `@discordjs/voice` `^0.17`)
- Persistence: Mongoose `^8.22` / MongoDB
- Validation: zod `^3.23` · i18n: i18next `^23.15` · Logging: pino `^10` ·
  HTTP: express `^4.21` · Charts: `canvas` `^3`
- LLM SDKs: `@anthropic-ai/sdk` `^0.94`, `openai` `^6`,
  `@google/generative-ai` `^0.24` (xAI via the OpenAI-compatible client)
- Test: vitest `^3.2` · Lint: eslint `^9` + typescript-eslint `^8` ·
  Format: prettier `^3`

## Command cheat sheet

```
Install:    yarn install            (reproducible: yarn install-lock)
Dev:        yarn tomori | yarn nijika | yarn konata | yarn gopher | yarn msg-archive
            (register slash commands: yarn deploy)
Test:       yarn test               (subsets: test:unit | test:int | test:contract | test:i18n | test:tools)
Lint:       yarn lint               (format check: yarn format:check)
Type-check: yarn typecheck          (tsc -p tsconfig.strict.json)
Build:      yarn typecheck:emit     (declaration build; runtime is ts-node, no bundling step)
```

The full commit-gate set (run every check before committing) is in
[Quality gates (non-negotiable)](#quality-gates-non-negotiable) below.

## Key documents

- [`docs/STATUS.md`](docs/STATUS.md) — authoritative current-state handoff
  (start here)
- [`docs/architecture.md`](docs/architecture.md) — single-page architecture
  overview
- [`docs/history/`](docs/history/README.md) — decision history (one file per
  decision; `README.md` index)
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — contribution recipes and quality gates

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
`MessageBackupPlugin`. Backup transcripts: `logs/backup/msg-archive-<guildId>-<YYYY-MM-DD_HH-MM-SS>.log` (one per run; the timestamp prevents overwrites).

### `nijika`

Web-facing. Exposes an Express HTTP route at `/discord/earthquake`
that broadcasts a translator-driven alert to every guild's configured
earthquake channel (`EarthquakePlugin`).

## Architectural rules

Four load-bearing rules; a CI gate or a reviewer will catch violations:

1. **No CJK literals in `src/handlers/` or `src/plugins/`.** Use translator keys; add `// i18n-ignore: <reason>` only when the literal is not user-facing.
2. **No `process.env.X` outside `src/core/config/env.ts`.**
3. **No new handler / plugin without a test.**
4. **No code change without its documentation.** Any change to user-visible behaviour, a config field, a public contract, or a command must update every documentation surface it touches — the relevant `docs/wiki/components/` page, `docs/architecture.md`, `CONTRIBUTING.md`, the matching `config.example.json`, and both `CHANGELOG.md` files — in the same unit of work. A missing doc update is a defect, like a missing test. (See `contribute-change` Step 7.)

## Quality gates (non-negotiable)

This set mirrors the GitHub CI jobs (`.github/workflows/ci.yml`) and is a
**hard commit gate: every check must pass locally before you commit** — never
commit on a red or unrun gate.

```bash
yarn typecheck
yarn typecheck:emit   # declaration build (CI: typecheck:emit)
yarn lint
yarn format:check
yarn handlers:gen:check
yarn test             # all vitest projects: unit / integration / contract / i18n / tools
yarn test:coverage    # coverage thresholds
yarn knip
yarn security         # audit-ci (HIGH+ advisories)
```

Two CI checks cannot run locally — **`gitleaks`** (secret scan) and **CodeQL** —
and run only on GitHub. A `dev` commit triggers the full CI on push, so after
committing you MUST confirm that CI run is green (`gh run list --branch dev`)
and fix any red immediately — CI is a gate, not a passive signal.

No `--no-verify`, no skipped tests, no loosened assertions. If a gate fails,
root-cause it; do not bypass.

## Commit + PR conventions

- **Commit only when the user explicitly asks — then commit AND push together.** Do not auto-commit (or `git commit --amend`) after making changes, completing a task, or fixing review-gate / stop-hook findings — make the edits, run the gates, report, and wait for an explicit "commit" instruction. When the user does ask you to commit, push the commit to `dev` in the same step — `git push` no longer needs its own authorisation, it is part of the commit action. A one-off "commit this" authorises that commit and its push only, not subsequent ones.
- Commits: small, focused. `<type>(<scope>): <subject>` where `<type>` is `feat`, `fix`, `refactor`, `chore`, `docs`, or `test`.
- Routine `dev` work: **commit directly to `dev` and push** (no per-change branch or PR) — once the user has asked you to commit — but only after the full quality-gate suite (above) passes locally. The push triggers CI; confirm that run is green (`gh run list --branch dev`) and fix any red immediately. PRs are required only for `dev` → `main` releases and hotfixes; optional for large / risky `feature/*` work.

### Branching model (Git Flow)

Two long-lived branches: `main` (released) and `dev` (integration).

- `main` — always equals the released / production state. Every merge into `main` is a release: tag it (`vX.Y.Z`) and cut a GitHub Release. The **only** branch that enforces the full required CI gate set (on the `dev` → `main` release PR).
- `dev` — the integration branch you **commit to directly**. The full quality-gate suite (see "Quality gates") must pass locally before every commit. A `dev` commit triggers CI on push; that CI run is a **required gate** — it must be green, and a red CI is fixed immediately (never left as a passive signal). Branch protection only blocks force-push / deletion.
- `feature/*` (optional) — for large / risky changes or when you want a pre-merge CI gate / review, branch off `dev`, PR back into `dev`, delete on merge. Otherwise commit straight to `dev`.
- Release — open a `dev` -> `main` PR (optionally via a `release/*` stabilisation branch that takes only bug fixes, version bumps, and changelog edits). After merging into `main`, tag + Release, then merge `main` back into `dev` to prevent drift.
- `hotfix/*` — branch off `main` for production-urgent fixes; merge back into both `main` (tag a patch release) and `dev`.
- The `dev` → `main` release PR (and any optional `feature/*` PR) must pass the full required CI gate set before merge.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contributor-facing walkthrough.
