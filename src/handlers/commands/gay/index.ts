import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';

export default class gay extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "gay",
            description: "是不是給",
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
        const user = interaction.options.get("user")?.value;
        if (interaction.guild?.members.cache.has(user as string)) {
            const target = interaction.guild?.members.cache.get(user as string);
            const res = `${target?.displayName} ${(Math.random() > 0.05 ? "是" : "不是")} gay`;
            await interaction.reply({ content: res });
        }
    }
}