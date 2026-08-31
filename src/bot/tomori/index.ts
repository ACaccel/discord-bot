import { Tomori } from './tomori';
import config from './config.json';

import { bootstrapPersonality, GUILD_OBSERVER_INTENTS } from '../bootstrap';

bootstrapPersonality({
  name: 'tomori',
  intents: GUILD_OBSERVER_INTENTS,
  build: (client, env) => new Tomori(client, env.TOKEN, env.MONGO_URI ?? '', env.CLIENT_ID, config),
});
