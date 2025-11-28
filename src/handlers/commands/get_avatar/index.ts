import { 
    ChatInputCommandInteraction,
    EmbedBuilder,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class get_avatar extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "get_avatar",
            description: "取得使用者頭像",
            options: {
                user: [
                    {
                        name: "user",
                        description: "選擇對象",
                        required: true
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const user = interaction.options.get("user")?.value as string;
            const member = interaction.guild?.members.cache.get(user);
            if (member) {
                let url = member.displayAvatarURL();
                url = url.replace(".webp", ".png?size=4096");
    
                const embed = new EmbedBuilder()
                    .setTitle("User Avatar")
                    .setAuthor({ name: member.user.tag, iconURL: url })
                    .setImage(url)
                    .setColor(member.displayHexColor);
    
                await interaction.editReply({ embeds: [embed] });
            } else {
                await interaction.editReply({ content: "找不到使用者" });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得頭像" });
        }
    }
}