/**
 * Repository barrel.
 *
 * Re-exports every repo interface + Mongo impl + the aggregate
 * {@link Repos} bag used by composition roots to build a per-guild
 * repository set in one call (`buildRepos(guildConnection)`).
 *
 * Adding a new repo means: write the file, append to the exports
 * below, add a key to `Repos`, and add one line to `buildRepos`.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';

import { MongoActivityRepo, type ActivityRepo } from './activity.repo';
import { MongoFetchRepo, type FetchRepo } from './fetch.repo';
import { MongoGiveawayRepo, type GiveawayRepo } from './giveaway.repo';
import { MongoMessageRepo, type MessageRepo } from './message.repo';
import { MongoReplyRepo, type ReplyRepo } from './reply.repo';
import { MongoTodoRepo, type TodoRepo } from './todo.repo';
import { MongoUserApiSettingRepo, type UserApiSettingRepo } from './user-api-setting.repo';

export { MongoActivityRepo, type ActivityRepo, type ActivityInput } from './activity.repo';
export { MongoFetchRepo, type FetchRepo } from './fetch.repo';
export { MongoGiveawayRepo, type GiveawayRepo, type GiveawayInput } from './giveaway.repo';
export { MongoMessageRepo, type MessageRepo, type InsertResult } from './message.repo';
export { MongoReplyRepo, type ReplyRepo } from './reply.repo';
export { MongoTodoRepo, type TodoRepo } from './todo.repo';
export {
  MongoUserApiSettingRepo,
  type UserApiSettingRepo,
  type UserApiSettingDefaults,
  type UserApiSettingPatch,
} from './user-api-setting.repo';

/**
 * Per-guild repository bag. Composition roots build one of these per
 * guild from the guild's {@link GuildConnection} and stash it where
 * handlers can read it.
 */
export interface Repos {
  readonly activity: ActivityRepo;
  readonly fetch: FetchRepo;
  readonly giveaway: GiveawayRepo;
  readonly message: MessageRepo;
  readonly reply: ReplyRepo;
  readonly todo: TodoRepo;
  readonly userApiSetting: UserApiSettingRepo;
}

/**
 * Build the full {@link Repos} set against one guild's connection.
 * Defined here (not in `core/ioc`) so the IoC layer stays free of
 * persistence imports — composition roots register this builder as
 * the implementation of every `*RepoFactory` token.
 */
export const buildRepos = (conn: GuildConnection): Repos => ({
  activity: new MongoActivityRepo(conn),
  fetch: new MongoFetchRepo(conn),
  giveaway: new MongoGiveawayRepo(conn),
  message: new MongoMessageRepo(conn),
  reply: new MongoReplyRepo(conn),
  todo: new MongoTodoRepo(conn),
  userApiSetting: new MongoUserApiSettingRepo(conn),
});
