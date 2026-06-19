# 0002 - Channel-aware Visibility and Full-ancestry Rank

- Date: 2026-06-18
- Status: accepted
- Supersedes: -

## Context

The initial `permission_rank` model ([0001](0001-permission-rank-privacy-model.md))
resolved a channel's effective rank from the channel and its immediate parent
only (`max(channelRank(C), channelRank(parent(C)))`), mirroring the one-level
reach of the old `blocked_channels`. This could not express "this whole category
is private": a rank set on a category id did not lift the threads or text
channels nested under it, so a private forum's threads leaked.

## Options considered

- A. Keep the one-level (channel ↔ immediate parent) reach. Rejected: a category
  rank could not gate the channels and threads beneath it — the natural way an
  operator expresses "this area is private".
- B. Walk the full channel ancestry (channel → parent channel → category) and
  fold the rank over the whole chain. Chosen.

## Decision

`channelRank` now folds the max over the full ancestor chain resolved by
`ancestorChannelIdsOf` (`infra/discord`): channel → parent channel → category. A
category id in `permission_rank.channels` therefore gates every channel and
thread nested under it. `channelRank` / `isSuppressed` / `visibilityCeiling` take
an `ancestorChannelIds` array, applied uniformly to every rank-gated feature
(`/traffic` + `/traffic_me` visibility, `guild-events`, `channel-logging`,
`social-link-preview`). The change is strictly additive: when a deeper ancestor
is uncached the walk degrades to the prior one-level behaviour.

## Rationale

Folding over the ancestry keeps the effective rank monotone — adding an ancestor
can only raise it, never lower it — so a more-private enclosing category can
never be undercut by a less-private child, the fail-safe direction for a privacy
control. Resolving the chain through a single `ancestorChannelIdsOf` helper keeps
the ancestry logic in one place instead of each consumer re-deriving parents with
unsafe casts.
