# 0005 - Tolerate transient network resets instead of crashing the bot

- Date: 2026-06-19
- Status: accepted
- Supersedes: -

## Context

A live bot crashed with `FATAL: uncaughtException; initiating graceful
shutdown`, error `ECONNRESET` / "socket hang up", stack in
`node:_http_client` (`TLSSocket.socketOnEnd`). Diagnosis:

- The trigger is purely network — the remote reset an established TLS
  connection (a discord.js gateway socket, via the `ws` package's
  legacy `https.request`). Not a logic defect.
- The crash is a code resilience gap. The Discord `Client` had **no
  `'error'` listener** (`ClientEventBridge` wires only interaction /
  reaction / guildCreate). Node's EventEmitter rethrows an emitted
  `'error'` with no listener as an `uncaughtException`, which the
  process safety net (`process-handlers.ts`) treats as fatal →
  `process.exit(1)`. With no process supervisor, the bot stayed down
  until a manual restart — a sub-second blip became indefinite downtime.

A secondary instance of the same class: `message-backup`'s periodic
`setTimeout` callback was a floating async promise; a failed pass leaked
an `unhandledRejection` and silently killed the repeat loop.

## Options considered

- A. Add a process supervisor (pm2 / systemd) to auto-restart on exit.
  Rejected for this change (operational layer, out of scope): it masks
  the crash rather than preventing it, and restart still drops in-flight
  work and gateway session state.
- B. Attach an `error` listener on the Discord client at the source so
  the transient error never becomes an `uncaughtException`. Chosen — the
  Node-idiomatic fix (attach the error handler where the emitter lives).
- C. In the `uncaughtException` net, classify transient network errors
  and decline to shut down. Chosen as a **second layer** behind B, for
  any transient socket error that escapes from a path we do not own.
- D. Broadly stop exiting on `uncaughtException`. Rejected: after a
  genuine uncaught fault the process state is indeterminate (Node's own
  guidance); only a narrow, well-known network whitelist is safe to
  tolerate.

## Decision

Implement B + C (not A or D):

- `src/bot/client-safety-listeners.ts` — `installClientSafetyListeners`
  attaches non-fatal `error` / `shardError` / `shardDisconnect`
  listeners. Installed by `BaseBot.setupContainer` (not
  `ClientEventBridge`) so it spans the client's full lifecycle: the
  bridge attaches only after `host.startAll` and detaches on shutdown,
  leaving the login and teardown windows uncovered. The safety net must
  live with the client, which `BaseBot` owns — the same place
  `installProcessHandlers` already sits.
- `src/core/errors/transient-network-error.ts` —
  `isTransientNetworkError` matches a narrow socket-error-code whitelist
  (`ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `ECONNREFUSED`, `ECONNABORTED`,
  `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`) plus Node's
  "socket hang up" message. The `uncaughtException` handler logs +
  counts (`getTransientNetworkErrorCount`) and returns for a match,
  keeping the fatal graceful-shutdown path for everything else.
- `message-backup` — the repeat loop isolates each guild's pass in its
  own `try/catch` and always reschedules in a `finally`.

A process supervisor (option A) is deliberately left out of scope.

## Rationale

The trigger is network, but the failure mode is "a momentary blip kills
the process and keeps it dead." Fixing it at the source (B) is the
correct primary defence; the `uncaughtException` downgrade (C) is a
deliberately narrow backstop, kept tight so real defects still crash
loudly rather than being masked (the explicit reason D was rejected).
Owning the listener in `BaseBot` rather than `ClientEventBridge` is the
load-bearing placement decision — recorded here because the bridge is
the "obvious" home but cannot cover login or shutdown.
