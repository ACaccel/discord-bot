# Adding a plugin

Part of the [contributing guide](../../CONTRIBUTING.md).

Plugins are the right home for behaviours that are bot-scoped, not
interaction-scoped: scheduled jobs, event subscriptions, message
listeners, etc.

1. **Create the plugin folder.** Mirror the layout existing plugins
   use:

   ```
   src/plugins/<plugin-name>/
     plugin.ts   # ConfigSchema (private const) + factory
     index.ts    # re-exports the factory + the inferred config type
   ```

   Keep the schema inside `plugin.ts` so the factory, the schema, and
   the inferred config type stay co-located.

2. **Implement the contract** (see `src/core/plugin/types.ts` for
   `Plugin`, `PluginRuntimeContext`, and friends):

   ```ts
   // src/plugins/<plugin-name>/plugin.ts
   import { z } from 'zod';
   import { type Plugin } from '../../core/plugin';
   import { TOKENS } from '../../bot/tokens';

   const PLUGIN_ID = 'xxx';
   const PLUGIN_VERSION = '1.0.0';

   const ConfigSchema = z
     .object({
       cooldownSeconds: z.number().int().min(0).default(0),
     })
     .strict();

   export type XxxConfig = z.infer<typeof ConfigSchema>;

   /**
    * The factory parses `rawConfig` up front so the returned Plugin
    * object can close over a fully-typed `config`.
    */
   export const createXxxPlugin = (rawConfig: unknown): Plugin => {
     const config: XxxConfig = ConfigSchema.parse(rawConfig);

     return {
       id: PLUGIN_ID,
       version: PLUGIN_VERSION,

       events: {
         messageCreate: async (ctx, message): Promise<void> => {
           if (message.guildId === null) return;
           // Per-channel suppression is centralised in PermissionRankPolicy —
           // do NOT reintroduce a per-plugin `blockedChannels` list. Add a key
           // to `RankedFeature` in `core/plugin/permission-rank-policy.ts`,
           // then gate on it here:
           const policy = ctx.resolve(TOKENS.PermissionRankPolicy);
           if (policy.isSuppressed(message.guildId, 'guild_events', message.channelId)) return;

           ctx.logger.debug(
             {
               guildId: message.guildId,
               channelId: message.channelId,
               cooldownSeconds: config.cooldownSeconds,
             },
             'xxx: handling message',
           );
         },
       },
     };
   };
   ```

   `init` / `start` / `onReady` / `onShutdown` are all optional. Add
   them only when the plugin has actual setup work. A hook that throws
   marks the plugin disabled and the bot keeps running — a plugin
   cannot abort startup.

   The plugin object carries no config field: the factory parses the
   raw block up front (`parse<X>Config`) and the returned object closes
   over the result, so a malformed block fails the boot rather than the
   first event.

   Slash commands and other handlers are **not** declared here. They
   live under `src/handlers/` and are picked up by the codegen registry,
   which is the single registration mechanism.

3. **Export the factory.**

   ```ts
   // src/plugins/<plugin-name>/index.ts
   export { createXxxPlugin, type XxxConfig } from './plugin';
   ```

   Then add the matching line to
   [`src/plugins/index.ts`](../../src/plugins/index.ts).

4. **Add i18n keys** for any user-facing strings (see the
   [slash-command recipe](adding-a-command.md)).

5. **Register the plugin** in the bots that want it:

   ```ts
   // src/bot/nijika/nijika.ts
   import { createXxxPlugin } from '@plugins';

   export class Nijika extends BaseBot<NijikaConfig> {
     public constructor(/* … */) {
       super(/* … */);
       this.use(createXxxPlugin({ cooldownSeconds: 0 }));
     }
   }
   ```

   `this.use(...)` is fluent (returns `this`), so multiple registrations
   can chain.

6. **Add tests.** Pure logic gets unit tests; the wiring (event
   subscriptions, lifecycle hooks if any) gets a plugin-level test
   that constructs a fake `PluginEventContext` / `PluginRuntimeContext`.
   See `test/unit/plugins/` for the established shape.

## Plugin ↔ IoC contract

A plugin reads the token catalog from the composition root:

```ts
import { TOKENS } from '../../bot/tokens';
```

The catalog lives at `src/bot/tokens.ts` rather than in `core` because
it names concrete `infra` / `persistence` / `plugins` types, and `core`
may depend on nothing outside itself. Any direct import of `@core/ioc`
from `src/plugins/**` is rejected by ESLint at lint time, as is any
import of a personality composition root (`src/bot/<name>/**`). From
`init`, `start`, `onReady`, `onShutdown`, and event handlers, plugins:

- **Read** dependencies with `ctx.resolve(token)`.
- **Publish** instances with `ctx.registerInstance(token, instance)` —
  permitted **only inside `init`**.

There is no escape hatch to the `ServiceContainer`'s write face. Do
not cast `ctx` to gain access; tests and review will catch it.

New tokens go in [`src/bot/tokens.ts`](../../src/bot/tokens.ts), the
single catalog every layer resolves against.
