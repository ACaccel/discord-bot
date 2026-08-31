import type { StringSelectMenuInteraction } from 'discord.js';
import type { BaseBot } from '@bot';

import { createCustomIdDispatcher, createHandlerRegistrar, type HandlerBarrelSpec } from 'handlers';
// `./ssm-handler` is imported BEFORE `./registry.generated` so the
// abstract class is on `module.exports` by the time the generated
// registry pulls in handler subclasses. See `ssm-handler.ts`.
import { SSMHandler } from './ssm-handler';
import { SSM_REGISTRY } from './registry.generated';

export { SSMHandler };

const SSM_BARREL: HandlerBarrelSpec<SSMHandler> = {
  registry: SSM_REGISTRY,
  label: 'string select menu',
  assign: (bot: BaseBot, handlers) => {
    bot.ssmHandlers = handlers;
  },
  read: (bot: BaseBot) => bot.ssmHandlers,
};

export const registerSSMs = createHandlerRegistrar(SSM_BARREL);
export const executeSSM = createCustomIdDispatcher<StringSelectMenuInteraction, SSMHandler>(
  SSM_BARREL,
);
