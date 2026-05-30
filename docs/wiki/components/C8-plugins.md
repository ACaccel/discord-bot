# C8 — Plugins

## Responsibility

Self-contained business features. Every behavior that touches Discord users or guild state lives here. Each plugin satisfies the `Plugin<Config>` contract (see C3) and is opted into a personality through `this.use(...)` inside the bot subclass.

## The nine plugins

- `src/plugins/auto-reply/` — keyword-triggered replies.
- `src/plugins/llm-chat/` — LLM chat. Registers `TOKENS.ModelCatalog` and `TOKENS.DefaultModelResolver` during `init` via `ctx.registerInstance(...)`. `onReady` kicks off an initial background `DefaultModelResolver.refresh()` and schedules a weekly refresh (Monday 04:00, cron `0 4 * * 1`) via `JobManager.scheduleRecurring`, so a model going legacy never strands the whitelist-entry default.
- `src/plugins/message-backup/` — periodic message archival; the only plugin used by the `msg-archive` worker. The repeat cadence is configurable: `MessageBackupPluginConfig.backupIntervalMs` (optional, defaults to one hour), fed from the `msg-archive` composition root's operator-facing `backup_interval_minutes` config field.
- `src/plugins/giveaway/` — giveaway scheduling and reaction tally; the announcement is published in the channel the `/giveaway_create` command is invoked from (no dedicated `giveaway` channel config). Uses `JobManager` and `parseDuration` from `@core/scheduling`.
- `src/plugins/activity/` — activity tracking and leaderboards. Shares the same `@core/scheduling` helpers.
- `src/plugins/guild-events/` — subscribes to `messageUpdate`, `messageDelete`, `guildMemberUpdate`, and `guildCreate`. Mirrors message edits/deletes and role changes to the guild's configured `event` channel and emits matching `logGuildEvent` audit lines; the audit lines are decoupled from the `event` channel, so they fire even when no `event` channel is configured. On `guildCreate` it resolves `TOKENS.GuildOnboardingPort` and calls it to connect the new guild's DB and register its commands. Failures are logged structured, never re-thrown. Loaded by the `nijika` and `tomori` personalities.
- `src/plugins/voice/` — voice-channel controller. Registers `TOKENS.VoiceController` during `init`.
- `src/plugins/earthquake/` — Express `/discord/earthquake` route plus per-guild broadcast; `scope='bot'`. Owned by the `nijika` personality (see C11). The HTTP socket is closed in `onShutdown`; broadcast logic lives in `internal/broadcast.ts`.
- `src/plugins/llm-auto-reply/` — `messageCreate` subscriber that occasionally (configured `probability`) injects a context-aware reply from a self-hosted LLM. Rolls the probability gate before any fetch; on a hit it fetches the latest `messageCount` messages, requires they form a burst within `windowSeconds`, builds a transcript (bot/blank lines dropped), POSTs it via `SelfHostedLlmClient` (C5), and posts one reply with mentions suppressed. The reply is a single message (`internal/reply.ts`): a blank LLM reply is skipped and an over-long one is truncated to Discord's 2000-char limit (rather than split) so `channel.send` cannot reject it. A per-channel cooldown (`internal/cooldown.ts`, `ReplyCooldown`, `cooldownSeconds`) enforces a minimum gap between consecutive automatic replies in a channel; `0` disables it. To stay correct under concurrent `messageCreate` handlers (events are dispatched fire-and-forget, so handlers interleave at every `await`), the channel is marked in-flight before the first await — a concurrent automatic message in the same channel yields — and the cooldown is recorded only when a reply actually goes out (so a no-op attempt does not suppress the next reply); `ReplyCooldown.record` is monotonic. The in-flight tracker (`internal/in-flight.ts`, `InFlightChannels`) is reference-counted, because a forced reply bypasses the in-flight check but still occupies the channel — so two attempts can overlap, and the channel must stay busy until the last one finishes rather than being cleared by the first. A message whose content begins with the `fatcat_reply` force-trigger keyword (`internal/trigger.ts`, `FORCE_TRIGGER_PREFIX`, matched as a standalone leading token) bypasses the probability gate, the `windowSeconds` burst check, and the cooldown — the `messageCount` requirement and all other guards (enabled, bot author, guild-only, blocked channels) still apply — and the keyword is stripped from the transcript so the control token never reaches the prompt. Every posted reply (automatic or forced) records the cooldown, so a following automatic reply still observes the gap. Settings come from the bot's `llm_auto_reply` config block (`config.ts`, zod defaults in code); `nijika`'s `blocked_channels` are passed in and excluded. Owned by the `nijika` personality (see C11); `scope='bot'`. Pure helpers (`buildTranscript`, `isWithinWindow`, the trigger + cooldown helpers) and the orchestrator live in `internal/`.

## IoC contract for plugins

Every `src/plugins/*/plugin.ts` imports `TOKENS` from the `@core/plugin` barrel:

```ts
import { TOKENS } from '../../core/plugin';
```

Direct imports of `core/ioc` or `@core/ioc` are blocked by an ESLint `no-restricted-imports` rule on `src/plugins/**`. The container's write surface is reachable only through `PluginInitContext.registerInstance(token, instance)` during `init`; the type system hides that method in later phases.

## Notes

`BaseBot.listen` checks `dispatcherSubscribesTo('guildCreate')` and skips its own `client.on(GuildCreate)` when the `guild-events` plugin already owns onboarding, avoiding double initialization. Logging is uniformly structured: no `console.*` appears under `src/plugins/`.
