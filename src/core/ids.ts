/**
 * Branded ID types.
 *
 * Discord and Mongo both surface IDs as plain strings, so a `string`
 * parameter cannot tell us whether the caller passed a guild id, a
 * channel id, or a message id. The brand below is structural (a `unique
 * symbol` field) so the compiler refuses to interchange them while the
 * runtime cost stays zero.
 *
 * Phase 1 introduces the brands at the data layer (db doc types,
 * repository signatures in Phase 2). Existing handler / event code
 * still uses bare `string`; new code should consume the branded forms
 * and call the `as*` constructors at the boundary where untyped
 * strings (Discord SDK, env) enter the system.
 */
type Brand<T, B> = T & { readonly __brand: B };

export type GuildId = Brand<string, 'GuildId'>;
export type ChannelId = Brand<string, 'ChannelId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type UserId = Brand<string, 'UserId'>;
export type RoleId = Brand<string, 'RoleId'>;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const brandCheck = (kind: string, value: unknown): string => {
  if (!isNonEmptyString(value)) {
    throw new TypeError(`Expected non-empty string for ${kind}, got ${typeof value}`);
  }
  return value;
};

export const asGuildId = (value: unknown): GuildId => brandCheck('GuildId', value) as GuildId;
export const asChannelId = (value: unknown): ChannelId =>
  brandCheck('ChannelId', value) as ChannelId;
export const asMessageId = (value: unknown): MessageId =>
  brandCheck('MessageId', value) as MessageId;
export const asUserId = (value: unknown): UserId => brandCheck('UserId', value) as UserId;
export const asRoleId = (value: unknown): RoleId => brandCheck('RoleId', value) as RoleId;
