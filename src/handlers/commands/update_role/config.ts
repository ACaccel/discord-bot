/**
 * Operator configuration for `/update_role`.
 *
 * `level_roles` maps a `level_<n>` threshold key to the role *name*
 * granted at that level. The handler previously narrowed it with
 * `'level_roles' in bot.config`, which proves only that a property
 * exists — a `level_roles: 42` typo passed the check and then failed
 * deep inside the role loop with an unrelated error.
 */
import { z } from 'zod';

const ConfigSchema = z
  .object({
    /**
     * `level_<n>` -> role name. Keys are iterated in declaration order
     * and the numeric suffix is compared against the member's level, so
     * a caller must list them ascending.
     */
    level_roles: z.record(
      z.string().regex(/^level_\d+$/, 'level_roles keys must look like "level_<n>"'),
      z.string().min(1, 'level_roles values must be a non-empty role name'),
    ),
  })
  .passthrough();

type UpdateRoleConfig = z.infer<typeof ConfigSchema>;

/**
 * Parse the `level_roles` block of a personality's `config.json`.
 *
 * Returns `undefined` for both an absent and a malformed block — a
 * personality without level roles simply does not use the feature, so
 * neither case is fatal. They are not the same event, though: a block
 * that is present but invalid is an operator mistake, and `onInvalid`
 * fires so the caller can record it. Without that, a `level_roles: 42`
 * typo is indistinguishable from not configuring the feature at all.
 */
export const parseUpdateRoleConfig = (
  botConfig: unknown,
  onInvalid?: (issue: z.ZodError) => void,
): UpdateRoleConfig | undefined => {
  const result = ConfigSchema.safeParse(botConfig);
  if (result.success) return result.data;
  const present = typeof botConfig === 'object' && botConfig !== null && 'level_roles' in botConfig;
  if (present) onInvalid?.(result.error);
  return undefined;
};
