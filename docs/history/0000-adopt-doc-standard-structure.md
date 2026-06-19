# 0000 - Adopt the global documentation-standard structure

- Date: 2026-06-19
- Status: accepted
- Supersedes: -

## Context

The global engineering standard (`~/.claude/CLAUDE.md`) prescribes a fixed
project-documentation layout: an authoritative `docs/STATUS.md` handoff file, a
`docs/history/` decision log (one file per decision plus an index), a
Keep a Changelog `CHANGELOG.md`, and a project `CLAUDE.md` carrying a tech-stack
list, a regulated command cheat sheet, and pointers to the key documents.

BotFleet already satisfied most of this — `README.md`, `CONTRIBUTING.md`,
`docs/architecture.md`, the root `CHANGELOG.md`, and the `docs/wiki/` component
map — but was missing `docs/STATUS.md` and `docs/history/`, and the project
`CLAUDE.md` lacked the regulated cheat sheet, an explicit tech-stack version
block, and pointers to STATUS / history. Design rationale was also scattered:
the `permission_rank` engineering proposal lived only in `docs/proposal.md`, a
local-only working document that has been gitignored — kept out of version
control — since `1.0.0`. Its design verdicts and rejected options therefore sat
outside the tracked documentation entirely.

## Options considered

- A. Leave the docs as-is. Rejected: STATUS and history are hard requirements of
  the global standard, and the `permission_rank` design rationale would stay
  trapped in a gitignored, local-only file, outside version control.
- B. Introduce a standalone `docs/design.md` for design trade-offs. Rejected: the
  global standard allows a small project to fold design into an
  `architecture.md` section, and a second parallel design file would be a third
  surface to keep in sync against the project's own doc-sync discipline.
- C. Add a root `.env.example`. Deferred (not rejected outright): env is
  per-personality (`src/bot/<name>/.env`) and its source of truth is the zod
  schema in `src/core/config/env.ts` plus the README §Configuration table; a
  hand-written root example would be a redundant copy and would misrepresent the
  per-personality layout. If pursued later it should be a per-personality,
  schema-derived template under its own decision.
- D. Adopt the full global structure: create `docs/STATUS.md`, establish
  `docs/history/` (an index plus the backfilled decisions), fold a "Design
  trade-offs" section into `architecture.md`, and extend `CLAUDE.md` with the
  tech-stack block, the cheat sheet, and key-document pointers. Chosen.

## Decision

Adopt option D. Backfill the four already-shipped decisions of 2026-06-18 as
`0001`–`0004` so the history is non-empty and traceable; lift the
`permission_rank` design rationale out of the local-only `docs/proposal.md`
working document into a tracked `0001` (`Supersedes: docs/proposal.md`) so it
lives under version control; fold design trade-offs into `docs/architecture.md`
§8 rather than a standalone `design.md`. The gitignored local `docs/proposal.md`
is left in place — it is a developer scratch file, not a repo artifact.
`SECURITY.md` and `CODE_OF_CONDUCT.md` are kept untouched — the global
documentation set is a minimum, not an exclusive whitelist, and both are valuable
GitHub community-health files.

## Rationale

The backfill material already existed (the proposal document, the CHANGELOG
entries, and the git history), so capturing it cost little and moved the
`permission_rank` rationale from a local-only file into version control in the
same pass. Folding design into
`architecture.md` keeps a single architecture surface, consistent with the
existing single-page `docs/wiki` philosophy, and avoids drift between two design
documents. Deferring `.env.example` honours the doc-sync rule by not adding a
redundant copy of the env contract.
