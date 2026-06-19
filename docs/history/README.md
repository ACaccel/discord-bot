# Decision History

One file per decision, named `NNNN-kebab-topic.md` with a four-digit
sequential number; the date lives inside each file. This directory is the
single decision source and replaces a standalone ADR set.

Conventions:

- Rejected options are preserved inside each decision file, never deleted.
- When a decision is overturned, the old file is marked `superseded` (not
  deleted) and the superseding file references it from its `Supersedes` field.
- `Status` is one of `accepted`, `superseded`, `rejected`.

| #    | Topic                                             | Status   | Supersedes         |
| ---- | ------------------------------------------------- | -------- | ------------------ |
| 0000 | Adopt the global documentation-standard structure | accepted | —                  |
| 0001 | `permission_rank` privacy / clearance model       | accepted | `docs/proposal.md` |
| 0002 | Channel-aware visibility and full-ancestry rank   | accepted | —                  |
| 0003 | `migrate_timestamp` numeric-timestamp migration   | accepted | —                  |
| 0004 | Index-served `Message.timestamp` range reads      | accepted | —                  |
| 0005 | Tolerate transient network resets, not crash      | accepted | —                  |
