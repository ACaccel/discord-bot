import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

export default class give_score extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "give_score",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "給分"
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, _bot: BaseBot): Promise<void> {
        const score = `${Math.floor(Math.random() * 11)}/10`;
        await interaction.reply({ content: score });
    }
}