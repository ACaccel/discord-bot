/**
 * Operator configuration for `/random_restaurant`.
 *
 * The recommendation endpoint was a literal in the handler, so moving
 * the service (or pointing a fork at a different dataset) meant editing
 * source. It is deployment data, so it lives in `config.json`.
 */
import { z } from 'zod';

const ConfigSchema = z
  .object({
    /** Base URL of the recommendation endpoint, queried with `GET`. */
    apiUrl: z
      .string()
      .url('random_restaurant.apiUrl must be an absolute http(s) URL')
      .refine(
        (value) => value.startsWith('http://') || value.startsWith('https://'),
        'random_restaurant.apiUrl must use the http:// or https:// scheme',
      ),
  })
  .strict();

type RandomRestaurantConfig = z.infer<typeof ConfigSchema>;

/**
 * Parse the `random_restaurant` block of a personality's `config.json`.
 *
 * @throws {z.ZodError} when the block is absent or malformed — there is
 *   no default endpoint to fall back to.
 */
export const parseRandomRestaurantConfig = (botConfig: unknown): RandomRestaurantConfig =>
  ConfigSchema.parse((botConfig as { random_restaurant?: unknown } | undefined)?.random_restaurant);
