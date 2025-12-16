import { 
    Client,
} from 'discord.js';
import { BaseBot, Config } from '@bot';

interface TomoriConfig extends Config {

}

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
    }
}