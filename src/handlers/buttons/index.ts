import type { ButtonInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

import { createCustomIdDispatcher, createHandlerRegistrar, type HandlerBarrelSpec } from 'handlers';
// `./button-handler` is imported BEFORE `./registry.generated` so the
// abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses (which import the class back
// through this barrel). See `button-handler.ts`.
import { ButtonHandler } from './button-handler';
import { BUTTON_REGISTRY } from './registry.generated';

export { ButtonHandler };

const BUTTON_BARREL: HandlerBarrelSpec<ButtonHandler> = {
  registry: BUTTON_REGISTRY,
  label: 'button',
  assign: (bot: BaseBot, handlers) => {
    bot.buttonHandlers = handlers;
  },
  read: (bot: BaseBot) => bot.buttonHandlers,
};

export const registerButtons = createHandlerRegistrar(BUTTON_BARREL);
export const executeButton = createCustomIdDispatcher<ButtonInteraction, ButtonHandler>(
  BUTTON_BARREL,
);
