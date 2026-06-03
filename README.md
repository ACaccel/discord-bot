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
- **Plugin system** with topological dependency resolution, zod-validated config, and a four-phase lifecycle (`init`, `start`, `onReady`, `onShutdown`).
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
| `nijika`      | `yarn nijika`      | Web-facing; exposes an Express `/discord/earthquake` webhook |
| `konata`      | `yarn konata`      | Full interactive feature set                                 |
| `tomori`      | `yarn tomori`      | Full interactive feature set                                 |
| `msg-archive` | `yarn msg-archive` | Worker-style; runs only the message-backup plugin            |

## Features

- Slash commands, buttons, modals, select menus, and reaction handlers.
- Multi-provider LLM chat with web-search toggle and per-user session persistence.
- Voice channel recording.
- Message backup to MongoDB.
- Giveaways with reaction-driven winner selection.
- Per-member activity tracking.
- Social-media share-link previews (Twitter/X, Instagram, Threads, Facebook, Bahamut) with original-embed suppression.
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

### `config.json`

Per-personality static configuration. Every personality ships a
checked-in `config.example.json` — copy it, fill in the real IDs, and
keep your `config.json` out of git (it is `.gitignore`d). The four
top-level keys are:

- `guilds` — every guild the bot serves; each entry maps named
  `channels` and `roles` (e.g. `"debug"`, `"admin"`) to real Discord
  IDs so handlers can look them up by name.
- `commands` — the slash commands this personality should register.
- Personality-specific extras (e.g. `blocked_channels`, `level_roles`).

## Adding a command, button, modal, or plugin

See [`CONTRIBUTING.md`](CONTRIBUTING.md) — it documents the recipe,
the 150-line cap for handler `index.ts`, the i18n discipline, the
plugin / IoC contract, and the quality gates.

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

```bash
yarn typecheck         # strict TypeScript over the whole src/
yarn lint              # ESLint
yarn test              # vitest — unit, integration, contract, i18n
yarn format:check      # prettier
yarn handlers:gen:check # handler codegen drift check
yarn knip              # dead code / unused exports
```

## Contributing

Bug reports, feature suggestions, and pull requests are welcome. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md) first; it covers the local setup,
the quality gates that must pass before review, and the architectural
rules a reviewer will hold you to. By participating you agree to the
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Security

To report a security vulnerability, please follow the process in
[`SECURITY.md`](SECURITY.md). Do not open public issues for security
problems.

## License

MIT — see [`LICENSE`](LICENSE).
