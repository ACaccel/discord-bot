<!--
  Fill every section. Empty sections will be rejected. See
  CONTRIBUTING.md for the full submission flow.
-->

## Summary

<!-- 1–3 bullets. State *what changes* and *why* — not how. -->

-
-

## Scope checklist

Check every box that applies. If a layer is untouched, leave the box
unchecked rather than deleting the line.

- [ ] `src/core/`
- [ ] `src/persistence/` (schemas / repositories)
- [ ] `src/infra/` (mongo / llm)
- [ ] `src/handlers/` (commands / buttons / modals / select-menus / reactions)
- [ ] `src/plugins/`
- [ ] `src/bot/<name>/` (composition root)
- [ ] `src/i18n/locales/` (new or modified i18n keys)
- [ ] `package.json` / `yarn.lock` / `audit-ci.jsonc`
- [ ] `.github/workflows/`
- [ ] `tsconfig*` / `eslint.config.mjs` / `vitest.config.ts`
- [ ] Tests added or updated
- [ ] Docs (`docs/` / `README.md` / `CONTRIBUTING.md` / `CLAUDE.md`)

## Test plan

<!--
  List the commands you ran locally, and the manual smoke steps if any.
  If a gate was skipped, say why.
-->

- [ ] `yarn typecheck`
- [ ] `yarn lint && yarn format:check`
- [ ] `yarn handlers:gen:check`
- [ ] `yarn test:unit`
- [ ] `yarn test:int`
- [ ] `yarn test:contract`
- [ ] `yarn test:i18n`
- [ ] `yarn test:tools`
- [ ] Manual smoke against a dev guild (describe what you invoked)

## Reviewer-agent results

Paste the verdicts from any reviewer agent you ran. A `BLOCK` from any
agent must be resolved before merge; a `WARN` must be acknowledged in
this PR description or tracked in a follow-up issue.

- architecture-reviewer:
- type-system-reviewer:
- reliability-reviewer:
- test-architect:
- config-and-security-reviewer:
- i18n-discipline-reviewer:

## Rollback plan

<!--
  Describe what a revert looks like. If this PR is part of a multi-PR
  feature, note which sibling PRs need reverting too.
-->

## Linked issues / context

<!-- Discord threads, plan sections, prior PRs, etc. -->
