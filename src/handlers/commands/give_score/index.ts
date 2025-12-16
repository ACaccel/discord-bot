import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

export default class give_score extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "give_score",
            description: "給分"
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        const score = `${Math.floor(Math.random() * 11)}/10`;
        await interaction.reply({ content: score });
    }
}