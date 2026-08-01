# BotFleet — Project Status

Single source of truth for project handoff. **Current state only** — design
reasoning lives in [`docs/history/`](history/README.md), and the architecture
detail lives in [`docs/architecture.md`](architecture.md). This file links to
them rather than duplicating either.

## Overview

BotFleet is a multi-personality Discord bot framework (TypeScript, discord.js,
MongoDB) with a layered plugin architecture, a typed manual IoC container,
Repository-pattern persistence, an LLM-provider Strategy layer, full i18n
routing, and a CJK-literal scanner enforced in strict mode. See
[`README.md`](../README.md) for the feature tour.

## Current State

### Done (shipped)

- `permission_rank` privacy / clearance model — per-guild channel/user ranks
  replacing the bot-wide `blocked_channels` list
  (→ [0001](history/0001-permission-rank-privacy-model.md)), extended to fold
  over the full channel ancestry
  (→ [0002](history/0002-channel-aware-full-ancestry-rank.md)).
- `/traffic` and `/traffic_me` message-traffic stats commands (nijika), gated by
  the dual `permission_rank` + native `ViewChannel` visibility filter.
- `migrate_timestamp` ops tool
  (→ [0003](history/0003-migrate-timestamp-numeric-migration.md)) and
  index-served `Message.timestamp` range reads
  (→ [0004](history/0004-index-served-timestamp-range-reads.md)).
- `gopher` personality (database-free): self-hosted-LLM auto-reply, an
  owner-only settings REST API, and a daily identity sync.
- `social-link-preview` plugin (nijika): Twitter/X, Instagram, Threads,
  Facebook, Reddit, and Bahamut providers.
- `tomori` public personality upgraded: now loads the `social-link-preview`
  and `temp-role` plugins (the `/temp_role` command) and registers a custom
  ready-time Discord presence — nijika's interactive set minus the
  self-guild-only surfaces (earthquake webhook, level-role sync).
- Transient-network resilience
  (→ [0005](history/0005-transient-network-resilience.md)): the Discord client
  gains non-fatal `error` / `shardError` / `shardDisconnect` listeners and the
  `uncaughtException` net tolerates a whitelisted transient blip
  (`isTransientNetworkError`) instead of shutting the bot down; `message-backup`'s
  repeat loop is failure-isolated.
- Unified `db` ops CLI (`tools/db/`, `yarn db <subcommand>`): consolidates the
  former `verify_db` / `migrate_timestamp` / `drop_todo_collection` tools behind
  one extensible Strategy + registry, one shared connection/config/logging layer,
  and a single `config.json` (shared block + per-operation `operations` map). The
  standalone `yarn <tool>` scripts and their directories were removed (breaking).

### In progress

- None tracked. Record work here as it starts.

### Next

- No committed roadmap items. Capture new initiatives here and, once decided,
  as a `docs/history/` entry.

## Architecture

Six layers — `core` → `persistence` / `infra` → `handlers` / `plugins` → `bot`
— with the dependency direction enforced by ESLint. The full layer table, key
abstractions, request flow, plugin lifecycle, and design trade-offs are in
[`docs/architecture.md`](architecture.md); the component-by-component map is in
[`docs/wiki/`](wiki/Home.md). Not repeated here.

## Conventions

Authoritative homes (pointers, not restated):

- Architectural rules, quality gates, commit + branching model →
  [`CLAUDE.md`](../CLAUDE.md).
- Contribution recipes, the 150-line handler cap, i18n discipline →
  [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Decision records → [`docs/history/`](history/README.md).

## Environment & Setup

- Node `>=22.13.0` (`.nvmrc`: `22.13.0`), Yarn 1 (classic), MongoDB (optional
  per personality — a database-free personality boots with an empty
  `MONGO_URI`).
- Configuration is per-personality: `src/bot/<name>/config.json` (gitignored;
  seed from the checked-in `config.example.json`) and `src/bot/<name>/.env`. The
  env contract's source of truth is the zod schema in
  [`src/core/config/env.ts`](../src/core/config/env.ts); the variable table is in
  [`README.md`](../README.md) §Configuration.
- Bootstrap: `yarn install-lock`, then run a personality with `yarn <name>`
  (`tomori` / `nijika` / `konata` / `gopher` / `msg-archive`); register slash
  commands with `yarn deploy`. The quality-gate suite is in
  [`CLAUDE.md`](../CLAUDE.md) under "Quality gates".

## Open Problems

- No root `.env.example` (deferred in
  [0000](history/0000-adopt-doc-standard-structure.md)). The env contract lives
  in the zod schema and the README table; a per-personality, schema-derived
  template is the right shape if one is ever wanted.
- No known blockers otherwise.

## Decision Index

Mirror of [`docs/history/README.md`](history/README.md):

| #    | Topic                                             | Status   |
| ---- | ------------------------------------------------- | -------- |
| 0000 | Adopt the global documentation-standard structure | accepted |
| 0001 | `permission_rank` privacy / clearance model       | accepted |
| 0002 | Channel-aware visibility and full-ancestry rank   | accepted |
| 0003 | `migrate_timestamp` numeric-timestamp migration   | accepted |
| 0004 | Index-served `Message.timestamp` range reads      | accepted |
| 0005 | Tolerate transient network resets, not crash      | accepted |
