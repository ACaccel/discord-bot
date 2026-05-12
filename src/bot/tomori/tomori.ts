import { Client } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { AutoReplyPlugin } from '@plugins';

interface TomoriConfig extends Config {}

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Phase 4b-2: pre-migration BaseBot called `auto_reply` on every
        // messageCreate. Tomori's config has no `guilds` section so
        // there were no configured channels, but the bot still fanned
        // DB-backed replies through whichever guilds it joined at
        // runtime. Preserve that behaviour explicitly via the plugin.
        this.use(AutoReplyPlugin);
    }
}
