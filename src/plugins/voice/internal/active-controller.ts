/**
 * Module-scoped holder for the active {@link VoiceController}. Set by
 * the plugin's `init` hook, read by `BaseBot.run()` to surface the
 * controller on `bot.voice`. Mirrors the holder pattern in
 * `src/infra/llm/models-catalog.ts` — necessary because the plugin
 * contract does not expose the IoC container's `register` surface.
 */
import type { VoiceController } from './voice-controller';

let active: VoiceController | undefined;

export const setActiveVoiceController = (controller: VoiceController): void => {
  active = controller;
};

export const getActiveVoiceController = (): VoiceController | undefined => active;
