import { Konata } from './konata';
import config from './config.json';

import { bootstrapPersonality, MESSAGE_BOT_INTENTS } from '../bootstrap';

bootstrapPersonality({
  name: 'konata',
  intents: MESSAGE_BOT_INTENTS,
  build: (client, env) => new Konata(client, env.TOKEN, env.MONGO_URI ?? '', env.CLIENT_ID, config),
});
