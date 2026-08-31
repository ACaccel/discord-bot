/**
 * `/record` availability path.
 *
 * The reply copy promises a trace id, but the "voice controller not
 * registered" branch answered with `replies:record.failed` and no
 * parameters, so the user saw a literal `{{traceId}}` and the operator
 * had nothing to correlate it with.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';

import RecordCommand from '../../../../src/handlers/commands/record';
import { buildFakeBot, echoTranslatorWithParams } from '../../../fixtures/discord/bot-fake';

const build = (voice: unknown) => {
  const { bot, logger } = buildFakeBot({ voice, translator: echoTranslatorWithParams() });

  const interaction = {
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
    deferred: true,
    replied: false,
    guild: { id: 'g1' },
    options: { get: (name: string) => (name === 'action' ? { value: 'stop' } : undefined) },
  } as unknown as ChatInputCommandInteraction;

  return { bot, interaction, error: logger.error };
};

afterEach(() => vi.clearAllMocks());

describe('record', () => {
  it('stamps a trace id when the voice controller is not registered', async () => {
    const { bot, interaction, error } = build(undefined);

    await new RecordCommand().execute(interaction, bot);

    const content = (interaction.editReply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      content: string;
    };
    expect(content.content).toContain('replies:record.failed');
    // The copy interpolates {{traceId}}; without a parameter the user
    // saw the placeholder and the operator got no log line.
    expect(content.content).toContain('traceId');
    expect(error).toHaveBeenCalled();
  });

  it('reports no active recording when the controller is idle', async () => {
    const { bot, interaction } = build({ isRecording: () => false, stop: vi.fn() });

    await new RecordCommand().execute(interaction, bot);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:record.no_recording',
    });
  });

  it('stops an active recording', async () => {
    const stop = vi.fn();
    const { bot, interaction } = build({ isRecording: () => true, stop });

    await new RecordCommand().execute(interaction, bot);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'replies:record.stopped' });
  });
});
