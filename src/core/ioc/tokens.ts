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
import type { GuildId } from '../ids';
import { token, type ServiceToken } from './container';

import type { ConnectionManager } from '../../infra/mongo/connection-manager';
import type { Repos } from '../../persistence/repositories';

/** Per-guild repository factory shape. Reserved for Phase 4a when the
 *  plugin/interaction scope makes per-repo registration meaningful. */
export type RepoFactory<R> = (guildId: GuildId) => Promise<R>;

/** Per-guild full-bag factory — current preferred entry point. */
export type ReposFactory = (guildId: GuildId) => Promise<Repos>;

export interface Tokens {
  readonly ConnectionManager: ServiceToken<ConnectionManager>;
  readonly ReposFactory: ServiceToken<ReposFactory>;
}

export const TOKENS: Tokens = {
  ConnectionManager: token<ConnectionManager>('ConnectionManager'),
  ReposFactory: token<ReposFactory>('ReposFactory'),
};
