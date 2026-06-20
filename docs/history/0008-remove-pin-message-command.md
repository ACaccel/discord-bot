# 0008 - Permanently remove the `pin_message` command

- Date: 2026-06-20
- Status: accepted
- Supersedes: -

## Context

The `/pin_message` slash command let a public-thread owner pin / unpin a
message in their own thread by message link. It had been marked
deprecated in code (`// deprecated, discord has added native pin
permission`): Discord now exposes a native "Manage Messages / pin"
permission for threads, so the command duplicates a built-in capability
and no longer earns its keep. It was still registered and functional, and
— unlike every other handler — carried no test, so it was also an
untested surface. The request was to remove deprecated code, so the
command is retired permanently.

As with `todo_list` (decision `0007`), removing the handler code does not
make the command disappear from Discord: each personality publishes its
command set from its own gitignored `config.json` `commands` list, so the
already-registered command lingers in the client until that list is
edited and the bot is redeployed.

## Options considered

- **Delete the command entirely (chosen).** Remove the handler, its
  `commands:pin_message.*` / `replies:pin_message.*` catalog keys from
  both locales, and regenerate the command registry.
  - Rejected — **keep the command, drop only the `deprecated` comment**:
    leaves a redundant, untested admin command shipping forever; contrary
    to the request to remove deprecated code.
  - Rejected — **keep but hide behind a feature flag**: adds config
    surface to preserve a capability Discord already provides natively.

- **Slash-command retirement: edit `config.json` + redeploy (chosen).**
  The operator removes `"pin_message"` from the `commands` array of any
  bot `config.json` that lists it and re-runs `yarn deploy -t <bot>`; the
  global PUT republishes the command set without it and Discord prunes
  the removed command. No committed `config.example.json` lists
  `pin_message`, so no example config changes.

## Decision

Delete the `pin_message` command handler
(`src/handlers/commands/pin_message/`), remove its
`commands:pin_message.*` / `replies:pin_message.*` catalog keys from both
locales, and regenerate the command registry (43 → 42 commands). The
operator removes `"pin_message"` from any bot `config.json` `commands`
list that still carries it and re-runs `yarn deploy -t <bot>` so Discord
drops the command.

## Rationale

The command duplicates Discord's native thread-pin permission, was
already flagged deprecated, and was the one handler with no test —
keeping it would mean shipping a redundant, unverified admin command
indefinitely. Retiring the registered command through the
`config.json` + redeploy path mirrors the precedent set by `todo_list`
(`0007`): code removal alone cannot unpublish a command, so the operator
step is recorded here and in the changelog rather than left implicit.
