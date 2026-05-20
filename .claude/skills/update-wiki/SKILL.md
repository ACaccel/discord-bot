---
name: update-wiki
description: Automatically sync the repo wiki (docs/wiki/) after any addition, deletion, or modification of code or documentation. Must run after every component completion and every structural change so the wiki never drifts from the codebase. Covers component pages, the changelog, and the index.
---

# Repo Wiki Auto-Sync (update-wiki)

The repo wiki lives at [`docs/wiki/`](../../../docs/wiki/) and is the living
documentation of the codebase. **Any change that adds, deletes, or modifies
`src/`, `scripts/`, config files, or `docs/` must sync the wiki within the same
unit of work** — this is mandatory discipline, not an optional step. Wiki
drifting from the codebase counts as a defect.

## 1. Wiki structure

```
docs/wiki/
├── Home.md            # index: project overview + page links + component status table
├── CHANGELOG.md       # change log (reverse chronological, newest on top)
└── components/
    └── C<N>-<name>.md # one page per component: responsibility, current state,
                       # public interface, recent changes
```

## 2. When to trigger

After completing a unit of change (a subtask, a component, a refactor), run the
§3 sync. Trigger criteria — update the wiki if any of the following is true:

- A file or directory was added, deleted, or renamed.
- A component's public interface, contract, or dependency relationship changed.
- A config file, CI gate, or quality rule changed.
- A design / task document under `docs/` changed.

## 3. Sync steps

1. **Inventory the changes**: run `git status --short` and `git diff --stat`;
   list every added / deleted / modified path in this unit of work.
2. **Update component pages**: for each affected component, update
   `docs/wiki/components/C<N>-<name>.md`:
   - The "Current state" section reflects the latest implementation state
     (public interface, submodules, dependencies).
   - The "Recent changes" section gets a new entry: date + change summary +
     the corresponding task gap id (D<n> / G-<n>).
   - If the component has no wiki page yet, create it from the §4 template.
3. **Append to the CHANGELOG**: add an entry to the top of
   `docs/wiki/CHANGELOG.md` (template in §5).
4. **Update the Home index**: the component status table in
   `docs/wiki/Home.md` reflects the latest completion state (consistent with
   `docs/tasks/progress.md` §2); if a page was added, add its link.
5. **Consistency check**: ensure the wiki references no deleted file / alias /
   directory and that no link is broken.

## 4. Component page template

```markdown
# C<N> — <Name>

> Path: `<path>` | Detailed design: [`docs/design/C<N>-<name>.md`](../../design/C<N>-<name>.md)
> | Tasks: [`docs/tasks/C<N>-<name>.md`](../../tasks/C<N>-<name>.md)

## Responsibility
<one paragraph: this component's role in the layered architecture>

## Current state
<current state of the public interface, submodules, key dependencies>

## Recent changes
- YYYY-MM-DD — <summary> (gap D<n>)
```

## 5. CHANGELOG entry template

```markdown
## YYYY-MM-DD — <title>

- **Component**: C<N> <name>
- **Gap**: D<n> / G-<n>
- **Change**: <summary of additions / deletions / modifications>
- **Impact**: <effect on public interface / behavior / dependencies; if none,
  write "behavior-equivalent">
```

## 6. Boundaries

- The wiki is **derived documentation**: it describes the current state, it
  does not restate design rationale (rationale lives in `docs/design/`).
- Never put secrets, tokens, or internal URLs in the wiki.
- A wiki change belongs in the **same commit** as the corresponding code
  change, not a separate one.
- Do not fabricate status — the component status table must mechanically match
  `docs/tasks/progress.md`.

## 7. Completion check

The wiki sync is complete when:

- [ ] Every affected component's wiki page is updated
- [ ] `CHANGELOG.md` has the new entry for this unit of work
- [ ] The `Home.md` component status table matches `progress.md`
- [ ] No broken links, no reference to a deleted file / alias
