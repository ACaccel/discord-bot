---
name: update-wiki
description: Sync the repo wiki under docs/wiki/ after any add, delete, or modify of code or docs.
---

# Repo Wiki Auto-Sync (update-wiki)

The repo wiki lives at [`docs/wiki/`](../../../docs/wiki/) and is the
living documentation of the codebase. Any change that adds, deletes,
or modifies `src/`, `scripts/`, config files, or `docs/` must sync the
wiki within the same unit of work — this is mandatory discipline, not
an optional step. Wiki drifting from the codebase counts as a defect.

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

Run the section 3 sync after any add, delete, or modify of code or
docs. Trigger criteria — update the wiki if any of the following is
true:

- A file or directory was added, deleted, or renamed.
- A component's public interface, contract, or dependency relationship
  changed.
- A config file, CI gate, or quality rule changed.
- A document under `docs/` changed.

## 3. Sync steps

1. **Inventory the changes**: run `git status --short` and
   `git diff --stat`; list every added / deleted / modified path in
   this unit of work.
2. **Update component pages**: for each affected component, update
   `docs/wiki/components/C<N>-<name>.md`:
   - The "Current state" section reflects the latest implementation
     state (public interface, submodules, dependencies).
   - The "Recent changes" section gets a new entry: date plus a short
     change summary.
   - If the component has no wiki page yet, create it from the
     section 4 template.
3. **Append to the CHANGELOG**: add an entry to the top of
   `docs/wiki/CHANGELOG.md` (template in section 5).
4. **Update the Home index**: the component status table in
   `docs/wiki/Home.md` reflects the latest state; if a page was added,
   add its link.
5. **Consistency check**: ensure the wiki references no deleted file /
   alias / directory and that no link is broken.

## 4. Component page template

```markdown
# C<N> — <Name>

> Path: `<path>`

## Responsibility

<one paragraph: this component's role in the layered architecture>

## Current state

<current state of the public interface, submodules, key dependencies>

## Recent changes

- YYYY-MM-DD — <summary>
```

## 5. CHANGELOG entry template

```markdown
## YYYY-MM-DD — <title>

- **Component**: C<N> <name>
- **Change**: <summary of additions / deletions / modifications>
- **Impact**: <effect on public interface / behavior / dependencies; if
  none, write "behavior-equivalent">
```

## 6. Boundaries

- The wiki is derived documentation: it describes the current state.
  Architectural rationale belongs in `docs/architecture.md`, not in
  the wiki.
- Never put secrets, tokens, or internal URLs in the wiki.
- A wiki change belongs in the same commit as the corresponding code
  change, not a separate one.
- Do not fabricate status — the component status table must
  mechanically match the actual code.

## 7. Completion check

The wiki sync is complete when:

- [ ] Every affected component's wiki page is updated
- [ ] `CHANGELOG.md` has the new entry for this unit of work
- [ ] The `Home.md` component status table matches reality
- [ ] No broken links, no reference to a deleted file / alias
