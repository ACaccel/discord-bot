/**
 * Branded ID types.
 *
 * Discord and Mongo both surface IDs as plain strings, so a `string`
 * parameter cannot tell us whether the caller passed a guild id or a
 * channel id. The brand below is structural so the compiler refuses to
 * interchange them while the runtime cost stays zero.
 *
 * Only the two ids that are actually keyed on at the data layer carry a
 * brand. Adding one per Discord snowflake would buy nothing but noise
 * at every call site.
 *
 * Branded forms are used at the data layer (db doc types, repository
 * signatures). Call the `as*` constructors at the boundary where
 * untyped strings (Discord SDK, env) enter the system.
 */
type Brand<T, B> = T & { readonly __brand: B };

export type GuildId = Brand<string, 'GuildId'>;
export type ChannelId = Brand<string, 'ChannelId'>;

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
