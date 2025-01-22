import { BaseBot } from '@dcbotTypes';
import tomoriConfig from './config.json';

export class Tomori extends BaseBot {
    public tomoriConfig: TomoriConfig;
    public constructor(client: any, token: string, mongoURI: string, clientId: string, config: any) {
        super(client, token, mongoURI, clientId, config);
        this.tomoriConfig = tomoriConfig as TomoriConfig;
    }
}

interface TomoriConfig {
}