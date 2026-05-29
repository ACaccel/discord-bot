# Discord Bot — Repo Wiki

A living component-by-component map of the codebase. Pages here
describe **what each component does today**; for the broader
architecture overview see [`docs/architecture.md`](../architecture.md),
and for the contributor workflow see [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Project overview

A TypeScript + discord.js + MongoDB multi-personality Discord bot
codebase. A single shared core hosts four built-in personalities —
`nijika`, `konata`, `tomori`, `msg-archive`. The architecture is
layered (`bot → handlers / plugins → persistence / infra → core`)
with the dependency direction enforced by ESLint. Plugins extend the
bot through a topologically-ordered lifecycle and a typed IoC
container.

## Component pages

| Component | Name                  | Path                | Page                                                                               |
| --------- | --------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| C1        | Core Infrastructure   | `src/core/`         | [components/C1-core-infrastructure.md](components/C1-core-infrastructure.md)       |
| C2        | IoC Container         | `src/core/ioc/`     | [components/C2-ioc-container.md](components/C2-ioc-container.md)                   |
| C3        | Plugin Runtime        | `src/core/plugin/`  | [components/C3-plugin-runtime.md](components/C3-plugin-runtime.md)                 |
| C4        | Persistence           | `src/persistence/`  | [components/C4-persistence.md](components/C4-persistence.md)                       |
| C5        | Infra Adapters        | `src/infra/`        | [components/C5-infra-adapters.md](components/C5-infra-adapters.md)                 |
| C6        | Handlers              | `src/handlers/`     | [components/C6-handlers.md](components/C6-handlers.md)                             |
| C7        | i18n Catalog          | `src/i18n/locales/` | [components/C7-i18n-catalog.md](components/C7-i18n-catalog.md)                     |
| C8        | Plugins               | `src/plugins/`      | [components/C8-plugins.md](components/C8-plugins.md)                               |
| C9        | Codegen & Scripts     | `scripts/`          | [components/C9-codegen-scripts.md](components/C9-codegen-scripts.md)               |
| C10       | Quality Gates         | CI / config         | [components/C10-quality-gates.md](components/C10-quality-gates.md)                 |
| C11       | Bot Composition Roots | `src/bot/`          | [components/C11-bot-composition-roots.md](components/C11-bot-composition-roots.md) |

## Ops runbooks

- [verify-db](ops/verify-db.md) —
  read-only validity checker for a guild's `messages` collection
  (null / empty / duplicate `messageId`, missing `channelId` /
  `userId` / `userName`, invalid `timestamp`).
- [msg-backup](ops/msg-backup.md) — full re-ingest of a guild's
  message history from Discord; backfills missing `messageId`s,
  removes leftover bot messages, repairs duplicates.

## See also

- [Architecture overview](../architecture.md)
- [Contributing guide](../../CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
