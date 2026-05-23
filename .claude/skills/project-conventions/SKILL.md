---
name: project-conventions
description: Architectural framework and rules for the discord-bot project. Read and apply before adding, deleting, or modifying any code under src/ — layer dependency direction, Plugin contract, IoC container, Repository pattern, error tree and Result, i18n routing, handler codegen, directory naming. Self-check every item while writing; a violation is a defect.
---

# Project Framework and Rules (project-conventions)

This skill is the **framework contract** for the post-refactor discord-bot
codebase. Every piece of code produced under `src/` must comply. Read this file
before writing; after writing, verify each item in the §10 self-check list.

Authoritative sources: [`docs/high-level-design.md`](../../../docs/high-level-design.md),
[`docs/design/`](../../../docs/design/), [`CLAUDE.md`](../../../CLAUDE.md),
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md). When this file conflicts with the
design documents, the design documents win.

## 1. Layering and dependency direction (hard rule)

Dependencies flow one way, downward. No reverse edges, no layer-skipping:

```
bot → plugins → handlers → infra → persistence → core
```

| Layer | Path | May import | Must NOT import |
| ----- | ---- | ---------- | --------------- |
| core | `src/core/` (excl. ioc/plugin) | stdlib, zod, i18next, pino, dotenv | any other `src/` module, discord.js (type-only excepted), mongoose, LLM SDKs |
| ioc | `src/core/ioc/` | core types, infra/persistence types (type-only) | concrete implementations |
| plugin runtime | `src/core/plugin/` | core siblings, ioc | persistence, infra |
| persistence | `src/persistence/` | core, mongoose, `GuildConnection`/error-translator from `infra/mongo` | discord.js, LLM SDKs |
| infra | `src/infra/` | core, `persistence/schemas`, the SDKs | handlers, plugins, bot |
| handlers | `src/handlers/` | core, persistence (types), infra, `@core/*`, `@bot` (type-only) | concrete bot implementations |
| interface | `src/i18n/` | nothing (pure JSON catalog) | — |
| plugins | `src/plugins/` | core, persistence, infra, handlers, `@bot` | another plugin's internals |
| bot | `src/bot/` | all of the above (the only layer that may import `core/ioc`) | — |

- `core/` is a leaf: **zero in-`src/` dependencies**.
- Only `src/bot/**` (composition roots) and `test/**` may import
  `src/core/ioc`; all other layers are blocked by the ESLint
  `no-restricted-imports` rule. Layered code receives dependencies via
  constructor injection.
- Known real edges: `infra/mongo` → `persistence/schemas` (builds the model
  registry); `persistence` → `GuildConnection` from `infra/mongo`. Verify the
  direction is legal before adding a new dependency.

## 2. Plugin contract

Business features are always a `Plugin<Config>` (`src/core/plugin/types.ts`).
There is **no business-behavior carrier outside the plugin layer**; `BaseBot`
is not subclassed to carry behavior.

- Required: `id`, SemVer `version`, `scope` (`'bot'` | `'guild'`).
- Optional: `critical`, `dependencies`, `configSchema`, lifecycle hooks
  (`init`/`start`/`onReady`/`onShutdown`), `events`, `contributes`.
- Dependencies are obtained via `ctx.resolve(TOKENS.X)`; **Service Locator is
  forbidden inside runtime hooks** — a plugin never gets the raw container.
- Factory form `create<X>Plugin(config)` returns an independent instance with
  isolated closure state.

## 3. IoC container

- `ServiceToken<T>` is typed; tokens are centralised in the `TOKENS` table at
  `src/core/ioc/tokens.ts` — register new dependencies there.
- Do not introduce `reflect-metadata` or any third-party DI framework.
- A factory receives only `Resolver` (no register); the composition root
  receives `ServiceContainer`.

## 4. Repository pattern

- Data access goes through `persistence/repositories/<x>.repo.ts`:
  `interface XRepo` + `class MongoXRepo implements XRepo`.
- Consumers depend on the **interface**; tests inject in-memory fakes.
- Stringly-typed lookups such as `db.models["X"]` are forbidden.
- `buildRepos(connection)` returns the `Repos` bundle bound to a guild
  connection.

## 5. Error tree and Result

- infra / persistence failures throw `DomainError` subclasses
  (`ValidationError`, `NotFoundError`, `ConflictError`, `PermissionError`,
  `ExternalServiceError` → `DiscordApiError`/`DatabaseError`/`LlmProviderError`,
  `ConfigurationError`). **Never `throw new Error()` / `throw new TypeError()`
  to express a domain failure.**
- Every `DomainError` carries `code`, `messageKey`, `messageParams`,
  `context`, `cause`.
- Programmer errors (contract violations, invariant breaches) use native
  `TypeError`/`RangeError` — they do **not** enter `Result` and do not route
  through i18n.
- Use-case boundaries pass `Result<T, DomainError>`; a function returning
  `Result` must not throw `DomainError`.

## 6. i18n routing

- User-facing text always goes through `Translator` + catalog; `src/handlers`,
  `src/plugins`, `src/bot` contain **zero CJK literals**.
- Catalogs live at `src/i18n/locales/<lang>/{commands,errors,replies}.json`
  with key format `<namespace>:<feature>.<purpose>`.
- A new catalog key must be added to **every locale** (`zh-TW` and `en`),
  otherwise the catalog-completeness test fails.
- Operator-facing log / thrown messages are centralised as constants, not
  scattered English literals.

## 7. Handler codegen

- `src/handlers/<type>/<name>/index.ts` contains `export default class`.
- `registry.generated.ts` is a pure generated artifact — **never hand-edit**;
  run `yarn handlers:gen` after adding a handler. CI `handlers:gen:check`
  detects drift.

## 8. Directory and naming

- bot and handler-type directories are kebab-case; handler subdirectories are
  snake_case and equal the Discord command name.
- Where a design pattern is applied, add a short comment stating which pattern
  and why (CLAUDE.md).

## 9. Transitional layers being retired (do not extend)

- `src/events/`, `src/utils/`, and the `@event`/`@utils` aliases are being
  retired (see `docs/tasks/`). **Do not add code in these locations**; new
  logic belongs in a proper component.

## 10. Post-writing self-check list

After producing any `src/` code, verify each item:

- [ ] All imports obey the §1 direction — no reverse edge, no layer-skipping
- [ ] No raw container access inside a plugin runtime hook (§2)
- [ ] New dependencies registered in the `TOKENS` table, injected via
      constructor / `ctx.resolve` (§3)
- [ ] Data access goes through a repository interface, no stringly-typed lookup (§4)
- [ ] Domain failures throw `DomainError` subclasses, not raw `Error`;
      programmer errors use `TypeError` (§5)
- [ ] User-facing text uses i18n keys, no CJK literal; new keys exist in both
      locales (§6)
- [ ] Codegen re-run after adding a handler; no hand-edit of `*.generated.ts` (§7)
- [ ] Directory / naming follows §8; pattern usages are commented
- [ ] No new code added under `src/events/` or `src/utils/` (§9)

Fix any failing item before delivering.
