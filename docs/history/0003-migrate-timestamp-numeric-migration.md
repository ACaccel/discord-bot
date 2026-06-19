# 0003 - `migrate_timestamp` Numeric-timestamp Migration

- Date: 2026-06-18
- Status: accepted
- Supersedes: -

## Context

Stored `messages.timestamp` values were historically String-typed in some
guilds. The message-traffic range queries (`/traffic`, `/traffic_me`,
`db_list_message`) therefore had to compare with a computed `$toLong` / `$expr`
predicate, which is non-sargable — every query became a full collection scan
(the performance fix is [0004](0004-index-served-timestamp-range-reads.md), which
depends on this one). Converting timestamps in place is a destructive, one-time
data migration across many guild databases.

## Options considered

- A. Convert timestamps inline at query time (cast on read). Rejected: keeps the
  non-sargable predicate forever, so the full-scan problem (0004) could never be
  removed.
- B. A dedicated, auditable ops tool that backfills String → numeric once per
  guild, with a mandatory pre-write snapshot. Chosen.

## Decision

A standalone `tools/migrate_timestamp/` tool (`yarn migrate_timestamp`) with
three modes: `audit` (read-only fleet recommendation), `convert`, and `index`.
Conversion takes a mandatory, fail-fast in-database snapshot before any write,
only touches all-digit String values (non-numeric "garbage" is routed to manual
triage, never auto-converted), and is value-preserving and idempotent (`dry_run`
previews without writing). Documented in
[`docs/wiki/ops/migrate-timestamp.md`](../wiki/ops/migrate-timestamp.md).

## Rationale

A separate operator tool — rather than an automatic on-boot migration — keeps a
destructive, irreversible data change under explicit human control with an audit
step first. The mandatory snapshot makes the conversion recoverable; the
all-digit-only rule prevents silently corrupting malformed rows; idempotency lets
an interrupted run be re-run safely.
