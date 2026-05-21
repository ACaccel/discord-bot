import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import { AutoReplyPlugin, createActivityPlugin, createGiveawayPlugin, createVoicePlugin } from '@plugins';

type TomoriConfig = Config;

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Tomori opts into auto-reply, giveaway and activity behaviour
        // by registering the corresponding plugins explicitly. Plugins
        // resolve their dependencies through `ctx`, so the composition
        // root does not deep-import `plugins/*/internal`.
        this.use(AutoReplyPlugin);
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
    }
}
