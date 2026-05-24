# C8 — Plugins

## Responsibility

Self-contained business features. Every behavior that touches Discord users or guild state lives here. Each plugin satisfies the `Plugin<Config>` contract (see C3) and is opted into a personality through `this.use(...)` inside the bot subclass.

## The eight plugins

- `src/plugins/auto-reply/` — keyword-triggered replies.
- `src/plugins/llm-chat/` — LLM chat. Registers `TOKENS.ModelCatalog` during `init` via `ctx.registerInstance(...)`.
- `src/plugins/message-backup/` — periodic message archival; the only plugin used by the `msg-archive` worker.
- `src/plugins/giveaway/` — giveaway scheduling and reaction tally. Uses `JobManager` and `parseDuration` from `@core/scheduling`.
- `src/plugins/activity/` — activity tracking and leaderboards. Shares the same `@core/scheduling` helpers.
- `src/plugins/guild-events/` — subscribes to `events.guildCreate`. Resolves `TOKENS.GuildOnboardingPort` and calls it to connect the new guild's DB and register its commands. Failures are logged structured, never re-thrown.
- `src/plugins/voice/` — voice-channel controller. Registers `TOKENS.VoiceController` during `init`.
- `src/plugins/earthquake/` — Express `/discord/earthquake` route plus per-guild broadcast; `scope='bot'`. Owned by the `nijika` personality (see C11). The HTTP socket is closed in `onShutdown`; broadcast logic lives in `internal/broadcast.ts`.

## IoC contract for plugins

Every `src/plugins/*/plugin.ts` imports `TOKENS` from the `@core/plugin` barrel:

```ts
import { TOKENS } from '../../core/plugin';
```

Direct imports of `core/ioc` or `@core/ioc` are blocked by an ESLint `no-restricted-imports` rule on `src/plugins/**`. The container's write surface is reachable only through `PluginInitContext.registerInstance(token, instance)` during `init`; the type system hides that method in later phases.

## Notes

`BaseBot.listen` checks `dispatcherSubscribesTo('guildCreate')` and skips its own `client.on(GuildCreate)` when the `guild-events` plugin already owns onboarding, avoiding double initialization. Logging is uniformly structured: no `console.*` appears under `src/plugins/`.
