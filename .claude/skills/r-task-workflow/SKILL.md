---
name: r-task-workflow
description: Standard workflow for executing a docs/tasks/R<N>.md tech-debt-cleanup task. The r-implementer subagent follows this to implement each R item — read inputs, plan, implement to design, self-check against conventions, consult reviewers, run quality gates, sync wiki, commit, report. The orchestrator also uses this to judge whether an R is truly done.
---

# R Task Workflow

This skill defines the standard process for implementing one R item from
[`docs/tasks/`](../../../docs/tasks/) — one `R<N>.md` per item, subtasks as
a check list; [`docs/tasks/progress.md`](../../../docs/tasks/progress.md) is
the single source of truth for state and dependency order.

## 0. Precondition: confirm work can start

- Read `docs/tasks/progress.md` and verify that all prerequisite R rows are `- [x]`.
- Dependency order is **R1 → R2 → R3 → R4 → R5 → R6** (see [`docs/proposal.md`](../../../docs/proposal.md) §3 and [`docs/high-level-design.md`](../../../docs/high-level-design.md) §3).
- If prerequisites are missing, stop and report back to the orchestrator. Do not force-start.

## 1. Understand the task

Read, in order:

1. `docs/tasks/R<N>.md` — this R's subtask check list.
2. `docs/design/R<N>.md` — TypeScript skeletons, contracts, test cases, pattern adoption rationale. **Implement to this design without re-debating it.**
3. `docs/proposal.md` (corresponding §) — consult only if the design is ambiguous.
4. `docs/high-level-design.md` (corresponding §) — for cross-R integration points.

Then convert the unchecked items in `docs/tasks/R<N>.md` into a TodoWrite plan so progress is visible.

## 2. Implement

- Follow the design's class skeletons / interface signatures verbatim. Do not invent new public surface.
- Prefer TDD where the design supplies concrete test cases: write the test, watch it fail, implement, watch it pass.
- One subtask at a time. Mark TodoWrite items completed as you finish each.

## 3. Self-check against project skills

For every file you add or change, walk through the rules in:

- `.claude/skills/project-conventions/SKILL.md` — architectural framework rules (layer dependency direction, Plugin contract, IoC, Repository, errors, i18n, codegen, naming).
- `.claude/skills/coding-standards/SKILL.md` — code quality (SRP, design patterns, naming, guard clauses, security, structured errors, comments, testing discipline).

Treat any violation as a defect. Fix before moving on.

## 4. Consult reviewer agents

After a logical chunk (typically one collaborator class, one ESLint rule + its consumer fixes, one handler decomposition), Consult the matching reviewer agent(s):

| R    | Reviewers to consult                                                    |
| ---- | ----------------------------------------------------------------------- |
| R1   | `architecture-reviewer`, `reliability-reviewer`, `test-architect`       |
| R2   | `architecture-reviewer`, `reliability-reviewer`, `type-system-reviewer` |
| R3   | `architecture-reviewer`, `config-and-security-reviewer`                 |
| R4   | `test-architect`, `architecture-reviewer`                               |
| R5   | `architecture-reviewer`, `type-system-reviewer`                         |
| R6.2 | `reliability-reviewer`                                                  |
| R6.3 | `config-and-security-reviewer`                                          |

Address every WARN / FAIL. Re-Consult until PASS.

## 5. Quality gates

Run these commands; **all must be green** before the R can be marked done:

```bash
yarn typecheck       # strict TS
yarn lint            # ESLint (handlers max-lines, plugin no-restricted-imports, etc.)
yarn test            # vitest projects: unit / integration / contract / i18n
yarn format:check    # prettier
yarn handlers:gen:check
yarn knip            # if knip says unused, prove the export is required or remove
```

No skipping, no `--no-verify`. If a gate fails, root-cause it; do not loosen the gate.

## 6. Sync the wiki

After any addition / deletion / modification of code or top-level docs, invoke the
[`update-wiki`](../update-wiki/SKILL.md) skill so `docs/wiki/` stays consistent. This includes:

- Component pages affected by the change.
- `docs/wiki/CHANGELOG.md` — append an entry for the R you just finished.
- `docs/wiki/Home.md` — update the index if file structure changed.

## 7. Commit

- **Small, focused commits**. One collaborator, one ESLint rule + its fixes, one handler split = one commit.
- Prefix: `refactor(R<N>): <imperative summary>` or `fix(R6.<x>): ...`.
- Include `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` (per CLAUDE.md).
- Never `--no-verify`. If a pre-commit hook fails, fix the issue and create a new commit.

## 8. Update progress + report

- Flip every `- [ ]` to `- [x]` in `docs/tasks/R<N>.md` as you finish each subtask (and the heading row in `docs/tasks/progress.md` only when ALL subtasks are done AND all gates green).
- Return a concise report to the orchestrator: what changed, which commits, which gates pass, any caveat or follow-up.

## "Done" checklist (for orchestrator to verify)

An R is **only** done when ALL of these hold:

- [ ] Every subtask in `docs/tasks/R<N>.md` is `- [x]`.
- [ ] `docs/tasks/progress.md` row for the R is `- [x]`.
- [ ] All quality gates from §5 are green.
- [ ] Reviewers from §4 returned PASS.
- [ ] `docs/wiki/` was synced (CHANGELOG entry present for this R).
- [ ] Branch has well-prefixed commits.

If any line above is `[ ]`, the R is **not** done — re-dispatch.
