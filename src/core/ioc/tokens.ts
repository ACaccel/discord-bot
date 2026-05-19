/**
 * Standard service tokens.
 *
 * Centralised so:
 *   - Token naming is reviewed in one place (no `MESSAGE_REPO_FACTORY` vs
 *     `MessageRepoFactory` drift across PRs).
 *   - The full catalog is visible to readers learning the container.
 *   - Future cross-phase additions (LlmProvider in Phase 5, plugin
 *     contributions in Phase 4a) land here, not scattered.
 *
 * Phase 2 PR B ships repository factories for all 7 schemas plus a
 * `Repos` factory that bundles them. Tokens for not-yet-implemented
 * services are declared but unbound — `tryResolve` returns undefined
 * for unbound tokens, so this is safe.
 *
 * Repository tokens are deliberately **factory tokens** of shape
 * `(g: GuildId) => Repo` rather than scoped registrations. Per the
 * Phase-2 design (architecture-reviewer consult): scoped registration
 * requires a real per-request scope object threaded through, which
 * we do not have until Phase 4a. A factory token is one explicit line
 * in the composition root and revisits naturally when the plugin
 * lifecycle introduces an interaction scope.
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

/** Per-guild repository factory shape. Reserved for Phase 4a when the
 *  plugin/interaction scope makes per-repo registration meaningful. */
export type RepoFactory<R> = (guildId: GuildId) => Promise<R>;

/** Per-guild full-bag factory — current preferred entry point. */
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
  /** Bot-scoped Translator. Phase 4b-1 registers the i18next-backed
   *  default; the plugin host receives it via PluginHostOptions. */
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
   * holding a BaseBot reference (audit ARCH-BLOCK3 / PR-G4).
   */
  readonly JobMap: ServiceToken<Map<string, Job>>;
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
};
