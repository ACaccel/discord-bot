import type { ModalSubmitInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

import { createCustomIdDispatcher, createHandlerRegistrar, type HandlerBarrelSpec } from 'handlers';
// `./modal-handler` is imported BEFORE `./registry.generated` so the
// abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses. See `modal-handler.ts`.
import { ModalHandler } from './modal-handler';
import { MODAL_REGISTRY } from './registry.generated';

export { ModalHandler };

const MODAL_BARREL: HandlerBarrelSpec<ModalHandler> = {
  registry: MODAL_REGISTRY,
  label: 'modal',
  assign: (bot: BaseBot, handlers) => {
    bot.modalHandlers = handlers;
  },
  read: (bot: BaseBot) => bot.modalHandlers,
};

export const registerModals = createHandlerRegistrar(MODAL_BARREL);
export const executeModal = createCustomIdDispatcher<ModalSubmitInteraction, ModalHandler>(
  MODAL_BARREL,
);
