import type { Client} from 'discord.js';
import { ActivityType, Events } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import { createLlmChatPlugin } from '@plugins';

/**
 * Konata composition root. The entire LLM chat lifecycle (session
 * management, provider dispatch, chunked reply, pre-warm) lives in
 * {@link createLlmChatPlugin}; this class registers that plugin and a
 * Discord presence.
 *
 * Listener override policy: Konata is a pure LLM-chat bot. It must
 * NOT log reactions or run guild-create initialisation — both are
 * non-chat sinks. The message-event listeners (messageCreate /
 * messageUpdate / messageDelete / guildMemberUpdate) already default
 * to no-op on BaseBot, so they need no override here; the three
 * overrides below silence the listeners BaseBot still wires
 * (reactionAdd/Remove → executeReaction*, guildCreate →
 * GuildOnboardingPort), which Konata does not want.
 */
export class Konata extends BaseBot<Config> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.use(createLlmChatPlugin({ clientId: this.clientId }));
        this.registerPresence();
    }

    // Suppress the non-chat listeners BaseBot wires. See the class
    // docstring for the rationale.
    public override messageReactionAddListener = async (): Promise<void> => {};
    public override messageReactionRemoveListener = async (): Promise<void> => {};
    public override guildCreateListener = async (): Promise<void> => {};

    /**
     * Without an explicit presence, Discord clients tend to render an idle bot
     * as offline even though its gateway session is still alive. Register a
     * ready-time presence so konata reliably appears online with a custom
     * status line.
     */
    private registerPresence(): void {
        this.client.once(Events.ClientReady, () => {
            const text = this.translator?.t('replies:konata.presence_text') ?? '';
            if (text.length === 0) return;
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
