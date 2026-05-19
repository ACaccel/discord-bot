import type { Client } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import { AutoReplyPlugin, createActivityPlugin, createGiveawayPlugin, createVoicePlugin } from '@plugins';

type TomoriConfig = Config;

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
        // Phase 4b: BaseBot used to invoke `auto_reply` +
        // `rebootGiveawayJobs` + `rebootActivityJobs` unconditionally
        // for every bot. Tomori preserves that behaviour by opting
        // into the same plugins explicitly. PR-G4 dropped the
        // `rebootJobs` callback config — plugins now resolve their
        // deps through `ctx` so the composition root no longer
        // deep-imports `plugins/*/internal`.
        this.use(AutoReplyPlugin);
        this.use(createGiveawayPlugin());
        this.use(createActivityPlugin());
        this.use(createVoicePlugin());
    }
}
