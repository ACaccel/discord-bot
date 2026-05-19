import type { Client} from 'discord.js';
import { ActivityType, Events } from 'discord.js';
import type { Config } from '@bot';
import { BaseBot } from '@bot';
import { createLlmChatPlugin } from '@plugins';

/**
 * Konata composition root. Phase 4b-3 relocated the entire LLM chat
 * lifecycle (session management, provider dispatch, chunked reply,
 * pre-warm) into {@link createLlmChatPlugin}; this class registers
 * that plugin and a Discord presence.
 *
 * Listener override policy: Konata is a pure LLM-chat bot. It must
 * NOT log reactions or run guild-create initialisation — both are
 * non-chat sinks. After Phase 4b-2 the message-event listeners
 * (messageCreate / messageUpdate / messageDelete / guildMemberUpdate)
 * default to no-op on BaseBot, so those overrides were dropped; the
 * three remaining overrides below mirror listeners BaseBot still
 * wires to legacy handlers (reactionAdd/Remove → executeReaction*,
 * guildCreate → detectGuildCreate) and must stay silent for Konata.
 */
export class Konata extends BaseBot<Config> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: Config) {
        super(client, token, mongoURI, clientId, config);
        this.use(createLlmChatPlugin({ clientId: this.clientId }));
        this.registerPresence();
    }

    // Suppress non-chat listeners BaseBot still routes to legacy
    // handlers. See class docstring for the rationale.
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
