# Discord test fixtures

Minimal structural builders for the Discord types that handler / plugin
tests touch. Builders return plain objects shaped to the structural
minimum the SUT reads — no third-party mock libraries.

## Files

- `guild-builder.ts` — `buildGuild({ id, name, channels, members })`
- `member-builder.ts` — `buildGuildMember({ id, displayName, voiceChannelId, roleIds })`
- `message-builder.ts` — `buildMessage({ id, content, authorId, guildId, sink })`
- `interaction-builder.ts` — `buildChatInputInteraction({ commandName, userId, guildId, options, sink })`
- `client-fake.ts` — `buildFakeClient({ userId, guilds })` returning a
  `{ client, fireEvent }` handle so listener-driven flows can be pumped

## Conventions

- One file per Discord type.
- Tests import builders, not bare object literals, when the shape is
  used in 3 or more places.
- Each builder accepts an optional `sink` object so call-recording
  stays explicit (no global `vi.fn()` magic).
- Builders cast to the public discord.js type at the end (`as unknown
as X`) — keep test files free of these casts so the shape change
  surface stays one file per type.

See `test/integration/interaction-router/router-dispatch.int.test.ts`
for an integration test that exercises the full router chain through
these fixtures.
