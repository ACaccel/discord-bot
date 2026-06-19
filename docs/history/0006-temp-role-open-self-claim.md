# 0006 - Open, self-claim temporary notification roles with a hard expiry

- Date: 2026-06-19
- Status: accepted
- Supersedes: -

## Context

A `/temp_role` slash command was requested: any member should be able
to spin up a short-lived role used purely for `@mention` notifications
(e.g. "ping me about this event"), which disappears on its own. Several
design points had more than one reasonable reading and shape the
feature's security and lifecycle:

- **What "temporary role" means** — create a brand-new Discord role, or
  grant an existing role to a member for a while.
- **Who may run it** — role creation is normally a privileged action.
- **What "30 days" means** — a fixed lifetime or a selectable one.
- **How expiry survives a restart** — node-schedule jobs are in-memory.

## Options considered

- **Behaviour A — create a new role + self-claim button (chosen).** The
  command creates a fresh role and posts a message with a toggle button;
  members click to claim / release it. Expiry deletes the whole role.
  Matches the requester's intent ("产生暫時性的身份組" + a claim button)
  and reuses the existing `toggle_role` button verbatim.
- Behaviour B — grant an existing role temporarily to one member.
  Rejected: not what was asked; also needs per-member expiry bookkeeping
  rather than a single role lifecycle.

- **Permissions: open to everyone (chosen).** Justified by neutering the
  blast radius — the created role is `permissions: []` and only
  `mentionable: true`, so it grants nothing; the sole shared resource it
  consumes is the guild role count, guarded by a 250-role ceiling check
  that fails the command with a localised error. No per-user rate limit
  ships in v1 (recorded as a possible future hardening).
  Rejected alternative: gate on `ManageRoles` (as `role_message` does) —
  unnecessarily restrictive for a permission-less notification role and
  contrary to the requested "open to all" behaviour.

- **Lifetime: selectable `days`, hard cap 30 (chosen).** A `number`
  option `days` with Discord-native `min:1` / `max:30`, defaulting to 30,
  re-validated server-side for a localised error. Rejected: a fixed
  exactly-30-day lifetime (less flexible) and a free-form duration string
  (needs a parser; integer days is clearer for this feature).

- **Expiry durability: giveaway-style reboot (chosen).** State lives in a
  new `TempRole` MongoDB collection; one-shot `JobManager` jobs are
  rebuilt on `onReady` (`rebootTempRoleJobs`), expiring past-due rows
  immediately and rescheduling the rest. Mirrors the proven giveaway
  scheduler rather than inventing a parallel mechanism. Expiry
  comparisons use the injected `Clock` for testability.

- **Distribution: general-purpose plugin (chosen).** Shipped as the
  `temp-role` plugin and loaded only by `nijika` for now, but bound to no
  personality — any composition root can `this.use(createTempRolePlugin())`
  and enable the command via its `config.commands`, exactly like every
  other plugin.

## Decision

Implement Behaviour A, open to all members, with a selectable 1–30-day
lifetime (default 30, hard cap), backed by a `TempRole`
schema/repository and a giveaway-style expiry reboot, packaged as the
general-purpose `temp-role` plugin loaded by `nijika`. The shared
`toggle_role` button — reused for the claim UI — is localised in the
same change (its replies were previously hardcoded English). On expiry
the role is deleted, the claim message is edited to its expired state
with the button stripped, and the row removed; all Discord-side cleanup
is best-effort while the DB delete is retryable.

## Rationale

The load-bearing decision is "open to everyone is safe _because_ the
role is powerless." That coupling is deliberate: the permission-less,
mention-only role is what makes unrestricted creation acceptable, and
the 250-role ceiling guard is the only abuse bound v1 enforces. If a
future change ever grants the role any permission, the open-access
decision must be revisited — which is why it is recorded here rather
than left implicit in the handler. Reusing the giveaway scheduler and
the `toggle_role` button keeps the feature additive and avoids a second
timed-job mechanism.
