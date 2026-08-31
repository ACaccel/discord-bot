import type { GuildMember } from 'discord.js';

import { requireCapture } from '../../../core/regex-capture';

/**
 * Maximum unique (non-bot) members a single `/roll_call` may target after
 * role expansion and de-duplication, matching the project's feature-ceiling
 * convention (e.g. `MAX_TEMP_ROLE_DAYS`). Beyond it the command rejects so
 * one command cannot ping an unbounded crowd.
 */
export const ROLL_CALL_MAX_TARGETS = 50;

/** Minimal member shape the resolver depends on; `GuildMember` in
 *  production, a plain stub in tests so no live client is needed. */
export interface MemberLike {
  readonly id: string;
}

/** Mention IDs parsed from the raw `users` option, split by kind and
 *  de-duplicated while preserving first-seen order within each kind. */
interface ParsedMentions {
  readonly userIds: string[];
  readonly roleIds: string[];
}

// Whole-string shape: whitespace-separated user (`<@id>` / `<@!id>` nickname
// form) or role (`<@&id>`) mentions, and nothing else.
const ROLL_CALL_MENTIONS_PATTERN = /^<@[!&]?\d+>(\s*<@[!&]?\d+>)*$/;
// Per-token capture: group 1 is the discriminator (`&` = role), group 2 the id.
const MENTION_TOKEN_PATTERN = /<@(!|&)?(\d+)>/g;

/**
 * Parse the raw `users` string into de-duplicated user and role IDs, or
 * `null` when it is not a clean sequence of user/role mentions (the handler
 * maps that to a format error). Pure: unit-testable without a client.
 */
export const parseRollCallMentions = (raw: string): ParsedMentions | null => {
  if (!ROLL_CALL_MENTIONS_PATTERN.test(raw)) {
    return null;
  }

  const userIds = new Set<string>();
  const roleIds = new Set<string>();
  for (const match of raw.matchAll(MENTION_TOKEN_PATTERN)) {
    const id = requireCapture(match, 2);
    if (match[1] === '&') {
      roleIds.add(id);
    } else {
      userIds.add(id);
    }
  }

  return { userIds: [...userIds], roleIds: [...roleIds] };
};

/**
 * Member-lookup seam injected by the handler so the resolver stays pure and
 * client-free. The handler's implementation excludes bots and orders each
 * role's members; the resolver only sequences and de-dupes.
 */
export interface MemberSource<M extends MemberLike = GuildMember> {
  readonly guildId: string;
  getMember(userId: string): M | undefined;
  roleExists(roleId: string): boolean;
  /** Non-bot members holding the role, already ordered by the caller. */
  membersOfRole(roleId: string): M[];
}

/** Discriminated result of resolving the `users` option into members. */
export type ResolveTargetsOutcome<M extends MemberLike = GuildMember> =
  | { readonly status: 'ok'; readonly members: M[] }
  | { readonly status: 'format_error' }
  | { readonly status: 'everyone_not_allowed' }
  | { readonly status: 'user_not_found'; readonly id: string }
  | { readonly status: 'role_no_members'; readonly id: string }
  | { readonly status: 'empty' }
  | { readonly status: 'too_many'; readonly count: number; readonly max: number };

/**
 * Resolve the raw `users` option into a de-duplicated member list, expanding
 * each role mention to its members. Direct user mentions keep their typed
 * order and come first; role members follow in role-mention order; a member
 * referenced more than once appears once. The first specific failure (format,
 * `@everyone`, unresolved user, empty/unknown role) wins over the size cap.
 */
export const resolveRollCallTargets = <M extends MemberLike>(
  raw: string,
  source: MemberSource<M>,
  maxTargets: number,
): ResolveTargetsOutcome<M> => {
  const parsed = parseRollCallMentions(raw);
  if (!parsed) {
    return { status: 'format_error' };
  }

  // `@everyone` / `@here` is the role whose id equals the guild id.
  if (parsed.roleIds.includes(source.guildId)) {
    return { status: 'everyone_not_allowed' };
  }

  const seen = new Set<string>();
  const members: M[] = [];
  const addUnseen = (member: M): void => {
    if (!seen.has(member.id)) {
      seen.add(member.id);
      members.push(member);
    }
  };

  for (const userId of parsed.userIds) {
    const member = source.getMember(userId);
    if (!member) {
      return { status: 'user_not_found', id: userId };
    }
    addUnseen(member);
  }

  for (const roleId of parsed.roleIds) {
    if (!source.roleExists(roleId)) {
      return { status: 'role_no_members', id: roleId };
    }
    const roleMembers = source.membersOfRole(roleId);
    if (roleMembers.length === 0) {
      return { status: 'role_no_members', id: roleId };
    }
    roleMembers.forEach(addUnseen);
  }

  if (members.length === 0) {
    return { status: 'empty' };
  }
  if (members.length > maxTargets) {
    return { status: 'too_many', count: members.length, max: maxTargets };
  }

  return { status: 'ok', members };
};
