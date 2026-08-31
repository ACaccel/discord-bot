/**
 * `/weather_forecast` operator configuration.
 *
 * The AccuWeather location key was a literal in the request URL, so
 * every deployment reported the same city's weather.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';

import WeatherForecast from '../../../../src/handlers/commands/weather_forecast';
import { boundedHttp } from '../../../../src/infra/http';
import { buildFakeBot } from '../../../fixtures/discord/bot-fake';

const buildBot = (overrides: { locationKey?: string; apiKey?: string } = {}) => {
  const { locationKey = '999999', apiKey = 'accu-key' } = overrides;
  const { bot, logger } = buildFakeBot({
    config: { weather_forecast: { locationKey } },
    env: { ACCUWEATHER_KEY: apiKey },
  });
  return { bot, error: logger.error };
};

const buildInteraction = () =>
  ({
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferred: true,
    replied: false,
    guild: { id: 'g1' },
    options: { get: () => null },
  }) as unknown as ChatInputCommandInteraction;

const forecastPayload = {
  data: [
    {
      DateTime: '2026-06-01T14:00:00+08:00',
      IconPhrase: 'Cloudy',
      PrecipitationProbability: 10,
      ThunderstormProbability: 0,
      Temperature: { Value: 86 },
      RealFeelTemperature: { Value: 90 },
      RelativeHumidity: 70,
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('weather_forecast', () => {
  it('requests the configured location key', async () => {
    const get = vi.spyOn(boundedHttp, 'get').mockResolvedValue(forecastPayload as never);
    const { bot } = buildBot({ locationKey: '123456' });

    await new WeatherForecast().execute(buildInteraction(), bot);

    const [url, options] = get.mock.calls[0] as [string, { params: Record<string, unknown> }];
    expect(url).toContain('/123456');
    // The key rides in `params`, never spliced into the URL string, so
    // the log scrubber sees a structured field.
    expect(options.params.apikey).toBe('accu-key');
    expect(url).not.toContain('accu-key');
  });

  it('answers with the unavailable copy when the API key is missing', async () => {
    const get = vi.spyOn(boundedHttp, 'get');
    const { bot } = buildBot({ apiKey: '' });
    const interaction = buildInteraction();

    await new WeatherForecast().execute(interaction, bot);

    expect(get).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'replies:weather_forecast.unavailable',
    });
  });

  it('refuses to register without the location key', () => {
    expect(() => new WeatherForecast().validateBotConfig({})).toThrow();
    expect(() =>
      new WeatherForecast().validateBotConfig({ weather_forecast: { locationKey: '315078' } }),
    ).not.toThrow();
  });
});
