import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';

export default class bubble_wrap extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "bubble_wrap",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "產生泡泡紙",
            options: {
                string: [
                    {
                        name: "str",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "隱藏字",
                        required: true
                    }
                ]
            }
        });
    }
    private getVisualWidth(char: string): number {
    
        return /[^\x00-\xff]/.test(char) ? 2 : 1;
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        const inner_str = interaction.options.get("str")?.value as string;
        const side_len = 7;
        const total_cells = side_len * side_len;
        if (inner_str.length > side_len * side_len) {
            await interaction.reply({ content: bot.translator?.t('replies:bubble_wrap.too_long') ?? '' });
            return;
        }

        // random permutation of places
        let places = Array.from({ length: side_len * side_len }, (_, i) => i);
        for (let i = places.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [places[i], places[j]] = [places[j], places[i]];
        }

        // fill the board with the inner_str
        const board = Array(side_len * side_len).fill("||<:blank:1082500408838205540>||");
        
        for (let i = 0; i < inner_str.length; i++) {
            const char = inner_str[i];
            
            //modify width 
        
            let displayChar = char;
            if (this.getVisualWidth(char) === 1) {
                displayChar = `  ${char}  `; 
            }else{
                displayChar = ` ${char} `;
            }
            
            board[places[i]] = "||" + displayChar + "||";
        }

        // create the string representation of the board
        let inf = "";
        for (let i = 0; i < side_len; i++) {
            inf += board.slice(i * side_len, (i + 1) * side_len).join("") + "\n";
        }

        await interaction.reply({ content: inf });
    }
}
