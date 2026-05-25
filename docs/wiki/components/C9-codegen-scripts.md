# C9 — Codegen and Scripts

## Responsibility

Build-time tooling. Nothing under `scripts/` runs at production runtime. Two scripts plus the small `src/deploy.ts` entry point.

## Key files

- `scripts/gen-registry.ts` — scans `src/handlers/<type>/<name>/` folders and emits `src/handlers/<type>/registry.generated.ts`. Run by `yarn handlers:gen`; `yarn handlers:gen:check` runs the same generator and fails CI if the committed output drifts from the source.
- `scripts/smoke.ts` — pre-deploy probe that validates environment configuration, catalog completeness, and slash-command payload shape before a deploy is initiated. Invoked manually (`yarn smoke`); not part of the automated CI gate.
- `src/deploy.ts` — slash-command registration entry point. Uses `createBootstrapLogger` from `src/core/config/bootstrap-logger.ts` so all status / warn / error / fatal output is structured pino. The locales directory is injected explicitly via `resolveLocalesDir()` from `src/bot/locales-dir.ts`.

## Boundary

`scripts/` must not be imported by anything in `src/`. Logic that needs to run at both build time (`deploy.ts`) and runtime (handler registration) lives under `src/handlers/commands/` and is consumed from both sides — for example, `buildCommandJsonBody` in `src/handlers/commands/command-builder.ts` is used by `deploy.ts` and by the runtime registration path, because its input type `LocalizedCommandConfig` is a handler-layer contract.
