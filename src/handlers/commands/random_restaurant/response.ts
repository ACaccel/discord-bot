/**
 * Response shape of the restaurant-recommendation endpoint.
 *
 * `restaurant` is nullable on purpose: the API answers `200` with no
 * restaurant object when nothing matched the filters, so an empty
 * result is a *valid* parse. That is what keeps "nothing found" — a
 * domain outcome — distinguishable from a changed or broken upstream,
 * which fails the parse and reaches the error boundary instead.
 */
import { z } from 'zod';

/** A scalar the handler interpolates into a reply line. */
const displayValue = z.union([z.string(), z.number()]).nullish();

export const RecommendResponseSchema = z.object({
  message: z.string().nullish(),
  restaurant: z
    .object({
      address: displayValue,
      phone: displayValue,
      price: displayValue,
      google_maps_link: z.string().nullish(),
    })
    .nullish(),
});
