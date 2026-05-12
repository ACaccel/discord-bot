/**
 * Expected absence — the operation referenced an entity that simply
 * does not exist (guild, channel, message, giveaway, etc.). Distinct
 * from `ValidationError`: the input *shape* was valid, the resource
 * is just gone.
 */
import { DomainError, type DomainErrorInit } from './domain-error';

export type NotFoundErrorCode =
  | 'GUILD_NOT_FOUND'
  | 'CHANNEL_NOT_FOUND'
  | 'MESSAGE_NOT_FOUND'
  | 'USER_NOT_FOUND'
  | 'GIVEAWAY_NOT_FOUND'
  | 'ACTIVITY_NOT_FOUND'
  | 'SETTING_NOT_FOUND'
  | 'RECORD_NOT_FOUND';

export class NotFoundError<
  P extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends DomainError<NotFoundErrorCode, P> {
  public override readonly kind = 'NotFoundError';
  public constructor(init: DomainErrorInit<NotFoundErrorCode, P>) {
    super(init);
  }
}
