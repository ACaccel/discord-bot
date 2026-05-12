import { Client, Interaction, MessageFlags } from 'discord.js';
import { BaseBot, Config } from '@bot';
import { executeCommand } from '@cmd';
import { executeButton } from '@button';
import { executeModal } from '@modal';
import { executeSSM } from '@ssm';
import { AutoReplyPlugin, TtsReplyPlugin, createGuildEventsPlugin } from '@plugins';

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

        // Phase 4b-2: legacy message listeners migrated to plugins.
        // `blocked_channels` continues to suppress event-channel
        // mirroring for the configured forum/thread parents; the
        // command path still consults the same list through
        // `executeCommand` below.
        this.use(AutoReplyPlugin);
        this.use(TtsReplyPlugin);
        this.use(createGuildEventsPlugin({ blockedChannels: this.config.blocked_channels }));
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
