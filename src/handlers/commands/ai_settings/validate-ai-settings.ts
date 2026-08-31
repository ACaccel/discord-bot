import type { UserApiDoc } from './provider-choices';

/**
 * Result of the pre-modal readiness check. Modelled as a tagged
 * union so the handler can switch on `ok` and reach the
 * corresponding i18n reply key without further branching.
 */
type AiSettingsCheck =
  | { ok: true; doc: UserApiDoc }
  | { ok: false; reason: 'no_doc' | 'no_models' };

export const checkAiSettingsReady = (
  doc: UserApiDoc | undefined,
  modelOptions: ReadonlyArray<string>,
): AiSettingsCheck => {
  if (!doc) return { ok: false, reason: 'no_doc' };
  if (modelOptions.length === 0) return { ok: false, reason: 'no_models' };
  return { ok: true, doc };
};
