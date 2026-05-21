/**
 * Standard service tokens.
 *
 * Centralised so:
 *   - Token naming is reviewed in one place (no `MESSAGE_REPO_FACTORY` vs
 *     `MessageRepoFactory` drift across PRs).
 *   - The full catalog is visible to readers learning the container.
 *   - New service additions land here, not scattered across modules.
 *
 * Repository access is exposed as a **factory token** of shape
 * `(g: GuildId) => Promise<Repos>` rather than scoped registrations:
 * scoped registration would require a per-request scope object threaded
 * through the call graph, whereas a factory token is one explicit line
 * in the composition root.
 */
import type { Client } from 'discord.js';
import type { Job } from 'node-schedule';

import type { GuildId } from '../ids';
import { token, type ServiceToken } from './container';

import type { ConnectionManager } from '../../infra/mongo/connection-manager';
import type { Clock } from '../time';
import type { Env } from '../config';
import type { GuildRegistry } from '../guild-registry';
import type { Translator } from '../i18n';
import type { Logger } from '../logger';
import type { Repos } from '../../persistence/repositories';
import type { GuildOnboardingPort } from '../plugin/guild-onboarding-port';

/** Per-guild single-repository factory shape. */
export type RepoFactory<R> = (guildId: GuildId) => Promise<R>;

/** Per-guild full-bundle factory — the preferred repository entry point. */
export type ReposFactory = (guildId: GuildId) => Promise<Repos>;

export interface Tokens {
  readonly ConnectionManager: ServiceToken<ConnectionManager>;
  readonly ReposFactory: ServiceToken<ReposFactory>;
  /**
   * Bot-scoped root logger. Resolved instance carries `{ bot: clientId }`
   * already bound; downstream code should `.child({ guildId })` /
   * `.child({ traceId })` for narrower scope.
   */
  readonly Logger: ServiceToken<Logger>;
  /** Bot-scoped Translator. The composition root registers the
   *  i18next-backed default; the plugin host receives it via
   *  PluginHostOptions. */
  readonly Translator: ServiceToken<Translator>;
  /** Wall-clock abstraction; tests substitute a FakeClock. */
  readonly Clock: ServiceToken<Clock>;
  /** Per-guild registry: repos / channel / role lookup by guild id. */
  readonly GuildRegistry: ServiceToken<GuildRegistry>;
  /**
   * Discord client. Plugins that need fetch / channel / message
   * primitives (notably the message-archive backup loop) resolve this
   * rather than reaching back to a BaseBot reference. Registered as
   * a singleton holding the live `Client` instance.
   */
  readonly DiscordClient: ServiceToken<Client>;
  /**
   * Validated, frozen environment. The `infra/llm` registry pulls
   * LLM provider API keys from this rather than reading
   * `process.env` directly, so the strict no-restricted-syntax rule
   * is honoured everywhere outside `core/config`.
   */
  readonly Env: ServiceToken<Env>;
  /**
   * Bot-scoped scheduled-job map. The activity + giveaway plugins
   * resolve this from `onReady` to drive their reboot loops without
   * holding a BaseBot reference.
   */
  readonly JobMap: ServiceToken<Map<string, Job>>;
  /**
   * Guild-onboarding port. The composition root binds the concrete
   * `BaseBot`-backed implementation; the `guild-events` plugin resolves
   * this to onboard new guilds from its `guildCreate` subscription
   * without reaching into `BaseBot` internals.
   */
  readonly GuildOnboardingPort: ServiceToken<GuildOnboardingPort>;
}

export const TOKENS: Tokens = {
  ConnectionManager: token<ConnectionManager>('ConnectionManager'),
  ReposFactory: token<ReposFactory>('ReposFactory'),
  Logger: token<Logger>('Logger'),
  Translator: token<Translator>('Translator'),
  Clock: token<Clock>('Clock'),
  GuildRegistry: token<GuildRegistry>('GuildRegistry'),
  DiscordClient: token<Client>('DiscordClient'),
  Env: token<Env>('Env'),
  JobMap: token<Map<string, Job>>('JobMap'),
  GuildOnboardingPort: token<GuildOnboardingPort>('GuildOnboardingPort'),
};
