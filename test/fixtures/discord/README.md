# Discord test fixtures

This directory is reserved for the custom Discord interaction / channel /
guild / member builders introduced in Phase 2 (when the first integration
tests against `InteractionRouter` and the use-case layer arrive).

Conventions (lock these in before adding builders):

- Builders are plain functions returning the structural minimum needed by
  the SUT — e.g. `buildChatInputInteraction({ commandName, options, user,
guild, locale })`. No third-party mock libraries.
- One file per Discord type: `interaction-builder.ts`, `message-builder.ts`,
  `guild-builder.ts`, `member-builder.ts`, `client-fake.ts`.
- Tests import builders, not bare object literals, when the shape is used
  in 3 or more places.
