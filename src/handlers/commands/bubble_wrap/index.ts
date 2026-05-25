import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

export default class bubble_wrap extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "bubble_wrap",
            options: {
                string: [
                    {
                        name: "str",
                        required: true
                    }
                ]
            }
        });
    }
    private getVisualWidth(char: string): number {
    
        // eslint-disable-next-line no-control-regex
        return /[^\x00-\xff]/.test(char) ? 2 : 1;
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        const inner_str = (interaction.options.get("str")?.value as string | undefined) ?? '';
        const side_len = 7;
        if (inner_str.length > side_len * side_len) {
            await interaction.reply({ content: bot.translator?.t('replies:bubble_wrap.too_long') ?? '' });
            return;
        }

        // random permutation of places
        const places: number[] = Array.from({ length: side_len * side_len }, (_, i) => i);
        for (let i = places.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            // Indices i and j are within bounds by loop construction.
            const tmp = places[i] as number;
            places[i] = places[j] as number;
            places[j] = tmp;
        }

        // fill the board with the inner_str
        const board: string[] = Array(side_len * side_len).fill("||<:blank:1082500408838205540>||");

        for (let i = 0; i < inner_str.length; i++) {
            const char = inner_str[i] as string;

            //modify width

            let displayChar = char;
            if (this.getVisualWidth(char) === 1) {
                displayChar = `  ${char}  `;
            }else{
                displayChar = ` ${char} `;
            }

            board[places[i] as number] = "||" + displayChar + "||";
        }

        // create the string representation of the board
        let inf = "";
        for (let i = 0; i < side_len; i++) {
            inf += board.slice(i * side_len, (i + 1) * side_len).join("") + "\n";
        }

        await interaction.reply({ content: inf });
    }
}
