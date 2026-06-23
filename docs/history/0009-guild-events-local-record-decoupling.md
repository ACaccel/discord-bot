# 0009 - Decouple guild-events local recording from Discord disclosure

- Date: 2026-06-23
- Status: accepted
- Supersedes: -

## Context

The `guild-events` plugin mirrors message edits/deletes to a guild's `event`
channel and writes a matching `logGuildEvent` audit line; on delete it also
downloads each attachment to `./data/deleted_attachments/<guildId>/`. All three
side effects sat behind a single early return:

```ts
if (policy.isSuppressed(guildId, 'guild_events', channelId, ancestors)) return;
```

With the default `guild_events` ceiling of `0`, any channel whose effective rank
(channel + ancestry, see [0002](0002-channel-aware-full-ancestry-rank.md)) is `1`
or higher was skipped **entirely** — no embed, no attachment archival, no audit
line. The consequence: edits/deletes in private (rank-1+) channels left no record
anywhere, not even on the server. Operators wanted the server to keep a complete
record of every edit/delete (text + attachments) while preserving the existing
Discord-side non-disclosure for high-rank channels.

## Options considered

- A. Raise the `guild_events` ceiling per guild so rank-1+ channels are recorded.
  Rejected: it also re-enables Discord disclosure for those channels — the two
  concerns (record vs. disclose) are coupled, so this cannot satisfy "record but
  do not disclose".
- B. Add a second, separate "local recording" ceiling distinct from the
  disclosure ceiling. Rejected: re-introduces the all-or-nothing coupling the
  request is removing, and adds config surface, a new `RankedFeature` key, schema
  changes, and lockstep-assertion churn for a knob nobody asked for.
- C. Decouple the two side effects: the `isSuppressed` check gates **only** the
  Discord `event`-channel embed; the local audit line and attachment archival run
  unconditionally for every non-bot guild message. Chosen.

## Decision

`isSuppressed` is no longer an early return in `handleMessageUpdate` /
`handleMessageDelete`; it is a boolean that gates only the embed block. The
`logGuildEvent` audit line and `archiveDeletedAttachment` download now run for
every non-bot edit/delete regardless of rank. The meaning of
`permission_rank.features.guild_events.maxChannelRank` narrows from "rank ceiling
above which edits/deletes are **not recorded**" to "rank ceiling above which
edits/deletes are **not disclosed to the Discord `event` channel**" — the config
value is unchanged (default `0`); only its documented meaning changes.

Supporting changes: partial-message `fetch()` is wrapped in try/catch (a deleted
message's fetch rejects with `Unknown Message`; the local record must still run
on the cached partial), and the audit `details` gain stable correlation ids
(`userId` / `channelId` / `messageId`) plus edit attachment metadata.

## Rationale

The rank system's purpose was always Discord-side privacy; option C preserves
that exactly (the `event` channel still never sees rank-1+ content) while making
the server an unconditional sink, which is the requested behaviour. Reusing the
existing `guild_events` ceiling as the disclosure gate avoids new config surface.

Privacy trade-off (recorded deliberately): private-channel message content is now
written to `logs/<bot>/<guildId>/<YYYY-MM-DD>.log` and deleted attachments are
downloaded to `./data/deleted_attachments/<guildId>/` for every channel. Anyone
with file-system access to the bot host can therefore read private-channel
content. This is the explicit, intended consequence of the requirement.
