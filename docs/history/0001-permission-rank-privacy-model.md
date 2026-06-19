# 0001 - `permission_rank` Privacy / Clearance Model

- Date: 2026-06-18
- Status: accepted
- Supersedes: docs/proposal.md

## Context

`nijika` drove three all-or-nothing channel-suppression behaviours — the
`guild-events` mirror, `social-link-preview`, and channel-logging — from a
single bot-wide, flat `blocked_channels: string[]`. A blacklisted channel was
suppressed for all three features uniformly; the model could not express
"different features treat differently-private channels differently", and it had
no user dimension for a future visibility-gated command (`/traffic`).

## Options considered

- A. Extend the flat `blocked_channels` list with per-feature variants. Rejected:
  still flat, still bot-wide, no user dimension, and it multiplies bot-wide
  lists.
- B. Store the rank map in `GuildRegistry` / `#guildInfo`. Rejected:
  `GuildRegistry`'s contract is a read-only runtime view, and binding rank there
  introduces "event arrives before `registerAll` populates" and "runtime
  `guildCreate` builds an empty slot" races. A statically-built policy has
  neither.
- C. A dedicated core service `PermissionRankPolicy`, built once from static
  `config.json` in the `BaseBot` constructor (discord.js-free, fail-fast zod),
  resolved per-event via `TOKENS.PermissionRankPolicy` — the same seam as
  `GuildOnboardingPort`. Chosen.
- Naming (open at proposal time): `PermissionRankPolicy` vs `ClearanceRankPolicy`
  / `PrivacyRankPolicy`. Kept `PermissionRankPolicy` to match the
  `permission_rank` config key, with a docstring distinguishing it from
  discord.js' `PermissionsBitField`.

## Decision

A per-guild `guilds.<id>.permission_rank` block: non-negative integer ranks for
`channels` and for `roles` (a member's clearance is the max over their ranked
roles), plus a per-feature `maxChannelRank` ceiling under `features`. A feature
suppresses a channel when its effective rank exceeds the ceiling; defaults are
`guild_events = 0`, `channel_logging = 0`, `social_preview = null` (unbounded —
preview everywhere). The policy exposes `channelRank` / `userRank` /
`isSuppressed` / `visibilityCeiling`; `RankedFeature` is derived from a
default-ceiling table (`as const satisfies` + `keyof typeof`) so a new feature
cannot omit a default. `blocked_channels` was removed entirely.

A deliberate behaviour change shipped with this: channels formerly in nijika's
`blocked_channels` now receive social-link previews (`social_preview` defaults
to unbounded), and suppression scope narrowed from bot-wide to per-guild.

## Rationale

Static construction matches the old closure lifecycle (no "rank not yet loaded"
race) and needs no Discord client at build time. Placing `RankedFeature` in
`core` is the only common ancestor of bot-level (`channel_logging`) and
plugin-level (`guild_events` / `social_preview`) consumers that avoids a reverse
import. Guarding at the accessor (`?? RANK_ZERO`) makes "unlisted channel =
rank 0" a single invariant rather than a per-callsite concern. Branded `Rank`
with `maxRank` / `minRank` combinators preserves the brand that `Math.min/max`
would erode, and a `z.union([int.min(0), z.null()])` ceiling keeps "unset key
(use default)" distinct from "explicit null (unbounded)".
