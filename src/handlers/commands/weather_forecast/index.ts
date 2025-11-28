import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import axios from 'axios';
import { BaseBot } from '@bot';
import { SlashCommand } from '@cmd';
import { logger } from '@utils';

export default class weather_forecast extends SlashCommand {
    constructor() {
        super();
        this.setConfig({
            name: "weather_forecast",
            description: "天氣預報(台北)"
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            var api_route = "https://dataservice.accuweather.com/forecasts/v1/hourly/1hour/315078?apikey=rVlGI9UbF0ALnbcerU3qKGQeHYjPyTDj&language=zh-tw&details=true";
            const response = await axios.get(api_route);
            const weatherForecast = response.data[0];
            const temperatureCelsius = (weatherForecast.Temperature.Value - 32) * 5 / 9; // Convert Fahrenheit to Celsius
            const realFeelCelsius = (weatherForecast.RealFeelTemperature.Value - 32) * 5 / 9; // Convert Fahrenheit to Celsius
            let formattedContent = "每小時天氣預報：\n";
            formattedContent += `- 預測時間：${weatherForecast.DateTime}\n`;
            formattedContent += `- 天氣狀況：${weatherForecast.IconPhrase}\n`;
            formattedContent += `- 降雨機率：${weatherForecast.PrecipitationProbability}%\n`;
            formattedContent += `- 雷暴機率：${weatherForecast.ThunderstormProbability}%\n`;
            formattedContent += `- 室外氣溫：${temperatureCelsius}°C\n`;
            formattedContent += `- 體感溫度：${realFeelCelsius}°C\n`;
            formattedContent += `- 相對濕度：${weatherForecast.RelativeHumidity}%\n`;
            
            const formattedContentWithBackticks = formattedContent;
            await interaction.editReply({ content: formattedContentWithBackticks });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: "無法取得天氣預報" });
        }
    }
}