/**
 * The `/roll_call activity_id:` branch: claim a stored activity and turn
 * its participant list into guild members.
 *
 * Split out of `index.ts` (150-line cap) and shaped as a discriminated
 * outcome so the handler answers every rejection with a catalog key
 * instead of branching on nulls inline. A repo `err` is re-thrown rather
 * than folded into an outcome — it belongs to the handler's error
 * boundary, which stamps a trace id.
 */
import type { Guild, GuildMember } from 'discord.js';

import type { Repos } from '../../../persistence/repositories';

type ActivityParticipantsOutcome =
  | { readonly status: 'ok'; readonly members: readonly GuildMember[] }
  | { readonly status: 'no_guild' }
  | { readonly status: 'no_db' }
  | { readonly status: 'activity_not_found' }
  | { readonly status: 'no_participants' }
  | { readonly status: 'already_consumed' };

/**
 * Consume the activity and resolve its participants.
 *
 * The delete is the concurrency control: Mongo's `deleteOne` is atomic,
 * so when two `/roll_call`s race on the same `activity_id` the first
 * wins and the second sees `already_consumed` and bails before
 * re-posting the announcement.
 */
export const claimActivityParticipants = async (
  guild: Guild | null,
  repos: Pick<Repos, 'activity'> | undefined,
  activityId: string,
): Promise<ActivityParticipantsOutcome> => {
  if (guild === null) return { status: 'no_guild' };
  if (repos === undefined) return { status: 'no_db' };

  const activityResult = await repos.activity.findByActivityId(activityId);
  if (!activityResult.ok) throw activityResult.error;
  const activity = activityResult.value;
  if (!activity) return { status: 'activity_not_found' };

  const members: GuildMember[] = [];
  for (const participant of activity.participants) {
    const member = guild.members.cache.get(participant);
    if (member) members.push(member);
  }
  if (members.length === 0) return { status: 'no_participants' };

  const deletedResult = await repos.activity.deleteByActivityId(activityId);
  if (!deletedResult.ok) throw deletedResult.error;
  if (!deletedResult.value) return { status: 'already_consumed' };

  return { status: 'ok', members };
};

/** Catalog key + params for every non-`ok` outcome. */
export const activityParticipantsReply = (
  outcome: Exclude<ActivityParticipantsOutcome, { status: 'ok' }>,
  activityId: string,
): { readonly key: string; readonly params?: Record<string, string> } => {
  switch (outcome.status) {
    case 'no_guild':
      return { key: 'errors:command.guild_not_found' };
    case 'no_db':
      return { key: 'errors:db.not_found' };
    case 'activity_not_found':
      return { key: 'replies:roll_call.activity_not_found', params: { id: activityId } };
    case 'no_participants':
      return { key: 'replies:roll_call.no_participants' };
    case 'already_consumed':
      return { key: 'replies:roll_call.activity_already_consumed', params: { id: activityId } };
  }
};
