# C10 — Quality Gates

## Responsibility

Cross-cutting CI enforcement of repo-wide quality. Every gate is non-negotiable: no `--no-verify`, no skipped tests, no loosened assertions. A failing gate is root-caused, not bypassed.

## The gates

| Gate              | Command                   | Enforces                                                                                                                                                                                            |
| ----------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck         | `yarn typecheck`          | Strict TypeScript over the whole `src/` tree (`tsconfig.strict.json` includes `src/**/*`, all path aliases populated).                                                                              |
| Typecheck (emit)  | `yarn typecheck:emit`     | Verifies emit-mode typecheck stays green for the deploy build path.                                                                                                                                 |
| Lint              | `yarn lint`               | ESLint, including the `src/handlers/**` 150-line `max-lines` cap, `src/plugins/**` ban on importing `core/ioc`, `no-console: error` (test / scripts overrides to `off`), and `import/first: error`. |
| Format            | `yarn format:check`       | Prettier.                                                                                                                                                                                           |
| Codegen drift     | `yarn handlers:gen:check` | Re-runs `scripts/gen-registry.ts` and fails if any `registry.generated.ts` differs from the committed version.                                                                                      |
| Knip              | `yarn knip`               | Unused exports / files / dependencies.                                                                                                                                                              |
| Unit tests        | `yarn test:unit`          | Fast, hermetic.                                                                                                                                                                                     |
| Integration tests | `yarn test:int`           | Mongo and Discord adapter integration.                                                                                                                                                              |
| Contract tests    | `yarn test:contract`      | Plugin and repository contract conformance.                                                                                                                                                         |
| i18n tests        | `yarn test:i18n`          | Catalog parity, placeholder parity, and the CJK literal scanner over `src/handlers/`, `src/plugins/`, `src/bot/`.                                                                                   |
| Coverage          | `yarn test:coverage`      | Coverage thresholds per layer.                                                                                                                                                                      |
| Security          | `yarn security`           | Dependency advisories — `audit-ci` fails on HIGH / CRITICAL.                                                                                                                                        |
| Smoke             | `yarn smoke`              | Manual pre-deploy probe (env, catalogs, command payload). Not part of CI.                                                                                                                           |

## Notes

The CJK scanner (`test/i18n/no-literal-cjk.test.ts`) only scans `src/handlers/`, `src/plugins/`, and `src/bot/`. Catalog JSON files under `src/i18n/locales/` are content and are deliberately out of scope.

The security gate's accepted-advisory allowlist lives in `audit-ci.jsonc`, which carries its own policy header: every entry is `GHSA-…|path>chain`-scoped (so the same GHSA arriving by a different path is not silently allowed) and must state the offending tree, why it is acceptable, and a remediation plan. An advisory fixable by a dependency upgrade — including a transitive one whose patch lands inside the range already required, which `yarn.lock` re-resolution picks up without a `resolutions` override — is fixed at source rather than allowlisted, and an entry is dropped as soon as upstream ships the fix.
