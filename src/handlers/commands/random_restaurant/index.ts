import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import axios from 'axios';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class random_restaurant extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "random_restaurant",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "隨機餐廳抽取器 (台北/部分新北地區)",
            options: {
                string: [
                    {
                        name: "type",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "餐廳種類",
                        required: false,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "壽司", value: "壽司" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "美式", value: "美式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "中式", value: "中式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "日式", value: "日式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "韓式", value: "韓式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "義式", value: "義式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "泰式", value: "泰式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "拉麵", value: "拉麵" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "燒烤", value: "燒烤" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "咖啡", value: "咖啡" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "早餐", value: "早餐" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "早午餐", value: "早午餐" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "自助餐", value: "自助餐" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "吃到飽", value: "吃到飽" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "貓咖", value: "貓咖" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "酒吧", value: "酒吧" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "甜點店", value: "甜點店" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "速食", value: "速食" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "法式", value: "法式" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "印度", value: "印度" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "印尼", value: "印尼" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "地中海", value: "地中海" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "披薩", value: "披薩" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "海鮮", value: "海鮮" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "牛排", value: "牛排" }
                        ]
                    },
                    {
                        name: "name_keyword",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "餐廳名稱關鍵字",
                        required: false
                    },
                    {
                        name: "address_keyword",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "餐廳地址關鍵字",
                        required: false
                    }
                ],
                number: [
                    {
                        name: "budget",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "預算（整數）",
                        required: false
                    },
                    {
                        name: "min_rating",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "最低評分",
                        required: false
                    },
                    {
                        name: "max_rating",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
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
            const t = (key: string, params?: Record<string, string | number>): string =>
                bot.translator?.t(key, params) ?? '';
            await interaction.editReply({
                content: t('replies:random_restaurant.description', {
                    message: message ?? t('replies:random_restaurant.no_description'),
                    priceLine: price ? t('replies:random_restaurant.price_line', { price }) : '',
                    addressLine: address ? t('replies:random_restaurant.address_line', { address }) : '',
                    phoneLine: phone ? t('replies:random_restaurant.phone_line', { phone }) : '',
                    mapLine: google_map ? t('replies:random_restaurant.map_line', { map: google_map }) : '',
                }),
            });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);

            const now = new Date();
            // 換算成台灣時間 (UTC+8)
            const hourTPE = (now.getUTCHours() + 8) % 24;
            console.log(hourTPE)
            if (hourTPE >= 0 && hourTPE < 6) {
                await interaction.editReply({ content: bot.translator?.t('replies:random_restaurant.midnight') ?? '' });
            } else {
                await interaction.editReply({ content: bot.translator?.t('replies:random_restaurant.no_match') ?? '' });
            }
        }
    }
}