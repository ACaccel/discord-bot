import { Channel } from "discord.js";
import type { Translator } from "../core/i18n";

export const earthquake_warning = async (
    channel: Channel,
    eq_role: string,
    translator: Translator | undefined,
): Promise<void> => {
    if (!channel.isSendable()) return;
    const message = translator?.t('replies:earthquake.alert', { role: eq_role }) ?? '';
    await channel.send(message);
};
