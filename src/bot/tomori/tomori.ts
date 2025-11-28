import { 
    Client,
    Message,
    PartialMessage,
    GuildMember,
    PartialGuildMember,
    MessageReaction,
    PartialMessageReaction
} from 'discord.js';
import { BaseBot, Config } from '@bot';
import { 
    auto_reply, 
    detectGuildCreate, 
    detectGuildMemberUpdate, 
    detectMessageDelete, 
    detectMessageUpdate,
} from '@event';
import { executeSlashCommand } from '@cmd';
import { executeButton } from '@button';
import { giveaway } from '@utils';
import { rollCallReact } from '@reaction';
import { executeModal } from '@modal';
import { executeSSM } from '@ssm';

interface TomoriConfig extends Config {

}

export class Tomori extends BaseBot<TomoriConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: TomoriConfig) {
        super(client, token, mongoURI, clientId, config);
    }

    public override interactionEventListener = async (interaction: any): Promise<void> => {
        switch (true) {
            case interaction.isChatInputCommand():
                await executeSlashCommand(interaction, this);
                break;
            case interaction.isModalSubmit():
                await executeModal(interaction, this);
                break;
            case interaction.isButton():
                await executeButton(interaction, this);
                break;
            case interaction.isStringSelectMenu():
                await executeSSM(interaction, this);
                break;
            default:
                if (!interaction.isAutocomplete()) {
                    await interaction.reply({ content: '目前尚不支援此類型的指令', ephemeral: true });
                }
                break;
        }
    }

    public override messageCreateListener = async (message: Message): Promise<void> => {
        if (message.guildId)
            await auto_reply(message, this, message.guildId, true);
    }

    public override messageUpdateListener = async (oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> => {
        await detectMessageUpdate(oldMessage, newMessage, this);
    }

    public override messageDeleteListener = async (message: Message | PartialMessage): Promise<void> => {
        await detectMessageDelete(message, this);
    }

    public override messageReactionAddListener = async (reaction: MessageReaction | PartialMessageReaction, user: any): Promise<void> => {
        // todo: whether to build reaction handler as other event handlers
        const fetchedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fetchedUser = user.partial ? await user.fetch() : user;

        if (!user.bot) {
            await giveaway.addReactionToGiveaway(fetchedReaction, fetchedUser, this);
            await rollCallReact(fetchedReaction, fetchedUser);
        }
    }

    public override messageReactionRemoveListener = async (reaction: MessageReaction | PartialMessageReaction, user: any): Promise<void> => {
        // todo: whether to build reaction handler as other event handlers
        const fetchedReaction = reaction.partial ? await reaction.fetch() : reaction;
        const fetchedUser = user.partial ? await user.fetch() : user;

        if (!user.bot) {
            await giveaway.removeReactionFromGiveaway(fetchedReaction, fetchedUser, this);
            await rollCallReact(fetchedReaction, fetchedUser);
        }
    }

    public override guildMemberUpdateListener = async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember | PartialGuildMember): Promise<void> => {
        detectGuildMemberUpdate(oldMember, newMember, this);
    }

    public override guildCreateListener = async (guild: any): Promise<void> => {
        detectGuildCreate(guild, this);
    }
}