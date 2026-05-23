import type { 
    ChatInputCommandInteraction,
} from 'discord.js';
import axios from 'axios';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import restaurant_types from './restaurant-types.json';

import { logError } from '@core/logger';
export default class random_restaurant extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "random_restaurant",
            options: {
                string: [
                    {
                        name: "type",
                        required: false,
                        // Restaurant-type choices live in the colocated
                        // `restaurant-types.json` data file so the CJK
                        // choice strings stay out of this `.ts` source.
                        // `name` and `value` are kept identical because
                        // the food API matches the request `type`
                        // parameter against these exact strings.
                        choices: restaurant_types.map((type) => ({
                            name: type,
                            value: type,
                        }))
                    },
                    {
                        name: "name_keyword",
                        required: false
                    },
                    {
                        name: "address_keyword",
                        required: false
                    }
                ],
                number: [
                    {
                        name: "budget",
                        required: false
                    },
                    {
                        name: "min_rating",
                        required: false
                    },
                    {
                        name: "max_rating",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const api_route = "https://food-api-kappa-hazel.vercel.app/recommend";
            const type = interaction.options.get("type")?.value as string;
            const name_keyword = interaction.options.get("name_keyword")?.value as string;
            const addr_keyword = interaction.options.get("address_keyword")?.value as string;
            const budget = interaction.options.get("budget")?.value as number;
            const min_rating = interaction.options.get("min_rating")?.value as number;
            const max_rating = interaction.options.get("max_rating")?.value as number;
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
            logError(bot.logger, bot.clientId, interaction.guild?.id, error);

            const now = new Date();
            // 換算成台灣時間 (UTC+8)
            const hourTPE = (now.getUTCHours() + 8) % 24;
            bot.logger?.debug({ hourTPE }, 'random_restaurant: computing Taipei hour for fallback copy.');
            if (hourTPE >= 0 && hourTPE < 6) {
                await interaction.editReply({ content: bot.translator?.t('replies:random_restaurant.midnight') ?? '' });
            } else {
                await interaction.editReply({ content: bot.translator?.t('replies:random_restaurant.no_match') ?? '' });
            }
        }
    }
}