import { ActivityType, Client, Events } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { createLlmChatPlugin } from '@plugins';

/**
 * Konata composition root. Phase 4b-3 relocated the entire LLM chat
 * lifecycle (session management, provider dispatch, chunked reply,
 * pre-warm) into {@link createLlmChatPlugin}; this class is left as a
 * thin BaseBot subclass that registers the plugin and a Discord
 * presence. No event listener overrides are needed — BaseBot's
 * defaults are no-op for every event Konata used to suppress.
 */
export class Konata extends BaseBot<Config> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.use(createLlmChatPlugin({ clientId: this.clientId }));
        this.registerPresence();
    }

    /**
     * Without an explicit presence, Discord clients tend to render an idle bot
     * as offline even though its gateway session is still alive. Register a
     * ready-time presence so konata reliably appears online with a custom
     * status line.
     */
    private registerPresence(): void {
        this.client.once(Events.ClientReady, () => {
            const text = '貧乳はステータスだ、希少価値だ！';
            this.client.user?.setPresence({
                status: 'online',
                activities: [{
                    name: text,
                    type: ActivityType.Custom,
                    state: text,
                }],
            });
        });
    }
}
