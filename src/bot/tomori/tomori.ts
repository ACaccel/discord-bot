import { Client } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { activity, giveaway } from '@features';
import { AutoReplyPlugin, createActivityPlugin, createGiveawayPlugin } from '@plugins';

interface TomoriConfig extends Config {}

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Phase 4b: BaseBot used to invoke `auto_reply` +
        // `rebootGiveawayJobs` + `rebootActivityJobs` unconditionally
        // for every bot. Tomori preserves that behaviour by opting
        // into the same three plugins explicitly.
        this.use(AutoReplyPlugin);
        this.use(createGiveawayPlugin({ rebootJobs: () => giveaway.rebootGiveawayJobs(this) }));
        this.use(createActivityPlugin({ rebootJobs: () => activity.rebootActivityJobs(this) }));
    }
}
