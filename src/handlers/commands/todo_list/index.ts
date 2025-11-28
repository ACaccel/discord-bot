import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class todo_list extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "todo_list",
            description: "待辦事項",
            options: {
                string: [
                    {
                        name: "action",
                        description: "新增或刪除",
                        required: true,
                        choices: [
                            { name: "新增 (+ content: 內容)", value: "add" },
                            { name: "刪除 (+ content: 編號)", value: "delete" },
                            { name: "查看", value: "list" }
                        ]
                    },{
                        name: "content",
                        description: "內容 (optional)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const action = interaction.options.get("action")?.value as string;
            const content = interaction.options.get("content")?.value as string;
    
            if (!content && action !== "list") {
                await interaction.editReply({ content: "請輸入待辦事項內容" });
                return;
            }
    
            const db = bot.guildInfo[interaction.guild?.id as string].db;
            if (!db) {
                await interaction.editReply({ content: "找不到資料庫" });
                return;
            }
    
            if (action == "add") {
                const existPair = await db.models["Todo"].find({ content });
                if (existPair.length === 0) {
                    const newTodo = new db.models["Todo"]({ content });
                    await newTodo.save();
                    await interaction.editReply({ content: `已新增待辦事項：${content}` });
                } else {
                    await interaction.editReply({ content: `此待辦事項：${content} 已經存在！` });
                }
            } else if (action == "delete") {
                // content is index
                const todoList = await db.models["Todo"].find({});
                if (!parseInt(content)) {
                    await interaction.editReply({ content: "請輸入數字" });
                    return;
                }
                if (parseInt(content) > todoList.length) {
                    await interaction.editReply({ content: `找不到待辦事項：${content}` });
                } else {
                    const deleted_content = todoList[parseInt(content) - 1].content;
                    await db.models["Todo"].deleteOne({ content: deleted_content });
                    await interaction.editReply({ content: `已刪除待辦事項：${deleted_content}` });
                }
            } else if (action == "list") {
                const todoList = await db.models["Todo"].find({});
                let content = "待辦事項：\n";
                todoList.map((e, i) => {
                    content += `> ${i + 1}. ${e.content}\n`;
                });
                await interaction.editReply({ content });
            }
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法變更待辦事項" });
        }
    }
}