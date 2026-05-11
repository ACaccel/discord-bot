/**
 * Typed model registry for a single mongoose connection.
 *
 * Replaces the previous `Record<string, Model<any>>` stringly-typed map
 * (built via an `(schema as any)[modelName]` walk) with an explicit
 * builder that hands `connection.model('Name', schema)` to every entry
 * and returns a structurally-typed `Models` object.
 *
 * Adding a new model requires:
 *   1. defining the schema in `./schema.ts` and adding it to `SCHEMAS`
 *   2. extending `DocByName` in `./types.ts`
 *   3. adding one line to `buildModels` below
 *
 * The three locations are deliberate — `Models` is the contract callers
 * type against, and a missing entry here would silently produce a model
 * with `Model<unknown>` which the strict tsconfig will reject.
 */
import type { Connection, Model } from 'mongoose';
import {
  fetchSchema,
  messageSchema,
  replySchema,
  todoSchema,
  giveawaySchema,
  activitySchema,
  userApiSettingSchema,
  type SchemaName,
} from './schema';
import type { DocByName } from './types';

export type Models = {
  readonly [K in SchemaName]: Model<DocByName[K]>;
};

/**
 * Build a fully-typed Models map against the given mongoose connection.
 * Every value is `connection.model(...)`, never the default mongoose
 * connection's models — keeping per-guild isolation correct.
 */
export const buildModels = (connection: Connection): Models => ({
  Fetch: connection.model<DocByName['Fetch']>('Fetch', fetchSchema),
  Message: connection.model<DocByName['Message']>('Message', messageSchema),
  Reply: connection.model<DocByName['Reply']>('Reply', replySchema),
  Todo: connection.model<DocByName['Todo']>('Todo', todoSchema),
  Giveaway: connection.model<DocByName['Giveaway']>('Giveaway', giveawaySchema),
  Activity: connection.model<DocByName['Activity']>('Activity', activitySchema),
  UserApiSetting: connection.model<DocByName['UserApiSetting']>(
    'UserApiSetting',
    userApiSettingSchema,
  ),
});
