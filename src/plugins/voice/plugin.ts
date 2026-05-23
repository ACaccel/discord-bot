/**
 * VoicePlugin — owns the bot-scoped {@link VoiceRecorder} + the
 * per-session {@link VoiceConnection}.
 *
 * Wiring contract (R2): `init` builds the controller and publishes it
 * under `TOKENS.VoiceController` via `ctx.registerInstance` — the
 * narrow DI facade exposed only inside the init phase. Handlers reach
 * the live controller through `bot.voice`, a getter that resolves the
 * token from the IoC container. The prior module-scope holder
 * (`internal/active-controller.ts`) has been removed; there is now
 * exactly one path — IoC token resolution — from plugin to consumer.
 */
import { TOKENS } from '../../core/plugin';
import type { Plugin } from '../../core/plugin';
import { VoiceController } from './internal';

const PLUGIN_ID = 'voice';
const PLUGIN_VERSION = '1.0.0';

export const createVoicePlugin = (): Plugin => {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    scope: 'bot',
    critical: false,

    async init(ctx): Promise<void> {
      const client = ctx.resolve(TOKENS.DiscordClient);
      ctx.registerInstance(TOKENS.VoiceController, new VoiceController(client));
    },
  };
};

export { VoiceController } from './internal';
