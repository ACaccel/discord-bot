/**
 * VoicePlugin — owns the bot-scoped {@link VoiceRecorder} + the
 * per-session {@link VoiceConnection}.
 *
 * Module-holder pattern (mirrors `infra/llm/models-catalog.ts`): plugin
 * `init` constructs the controller and stores it in a module-scoped
 * holder. `BaseBot.run()` reads the holder after `host.initAll()` and
 * surfaces it on `bot.voice` so the handler access path is a single
 * field read. The handler does not construct or mutate the recorder;
 * it calls `bot.voice.start / stop / save`.
 *
 * The holder is a small compromise — the plugin contract intentionally
 * forbids re-entering the IoC container, so this is the documented
 * pattern for "plugin-built service that needs a stable cross-cut
 * lookup". See ModelCatalog for prior art.
 */
import { TOKENS } from '../../core/ioc';
import type { Plugin } from '../../core/plugin';
import { setActiveVoiceController, VoiceController } from './internal';

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
      setActiveVoiceController(new VoiceController(client));
    },
  };
};

export { VoiceController, getActiveVoiceController } from './internal';
