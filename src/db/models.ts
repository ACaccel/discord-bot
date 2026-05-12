/**
 * @deprecated Re-export shim. The typed `Models` map is now owned by
 *   `src/infra/mongo/connection-manager.ts`. This file re-exports the
 *   public type so legacy `bot.guildInfo[g].db` consumers keep
 *   compiling through Phase 2/3. Phase 4b removes it.
 */
export type { Models } from '../infra/mongo/connection-manager';
