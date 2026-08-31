/**
 * Operator configuration for `/weather_forecast`.
 *
 * The AccuWeather location key identifies one city. It was a literal in
 * the request URL, so every deployment of this bot reported the weather
 * for that one city regardless of where its guild is. It is deployment
 * data, so it lives in `config.json`.
 *
 * The API key itself stays in the environment (`ACCUWEATHER_KEY`) —
 * secrets never enter `config.json`.
 */
import { z } from 'zod';

const ConfigSchema = z
  .object({
    /**
     * AccuWeather location key, e.g. `315078` for Taipei. Look one up
     * through AccuWeather's Locations API.
     */
    locationKey: z.string().min(1, 'weather_forecast.locationKey must be a non-empty string'),
  })
  .strict();

type WeatherForecastConfig = z.infer<typeof ConfigSchema>;

/**
 * Parse the `weather_forecast` block of a personality's `config.json`.
 *
 * @throws {z.ZodError} when the block is absent or malformed — the
 *   command cannot pick a city without it, so there is no safe default.
 */
export const parseWeatherForecastConfig = (botConfig: unknown): WeatherForecastConfig =>
  ConfigSchema.parse((botConfig as { weather_forecast?: unknown } | undefined)?.weather_forecast);
