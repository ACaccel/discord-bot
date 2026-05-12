import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import axios from 'axios';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';

export default class weather_forecast extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "weather_forecast",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "天氣預報(台北)"
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            var api_route = `https://dataservice.accuweather.com/forecasts/v1/hourly/1hour/315078?apikey=${process.env.ACCUWEATHER_KEY}&language=zh-tw&details=true`;
            const response = await axios.get(api_route);
            const weatherForecast = response.data[0];
            const temperatureCelsius = (weatherForecast.Temperature.Value - 32) * 5 / 9; // Convert Fahrenheit to Celsius
            const realFeelCelsius = (weatherForecast.RealFeelTemperature.Value - 32) * 5 / 9; // Convert Fahrenheit to Celsius
            const t = (key: string, params?: Record<string, string | number>): string =>
                bot.translator?.t(key, params) ?? '';
            let formattedContent = t('replies:weather_forecast.header');
            formattedContent += t('replies:weather_forecast.forecast_time', { value: weatherForecast.DateTime });
            formattedContent += t('replies:weather_forecast.weather_status', { value: weatherForecast.IconPhrase });
            formattedContent += t('replies:weather_forecast.precipitation', { value: weatherForecast.PrecipitationProbability });
            formattedContent += t('replies:weather_forecast.thunderstorm', { value: weatherForecast.ThunderstormProbability });
            formattedContent += t('replies:weather_forecast.temperature', { value: temperatureCelsius });
            formattedContent += t('replies:weather_forecast.real_feel', { value: realFeelCelsius });
            formattedContent += t('replies:weather_forecast.humidity', { value: weatherForecast.RelativeHumidity });
            
            const formattedContentWithBackticks = formattedContent;
            await interaction.editReply({ content: formattedContentWithBackticks });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:weather_forecast.failed') ?? '' });
        }
    }
}