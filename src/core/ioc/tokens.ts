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
 * Phase 2 ships a subset; tokens for not-yet-implemented services are
 * declared but unbound. `tryResolve` returns `undefined` for unbound
 * tokens, so this is safe.
 *
 * Repository tokens are deliberately **factory tokens** of shape
 * `(g: GuildId) => Repo` rather than scoped registrations. Per
 * Phase-2 design (architecture-reviewer consult): scoped registration
 * requires a real per-request scope object threaded through, which
 * we do not have until Phase 4a. A factory token is one explicit line
 * in the composition root and revisits naturally when the plugin
 * lifecycle introduces an interaction scope.
 */
import type { GuildId } from '../ids';
import { token, type ServiceToken } from './container';

import type { MessageRepo } from '../../persistence/repositories/message.repo';
import type { ReplyRepo } from '../../persistence/repositories/reply.repo';
import type { ConnectionManager } from '../../infra/mongo/connection-manager';

/** Per-guild repository factory shape. */
export type RepoFactory<R> = (guildId: GuildId) => R;

export interface Tokens {
  // ----- Phase 2 (this PR) -----
  readonly ConnectionManager: ServiceToken<ConnectionManager>;
  readonly MessageRepoFactory: ServiceToken<RepoFactory<MessageRepo>>;
  readonly ReplyRepoFactory: ServiceToken<RepoFactory<ReplyRepo>>;
}

export const TOKENS: Tokens = {
  ConnectionManager: token<ConnectionManager>('ConnectionManager'),
  MessageRepoFactory: token<RepoFactory<MessageRepo>>('MessageRepoFactory'),
  ReplyRepoFactory: token<RepoFactory<ReplyRepo>>('ReplyRepoFactory'),
};
