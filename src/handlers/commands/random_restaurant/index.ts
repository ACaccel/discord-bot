import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import axios from 'axios';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class random_restaurant extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "random_restaurant",
            description: "隨機餐廳抽取器 (台北/部分新北地區)",
            options: {
                string: [
                    {
                        name: "type",
                        description: "餐廳種類",
                        required: false,
                        choices: [
                            { name: "壽司", value: "壽司" },
                            { name: "美式", value: "美式" },
                            { name: "中式", value: "中式" },
                            { name: "日式", value: "日式" },
                            { name: "韓式", value: "韓式" },
                            { name: "義式", value: "義式" },
                            { name: "泰式", value: "泰式" },
                            { name: "拉麵", value: "拉麵" },
                            { name: "燒烤", value: "燒烤" },
                            { name: "咖啡", value: "咖啡" },
                            { name: "早餐", value: "早餐" },
                            { name: "早午餐", value: "早午餐" },
                            { name: "自助餐", value: "自助餐" },
                            { name: "吃到飽", value: "吃到飽" },
                            { name: "貓咖", value: "貓咖" },
                            { name: "酒吧", value: "酒吧" },
                            { name: "甜點店", value: "甜點店" },
                            { name: "速食", value: "速食" },
                            { name: "法式", value: "法式" },
                            { name: "印度", value: "印度" },
                            { name: "印尼", value: "印尼" },
                            { name: "地中海", value: "地中海" },
                            { name: "披薩", value: "披薩" },
                            { name: "海鮮", value: "海鮮" },
                            { name: "牛排", value: "牛排" }
                        ]
                    },
                    {
                        name: "name_keyword",
                        description: "餐廳名稱關鍵字",
                        required: false
                    },
                    {
                        name: "address_keyword",
                        description: "餐廳地址關鍵字",
                        required: false
                    }
                ],
                number: [
                    {
                        name: "budget",
                        description: "預算（整數）",
                        required: false
                    },
                    {
                        name: "min_rating",
                        description: "最低評分",
                        required: false
                    },
                    {
                        name: "max_rating",
                        description: "最高評分",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            var api_route = "https://food-api-kappa-hazel.vercel.app/recommend";
            const type = interaction.options.get("type")?.value as string;
            const name_keyword = interaction.options.get("name_keyword")?.value as string;
            const addr_keyword = interaction.options.get("address_keyword")?.value as string;
            const budget = interaction.options.get("budget")?.value as Number;
            const min_rating = interaction.options.get("min_rating")?.value as Number;
            const max_rating = interaction.options.get("max_rating")?.value as Number;
            const response = await axios.get(api_route, {
                params: {
                    type,
                    name_keyword,
                    addr_keyword,
                    budget,
                    min_rating,
                    max_rating
                }
            });
            //console.log(response.data);
            const message = response.data.message;
            const address = response.data.restaurant.address;
            const phone = response.data.restaurant.phone;
            const price = response.data.restaurant.price;
            const google_map = response.data.restaurant.google_maps_link;
            await interaction.editReply({
                content: `「${message ?? "沒有描述"}」\n\n` +
                        `${price ? `價位：${price}\n` : ""}` +
                        `${address ? `地址：${address}\n` : ""}` +
                        `${phone ? `電話：${phone}\n` : ""}` +
                        `${google_map ? `地圖：${google_map}` : ""}`
            });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);

            const now = new Date();
            // 換算成台灣時間 (UTC+8)
            const hourTPE = (now.getUTCHours() + 8) % 24;
            console.log(hourTPE)
            if (hourTPE >= 0 && hourTPE < 6) {
                await interaction.editReply({ content: "現在半夜 餐廳都關門了啦🈹" });
            } else {
                await interaction.editReply({ content: "找不到符合您條件的餐廳呢" });
            }
        }
    }
}