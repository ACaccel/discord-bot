/**
 * Encapsulates `VoiceRecorder` + the active `VoiceConnection` for the
 * record slash command, so the handler drives recording through this
 * controller instead of mutating loose `BaseBot` state.
 */
import { joinVoiceChannel, type DiscordGatewayAdapterCreator } from '@discordjs/voice';
import type { VoiceConnection } from '@discordjs/voice';
import { VoiceRecorder } from '@kirdock/discordjs-voice-recorder';
import type { Client } from 'discord.js';
import type { Writable } from 'node:stream';

/**
 * Snapshot returned by {@link VoiceController.save}. Caller assembles
 * the discord.js `AttachmentBuilder` outside the controller so the
 * plugin keeps minimal Discord SDK builder dependencies (the
 * `joinVoiceChannel` adapter is the only one we cannot avoid).
 */
interface VoiceSaveResult {
  readonly buffer: Buffer;
}

export class VoiceController {
  private connection: VoiceConnection | null = null;
  public readonly recorder: VoiceRecorder;

  public constructor(client: Client) {
    this.recorder = new VoiceRecorder({}, client);
  }

  public isRecording(): boolean {
    return this.connection !== null && this.recorder.isRecording();
  }

  /**
   * Join the voice channel and start the recorder. Returns the live
   * connection so the caller can chain disconnect logic if needed.
   */
  public start(
    guildId: string,
    channelId: string,
    adapterCreator: DiscordGatewayAdapterCreator,
  ): VoiceConnection {
    this.connection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator,
      selfDeaf: false,
    });
    this.recorder.startRecording(this.connection);
    return this.connection;
  }

  /** Stop the recorder and destroy the connection. No-op if not recording. */
  public stop(): void {
    if (this.connection === null) return;
    this.recorder.stopRecording(this.connection);
    this.connection.destroy();
    this.connection = null;
  }

  /**
   * Drain the recorder buffer for the last `durationMinutes`. The
   * `voiceStream` is the filesystem-mirror sink — kept as a
   * caller-supplied stream so the plugin stays free of `fs` deps.
   */
  public async save(
    guildId: string,
    durationMinutes: number,
    voiceStream: Writable,
  ): Promise<VoiceSaveResult> {
    if (this.connection === null) {
      return { buffer: Buffer.alloc(0) };
    }
    await this.recorder.getRecordedVoice(voiceStream, guildId, 'separate', durationMinutes);
    const buffer = await this.recorder.getRecordedVoiceAsBuffer(
      guildId,
      'separate',
      durationMinutes,
    );
    return { buffer };
  }
}
