import type { ChatInputCommandInteraction } from 'discord.js';
import type { BaseBot } from '@bot';
import { Command } from '@cmd';

import { getJson } from '../../../infra/http';
import { replyForError } from '../../../infra/discord/reply-for-error';
import { parseWeatherForecastConfig } from './config';
import { HourlyForecastSchema } from './response';

const ACCUWEATHER_HOURLY_URL = 'https://dataservice.accuweather.com/forecasts/v1/hourly/1hour';

export default class weather_forecast extends Command {
  constructor() {
    super();
    this.setConfig({
      name: 'weather_forecast',
      category: 'utility',
    });
  }

  /**
   * The location key has no safe default — guessing a city would report
   * confidently wrong weather — so an enabled command without the block
   * fails at registration instead.
   */
  public override validateBotConfig(botConfig: unknown): void {
    parseWeatherForecastConfig(botConfig);
  }

  public override async execute(
    interaction: ChatInputCommandInteraction,
    bot: BaseBot,
  ): Promise<void> {
    await interaction.deferReply();
    const t = (key: string, params?: Record<string, string | number>): string =>
      bot.translator?.t(key, params) ?? '';
    try {
      const apiKey = bot.env?.ACCUWEATHER_KEY;
      if (!apiKey) {
        await interaction.editReply({ content: t('replies:weather_forecast.unavailable') });
        return;
      }
      const { locationKey } = parseWeatherForecastConfig(bot.config);
      // The key travels as a query parameter because AccuWeather
      // offers no header form; `scrubForLog` strips it from any URL
      // that reaches the structured log.
      const forecasts = await getJson(
        `${ACCUWEATHER_HOURLY_URL}/${locationKey}`,
        HourlyForecastSchema,
        { params: { apikey: apiKey, language: 'zh-tw', details: true } },
      );
      const weatherForecast = forecasts[0];
      if (weatherForecast === undefined) {
        await interaction.editReply({ content: t('replies:weather_forecast.unavailable') });
        return;
      }
      const temperatureCelsius = ((weatherForecast.Temperature.Value - 32) * 5) / 9; // Convert Fahrenheit to Celsius
      const realFeelCelsius = ((weatherForecast.RealFeelTemperature.Value - 32) * 5) / 9; // Convert Fahrenheit to Celsius
      let formattedContent = t('replies:weather_forecast.header');
      formattedContent += t('replies:weather_forecast.forecast_time', {
        value: weatherForecast.DateTime,
      });
      formattedContent += t('replies:weather_forecast.weather_status', {
        value: weatherForecast.IconPhrase,
      });
      formattedContent += t('replies:weather_forecast.precipitation', {
        value: weatherForecast.PrecipitationProbability,
      });
      formattedContent += t('replies:weather_forecast.thunderstorm', {
        value: weatherForecast.ThunderstormProbability,
      });
      formattedContent += t('replies:weather_forecast.temperature', { value: temperatureCelsius });
      formattedContent += t('replies:weather_forecast.real_feel', { value: realFeelCelsius });
      formattedContent += t('replies:weather_forecast.humidity', {
        value: weatherForecast.RelativeHumidity,
      });

      const formattedContentWithBackticks = formattedContent;
      await interaction.editReply({ content: formattedContentWithBackticks });
    } catch (error) {
      await replyForError(
        interaction,
        bot,
        error,
        'replies:weather_forecast.failed',
        interaction.guild?.id,
      );
    }
  }
}
