/**
 * Minimal guild-channel builder for handler / plugin tests. Returns the
 * structural subset the `/traffic` visibility filter touches — `id`,
 * `name`, `type`, `parentId`, `parent`, and a `permissionsFor(subject)`
 * stub whose `ViewChannel` answer is driven by `viewableBy*`.
 *
 * The `@everyone` role and members are identified by id, so the stub
 * grants ViewChannel when the subject's id is in `viewableBy` (or when
 * `viewableByAll` is set, the default for an ordinary public channel).
 */
import { ChannelType, type GuildBasedChannel, type GuildMember, type Role } from 'discord.js';

export interface BuildChannelInput {
  readonly id: string;
  readonly name?: string;
  readonly type?: ChannelType;
  readonly parentId?: string | null;
  /** Parent channel used for a thread's ViewChannel inheritance. */
  readonly parent?: GuildBasedChannel | null;
  /** Subject ids (member or role id) granted ViewChannel. */
  readonly viewableBy?: ReadonlySet<string>;
  /** When true every subject may view; default for a simple public channel. */
  readonly viewableByAll?: boolean;
  /** When true `permissionsFor` returns null (permissions uncomputable). */
  readonly permissionsNull?: boolean;
}

export const buildTextChannel = (input: BuildChannelInput): GuildBasedChannel => {
  const viewableByAll = input.viewableByAll ?? true;
  const permissionsFor = (
    subject: GuildMember | Role,
  ): { has: (flag: bigint) => boolean } | null => {
    if (input.permissionsNull === true) return null;
    const subjectId = subject.id;
    const granted = viewableByAll || (input.viewableBy?.has(subjectId) ?? false);
    return { has: () => granted };
  };
  return {
    id: input.id,
    name: input.name ?? `channel-${input.id}`,
    type: input.type ?? ChannelType.GuildText,
    parentId: input.parentId ?? null,
    parent: input.parent ?? null,
    permissionsFor,
  } as unknown as GuildBasedChannel;
};
