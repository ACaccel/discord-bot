/**
 * Defuse mentions before echoing archived content into a live channel.
 * `@everyone` / `@here` receive a zero-width-space; user / role mentions
 * are demoted to readable `@user(id)` / `@role(id)` text so the audit
 * print never produces accidental pings.
 */
export const sanitizeMentions = (text: string): string =>
  text
    .replace(/@everyone/g, '@​everyone')
    .replace(/@here/g, '@​here')
    .replace(/<@!?(\d+)>/g, '@user($1)')
    .replace(/<@&(\d+)>/g, '@role($1)');
