# Project: Discord Bot (TypeScript, Discord.js, MongoDB)

Multi-bot codebase hosting several Discord personalities
(`nijika`, `konata`, `tomori`, `msg-archive`) on a shared layered
core. The architecture-overhaul refactor landed Clean Architecture
layering, a manual IoC container, a plugin host, Repository-pattern
persistence, an LLM provider Strategy, structured errors + Result
types, full i18n routing, and a CJK-literal scanner in strict mode.

For the day-to-day architecture overview, see
[`docs/high-level-design.md`](docs/high-level-design.md). For setup +
contribution flow, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Active engineering: Tech-Debt Cleanup (R1–R6)

The codebase review ([`docs/codebase-review-2026-05.md`](docs/codebase-review-2026-05.md))
identified 6 remediation items (R1–R6) covering BaseBot decomposition,
DI side-channel elimination, plugin/IoC contract alignment, oversized
handler refactoring, i18n path decoupling, and low-priority cleanups.

**Start any new session from [`docs/tasks/README.md`](docs/tasks/README.md)** —
it is the single entry point: workflow, current progress, document
map, dependency order. Progress lives in
[`docs/tasks/progress.md`](docs/tasks/progress.md).

The work is designed to run autonomously: spawn the
`tech-debt-orchestrator` agent and it drives the `r-implementer`
subagents through R1 → R6 in dependency order until every quality
gate is green.

Document chain:

