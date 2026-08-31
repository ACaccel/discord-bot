/**
 * Response shape of AccuWeather's 1-hour hourly-forecast endpoint.
 *
 * Only the fields the reply renders are declared; zod strips the rest,
 * so an upstream addition is not a breaking change.
 * Temperatures arrive in Fahrenheit — the conversion lives in the
 * handler.
 */
import { z } from 'zod';

const temperature = z.object({ Value: z.number() });

export const HourlyForecastSchema = z.array(
  z.object({
    DateTime: z.string(),
    IconPhrase: z.string(),
    PrecipitationProbability: z.number(),
    ThunderstormProbability: z.number(),
    RelativeHumidity: z.number(),
    Temperature: temperature,
    RealFeelTemperature: temperature,
  }),
);
