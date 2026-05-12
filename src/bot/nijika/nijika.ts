import { Client, Interaction, MessageFlags } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { executeCommand } from '@cmd';
import { executeButton } from '@button';
import { executeModal } from '@modal';
import { executeSSM } from '@ssm';
import { activity, giveaway } from '@features';
import {
    AutoReplyPlugin,
    TtsReplyPlugin,
    createActivityPlugin,
    createGiveawayPlugin,
    createGuildEventsPlugin,
} from '@plugins';

interface NijikaConfig extends Config {
    blocked_channels: string[];
    level_roles: Record<string, string>;
}

export class Nijika extends BaseBot<NijikaConfig> {
    public constructor(client: Client, token: string, mongoURI: string, clientId: string, config: NijikaConfig) {
        super(client, token, mongoURI, clientId, config);
        this.help_msg = '### 目前支援的功能：\n' +
                        '1. tts: 回覆一則訊息並輸入tts，bot會產生該訊息的語音檔\n' +
                        '2. auto reply: bot會根據資料庫的message pair回覆訊息\n' +
                        '3. roll dice: 輸入範例-> `2d5`, 在1~5隨機選擇兩個數字\n';

        // Phase 4b plugin registration. The interactionEventListener
        // override below stays because nijika threads `blocked_channels`
        // into executeCommand — InteractionRouter middleware will
        // absorb that in a later phase.
        this.use(AutoReplyPlugin);
        this.use(TtsReplyPlugin);
        this.use(createGuildEventsPlugin({
            blockedChannels: this.config.blocked_channels,
            clientId: this.clientId,
        }));
        this.use(createGiveawayPlugin({ rebootJobs: () => giveaway.rebootGiveawayJobs(this) }));
        this.use(createActivityPlugin({ rebootJobs: () => activity.rebootActivityJobs(this) }));
    }

    public override interactionEventListener = async (interaction: Interaction): Promise<void> => {
        switch (true) {
            case interaction.isChatInputCommand() || interaction.isContextMenuCommand():
                await executeCommand(interaction, this, this.config.blocked_channels);
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
                    await interaction.reply({ content: '目前尚不支援此類型的指令', flags: MessageFlags.Ephemeral });
                }
                break;
        }
    }
}