1. [`docs/proposal.md`](docs/proposal.md) — requirements spec (why + what + what-not).
2. [`docs/high-level-design.md`](docs/high-level-design.md) — architectural evolution.
3. [`docs/design.md`](docs/design.md) (index) → [`docs/design/R*.md`](docs/design/) — per-R TypeScript skeletons, patterns, test cases.
4. [`docs/tasks/`](docs/tasks/) — actionable checklists.

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
├── bot/                   # composition roots (R1 decomposes BaseBot here)
│   ├── index.ts                       # BaseBot — thin lifecycle owner
│   ├── guild-registrar.ts             # R1 — channels/roles resolution
│   ├── client-event-bridge.ts         # R1 — Discord raw event fan-out
│   ├── guild-db-connector.ts          # R1 — per-guild Mongo lifecycle
│   ├── nijika/                        # Each bot: index.ts + <name>.ts + config.json
│   ├── konata/
│   ├── tomori/
│   └── msg-archive/
│
└── deploy.ts              # slash-command registration entry point
```

Files marked "R1" are introduced by the current tech-debt cleanup; see
[`docs/design/R1.md`](docs/design/R1.md).

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

Thin lifecycle owner. R1 decomposes it into BaseBot + `GuildRegistrar` +
`ClientEventBridge` + `GuildDbConnector` (see
[`docs/design/R1.md`](docs/design/R1.md)). BaseBot's `run()` orchestrates
the collaborators in order: setup container → setup translator → connect
all guilds' DBs → register all guilds → attach client event bridge →
start plugin host. Subclasses (Nijika/Konata/Tomori/MsgArchive) opt
plugins in via `this.use(...)`.

### Plugin contract (`src/core/plugin/types.ts`)

Each business feature is a `Plugin<Config>` with `id`, SemVer `version`,
`scope` (`'bot'` or `'guild'`), optional `critical` flag, optional
dependencies, an optional zod `configSchema`, lifecycle hooks, event
subscriptions, and a `contributes` block (commands / buttons / modals /
select-menus / reactions / jobs / locale namespaces). Plugins call
`ctx.resolve(TOKENS.X)` to fetch dependencies. R2 adds
`ctx.registerInstance(token, instance)` (init hook only) so plugins
have a legal way to publish constructed objects to the container,
eliminating module-global side-channels. R3 makes `core/plugin` the
only legal import source for `TOKENS` from inside `src/plugins/**`.

### Handler codegen + 150-line cap (R4)

`scripts/gen-registry.ts` scans `src/handlers/<type>/` and writes
`registry.generated.ts` (do not hand-edit). `yarn handlers:gen:check`
runs in CI to fail on drift. R4 caps each handler `index.ts` at 150
lines via ESLint `max-lines`; pure helpers go to sibling files in the
same handler directory.

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
`<namespace>:<feature>.<purpose>`. Zero CJK literals allowed in
`src/handlers/` or `src/plugins/`. R5 makes `LoadCatalogOptions.localesDir`
required so `core/i18n` no longer knows the content layer's path.

### IoC container

`src/core/ioc/container.ts` — manual ~280-line container, typed via
`ServiceToken<T>`. Standard tokens at `src/core/ioc/tokens.ts`. No
`reflect-metadata`, no DI framework. Plugins reach `TOKENS` through
the `core/plugin` barrel (R3); direct import from `core/ioc` is
ESLint-forbidden inside `src/plugins/**`.

> **Plugin 對 IoC 的依賴契約**：plugin 對 IoC 的依賴只能透過 `core/plugin` 取得
> （`import { TOKENS, type ServiceToken } from '<path>/core/plugin'`）。任何 `src/plugins/**` 對
> `core/ioc` 的直接 import 由 ESLint 在 lint 階段擋下。Plugin 可呼叫 `ctx.resolve(token)` 讀取依賴、
> 可在 `init` hook 內呼叫 `ctx.registerInstance(token, instance)` 註冊已建構的實例；不得透過任何
> 方式（包含對 `ctx` 強制 cast）取得 `ServiceContainer` 的寫入面 API。新 token 必須登錄在
> `src/core/ioc/tokens.ts` 中央目錄，再由 `core/plugin` 的 `TOKENS` re-export 自動曝露給 plugin。

## Special bots

### `msg-archive`

Worker-style bot. Suppresses interaction / reaction / guildCreate
listeners on its `BaseBot` subclass and runs the periodic
`MessageBackupPlugin`. Log files: `logs/msg-archive-<guildId>.log`.

### `nijika`

Web-facing bot. Exposes an Express HTTP route at `/discord/earthquake`
that broadcasts a translator-driven alert to every guild's configured
earthquake channel (`EarthquakePlugin`).

## Working in this repo

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full developer flow:
quality gates, the rules a reviewer agent will enforce, step-by-step
recipes for adding a slash command or a plugin.

## Agents and skills

Agent definitions live in `.claude/agents/`.

**Reviewer agents** — Consult / Review / Audit modes; run the relevant
reviewer before committing changes that touch `src/`:

- `architecture-reviewer`
- `type-system-reviewer`
- `reliability-reviewer`
- `test-architect`
- `config-and-security-reviewer`
- `i18n-discipline-reviewer`

**Tech-debt cleanup agents** (drive the R1–R6 work end-to-end):

- `tech-debt-orchestrator` — lead. Reads `docs/tasks/progress.md`, dispatches `r-implementer` in dependency order, monitors and re-dispatches on failure, runs the final cross-R gates, opens the PR.
- `r-implementer` — worker. Takes one R item from `docs/tasks/R<N>.md`, implements per `docs/design/R<N>.md`, runs the full per-R quality gates, syncs the wiki, writes progress back.

Skill definitions live in `.claude/skills/`:

- `r-task-workflow` — the per-R implementation workflow (precondition → understand → plan → implement → self-check → reviewers → quality gates → wiki → commit → report).
- `project-conventions` — architectural framework rules (layer direction, Plugin contract, IoC, Repository, errors, i18n, codegen, naming). Self-check.
- `coding-standards` — code-quality standards (SRP, design patterns, naming, guard clauses, security, errors, comments, testing). Self-check.
- `update-wiki` — auto-syncs `docs/wiki/` on any addition / deletion / modification.

The two convention skills (`project-conventions`, `coding-standards`)
carry self-check lists; apply them whenever writing code under `src/`.
The `update-wiki` skill runs after every R completion and any
structural change so the wiki never drifts from the codebase.

## Quality gates (non-negotiable)

```bash
yarn typecheck       # strict TS
yarn lint            # ESLint
yarn test            # vitest (unit / integration / contract / i18n)
yarn format:check    # prettier
yarn handlers:gen:check
yarn knip
```

No `--no-verify`, no skipped tests, no loosened assertions. If a gate
fails, root-cause it; do not bypass.

## Commit + PR conventions

- Commits: small, focused. Prefix with the R item: `refactor(R<N>): ...` or `fix(R6.<x>): ...`. Always include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- PRs: tech-debt cleanup work merges from `refactor/tech-debt-cleanup` → `refactor/architecture-overhaul`. PR text in English; aggregate per-R highlights mirroring `progress.md`.
