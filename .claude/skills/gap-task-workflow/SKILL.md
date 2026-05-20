---
name: gap-task-workflow
description: Standard workflow for executing a docs/tasks/<component>.md gap-remediation task. The component-implementer subagent follows this to implement each component — read the task and design files, implement, add tests, self-check, consult reviewers, run all quality gates, update the wiki, write progress back. The orchestrator also uses this to judge whether a component is truly done.
---

# Gap-Remediation Task Workflow (gap-task-workflow)

This skill defines the standard process for "implementing one component's
gap-remediation task". Tasks come from [`docs/tasks/`](../../../docs/tasks/) —
one `C<N>-*.md` per component, subtasks as a check list;
[`docs/tasks/progress.md`](../../../docs/tasks/progress.md) is the single source
of truth for progress and dependency order.

## 0. Precondition: confirm work can start

- Read `docs/tasks/progress.md` §4 (task dependency order). Confirm the
  prerequisite components for this component are complete. If not, report back
  to the orchestrator — do not force-start.

## 1. Understand the task

Read, in order:

1. `docs/tasks/C<N>-<name>.md` — this component's subtask check list and
   acceptance criteria.
2. `docs/design/C<N>-<name>.md` — the matching detailed design (class /
   interface signatures, §7 deviations).
3. The collaborating component task files referenced by cross-references.
4. Where needed, the relevant sections of `docs/high-level-design.md` and
   `docs/design/gaps.md`.

## 2. Implement

For each unchecked subtask:

- Before starting, apply the [`project-conventions`] and [`coding-standards`]
  skills.
- Implement strictly per the "design constraints" (if any) and "remediation
  steps" listed in the task file.
- Preserve **behavioral equivalence** (proposal §3.2 non-goal) — the refactor
  must not change the external behavior of the four bots unless the task
  explicitly requires it.
- Before deleting a file / directory, read its contents to confirm; if reality
  contradicts the task description, stop and report instead of guessing.

## 3. Add tests (mandatory for every change)

- New feature / function → happy path + edge cases.
- Bug fix → regression test.
- Refactor → update existing tests to reflect the new structure; do not delete
  tests.
- Public API change → update all affected tests and in-memory fakes in the
  same change.
- Repository changes → add a `mongodb-memory-server` integration test; LLM
  provider changes → add an `nock` contract test; interaction changes → use
  the `test/fixtures/discord/` builders.
- `src/core/**` changes must keep the core coverage thresholds
  (lines/functions/statements 90, branches 89).

## 4. Self-check

Run the self-check lists in [`project-conventions`] §10 and
[`coding-standards`] §9. Fix any failing item.

## 5. Consult reviewer agents

Before delivering, consult the matching reviewer agent (`Review: <files>` or
`Audit: <scope>`):

| component | primary reviewers |
| --------- | ----------------- |
| C1 / C2 / C4 / C5 | type-system-reviewer, architecture-reviewer |
| C3 / C8 / C11 | architecture-reviewer, reliability-reviewer |
| C5 (D5 retry) / C8 (reboot) | reliability-reviewer |
| C6 / C7 (D7 / D9) | i18n-discipline-reviewer, architecture-reviewer |
| C10 | config-and-security-reviewer |
| all tests | test-architect |

A `BLOCK` verdict must be fixed and re-reviewed; a `WARN` must be addressed or
the reason for not addressing it explicitly recorded.

## 6. Run quality gates

After this component's changes, run the relevant gates; all must be **green**
before the component is marked done:

```bash
yarn typecheck          # strict typecheck
yarn typecheck:emit     # full-src emit typecheck (catches cross-file signature breakage)
yarn lint
yarn format:check
yarn handlers:gen:check # if src/handlers/ was touched
yarn knip
yarn test
yarn test:coverage      # coverage thresholds
yarn test:i18n          # if catalog / handler strings were touched
```

A red gate must be fixed and re-run; never deliver with a red gate.

## 7. Update the wiki

Whenever code / docs are added, deleted, or modified, apply the
[`update-wiki`] skill to sync `docs/wiki/`. **This is mandatory, never skip it.**

## 8. Write progress back

- In `docs/tasks/C<N>-*.md`, change completed-and-accepted subtasks from `[ ]`
  to `[x]`.
- Once all subtasks for the component are complete and the §6 gates are green,
  report to the orchestrator; the orchestrator checks off the component in
  `progress.md` §2.

## Definition of Done (per component)

A component counts as done only when **all** of the following hold:

1. Every subtask in the task file is `[x]` with its acceptance criteria met.
2. All relevant quality gates in §6 are green.
3. No unresolved `BLOCK` from the reviewer agents.
4. `docs/wiki/` is synced.
5. Behavioral equivalence is not broken (unless the task explicitly requires it).

Do **not** mark a component done unless all five hold.
