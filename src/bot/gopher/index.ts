import { Gopher } from './gopher';
import config from './config.json';

import { bootstrapPersonality, MESSAGE_BOT_INTENTS } from '../bootstrap';

// gopher is database-free: it has no per-guild repositories, so MONGO_URI
// is not required. `requirePort` is true because the settings REST API
// needs a listening port.
bootstrapPersonality({
  name: 'gopher',
  intents: MESSAGE_BOT_INTENTS,
  env: { requirePort: true, requireDb: false },
  // `requirePort` above guarantees `env.PORT` is defined; the assertion
  // documents that invariant for the type checker. An empty MONGO_URI is
  // passed through deliberately (no database) — see `Gopher` / `BaseBot`.
  build: (client, env) =>
    new Gopher(
      client,
      env.TOKEN,
      env.MONGO_URI ?? '',
      env.CLIENT_ID,
      config,
      env.PORT as number,
      env.GOPHER_SETTINGS_API_KEY,
    ),
});
