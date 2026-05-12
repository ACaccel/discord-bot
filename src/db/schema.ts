/**
 * @deprecated Re-export shim. The canonical schemas now live in
 *   `src/persistence/schemas/`. This file is kept only so legacy call
 *   sites in `src/bot/**`, `src/handlers/**`, and `src/features/**` keep
 *   compiling through Phase 2/3. Phase 4b removes it.
 */
export {
  fetchSchema,
  messageSchema,
  replySchema,
  todoSchema,
  giveawaySchema,
  activitySchema,
  userApiSettingSchema,
  SCHEMAS,
  type SchemaName,
  type DocByName,
  type FetchDoc,
  type MessageDoc,
  type ReplyDoc,
  type TodoDoc,
  type GiveawayDoc,
  type ActivityDoc,
  type UserApiSettingDoc,
} from '../persistence/schemas';
