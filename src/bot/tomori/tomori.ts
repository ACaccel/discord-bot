import { Client } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { AutoReplyPlugin, createActivityPlugin, createGiveawayPlugin, createVoicePlugin } from '@plugins';
import { rebootActivityJobs } from '../../plugins/activity/internal';
import { rebootGiveawayJobs } from '../../plugins/giveaway/internal';

interface TomoriConfig extends Config {}

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Phase 4b: BaseBot used to invoke `auto_reply` +
        // `rebootGiveawayJobs` + `rebootActivityJobs` unconditionally
        // for every bot. Tomori preserves that behaviour by opting
        // into the same three plugins explicitly.
        this.use(AutoReplyPlugin);
        this.use(createGiveawayPlugin({ rebootJobs: () => rebootGiveawayJobs(this) }));
        this.use(createActivityPlugin({ rebootJobs: () => rebootActivityJobs(this) }));
        this.use(createVoicePlugin());
    }
}
