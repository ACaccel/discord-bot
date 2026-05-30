/**
 * Force-trigger keyword handling for the LLM auto-reply plugin.
 *
 * A message whose content begins with {@link FORCE_TRIGGER_PREFIX}
 * bypasses the random probability gate so the reply fires deterministically.
 * The downstream `messageCount` / `windowSeconds` requirements still apply
 * — a forced trigger only skips the dice roll, not the context checks.
 *
 * The keyword is a control token, not conversation, so it is stripped from
 * a message's transcript content before the prompt is built.
 *
 * ASCII keyword (no CJK), so the i18n scanner does not apply; it is kept as
 * a named constant rather than a magic string per the coding standards.
 */
export const FORCE_TRIGGER_PREFIX = 'fatcat_reply';

/**
 * Whether `content` begins with the force-trigger keyword as a standalone
 * leading token: the keyword must be followed by whitespace or be the entire
 * message. A glued token such as `fatcat_replyfoo` is NOT a trigger, so an
 * unrelated word that merely starts with the keyword cannot force a reply.
 */
export const startsWithForceTrigger = (content: string): boolean => {
  if (!content.startsWith(FORCE_TRIGGER_PREFIX)) return false;
  const next = content.charAt(FORCE_TRIGGER_PREFIX.length);
  return next === '' || /\s/.test(next);
};

/**
 * Remove a leading force-trigger keyword (and the whitespace after it) so the
 * control token never reaches the LLM. Content that does not start with the
 * keyword as a standalone token is returned unchanged.
 */
export const stripForceTrigger = (content: string): string =>
  startsWithForceTrigger(content)
    ? content.slice(FORCE_TRIGGER_PREFIX.length).trimStart()
    : content;
