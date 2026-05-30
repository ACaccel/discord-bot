---
name: contribute-change
description: Standard workflow to add / delete / modify code or docs in this repo: understand the area, plan, implement, self-check against project-conventions and coding-standards, run quality gates, update the wiki and changelog, commit.
---

# Contribute a Change (contribute-change)

This skill is the standard end-to-end workflow for any contribution
under this repo — adding a slash command, adding a plugin, refactoring
a core module, updating config, or editing public docs. Follow the
eight steps in order. Do not skip a step to save time; each one
prevents a class of regression.

Authoritative public sources:
[`README.md`](../../../README.md),
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md),
[`CLAUDE.md`](../../../CLAUDE.md),
[`docs/architecture.md`](../../../docs/architecture.md),
[`docs/wiki/components/`](../../../docs/wiki/components/).

## Step 1 — Understand the area

- Read the relevant component page under `docs/wiki/components/`.
- Read `docs/architecture.md` for the layer in which the change lands.
- Use `Read` / `Grep` / `Glob` to locate the files involved; map every
  inbound import to a layer; identify the contract you are changing.

## Step 2 — Plan

Decide before writing:

- Which layer the change lives in (core / persistence / infra /
  handlers / plugins / bot / scripts / docs / config).
- The smallest set of files that must change.
- The smallest set of tests that must be added or updated.
- Whether the change is structural (interface, dependency, public
  contract, file or directory rename) — if yes, the wiki must be
  synced in step 7.

## Step 3 — Implement

- Apply the rules in [`project-conventions`](../project-conventions/SKILL.md)
  while writing: layer direction, plugin contract, IoC contract,
  Repository pattern, error tree + Result, i18n routing, handler
  codegen + 150-line rule, directory naming, the three load-bearing
  CONTRIBUTING.md rules.
- Apply the rules in [`coding-standards`](../coding-standards/SKILL.md):
  SRP, design-pattern justification, naming, guard clauses, security,
  structured errors, comments, testing discipline.
- After adding or deleting a handler, run `yarn handlers:gen`.

## Step 4 — Self-check

Walk through the section 10 list of `project-conventions` and the
section 9 list of `coding-standards`. Treat any failing item as a
defect and fix it before continuing.

## Step 5 — Dispatch reviewers

Pick the reviewer agents whose scope matches the changed files and
run them in `Audit:` or `Review:` mode against the diff. Reviewer
selection guide:

| Change touches                                    | Reviewer                     |
| ------------------------------------------------- | ---------------------------- |
| `src/core/` or `src/bot/` or new / deleted module | architecture-reviewer        |
| TypeScript types, generics, Result, unions        | type-system-reviewer         |
| Retry, lifecycle, async, partial failure          | reliability-reviewer         |
| Tests or quality gates                            | test-architect               |
| `package.json` / CI / ESLint / tsconfig / secrets | config-and-security-reviewer |
| `src/i18n/locales/` or user-facing strings        | i18n-discipline-reviewer     |

Resolve any BLOCK finding before moving on; treat WARN seriously.

## Step 6 — Run quality gates

Run, until each is green:

```bash
yarn typecheck
yarn lint
yarn test
yarn format:check
yarn handlers:gen:check
yarn knip
```

Do not bypass `--no-verify`, do not skip tests, do not loosen a
threshold. Root-cause any failure.

## Step 7 — Update wiki and changelog (if structural)

If the change is structural (file added / deleted / renamed, public
interface or contract changed, config / CI / quality rule changed,
or any `docs/` file changed), follow
[`update-wiki`](../update-wiki/SKILL.md) within the same unit of work
— update the affected component pages, append a CHANGELOG entry,
refresh the Home index.

## Step 8 — Commit (only when the user asks)

- **Do not commit until the user explicitly asks.** Finish the edits,
  run the gates (Step 6), update docs (Step 7), report what changed, and
  stop. Do not auto-commit on task completion or after fixing
  review-gate / stop-hook findings; do not `git commit --amend` a prior
  commit without being asked. A one-off "commit" request covers that
  commit only.
- When asked: produce a small, focused commit. Subject prefix follows
  the conventional-commits style used in this repo (`feat` / `fix` /
  `refactor` / `chore` / `docs` / `test`).
- Commit message body explains the why, not the what.
- Include `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Do not push or open a PR unless the user explicitly asks.
