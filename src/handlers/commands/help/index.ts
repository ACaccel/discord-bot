import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class help extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'help',
            description: '顯示指令清單與說明',
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            if (!bot.config.commands) {
                await interaction.editReply({ content: "沒有指令清單"});
                return;
            }

            let  helpContent = '## Help Message\n';
            helpContent += bot.help_msg;
            helpContent += '### 目前支援的slash command：\n';
            bot.commandHandlers.forEach((cmd) => {
                if (cmd.config) {
                    helpContent += `* \`/${cmd.config.name}\` : ${cmd.config.description}\n`;
                }
            });

            await interaction.editReply({ content: helpContent });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得指令清單"});
        }
    }
}