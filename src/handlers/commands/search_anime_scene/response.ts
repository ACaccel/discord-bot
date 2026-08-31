/**
 * Response shape of the trace.moe search endpoint.
 *
 * `error` is an empty string on success and carries a message
 * otherwise, so both are a valid parse — a non-empty `error` is the
 * upstream reporting a domain failure, not a broken contract.
 */
import { z } from 'zod';

export const TraceMoeResponseSchema = z.object({
  error: z.string(),
  result: z
    .array(
      z.object({
        filename: z.string(),
        episode: z.union([z.number(), z.string()]).nullish(),
        similarity: z.number(),
        from: z.number(),
        to: z.number(),
        video: z.string(),
        image: z.string(),
      }),
    )
    .default([]),
});

export type TraceMoeMatch = z.infer<typeof TraceMoeResponseSchema>['result'][number];
