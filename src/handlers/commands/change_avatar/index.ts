import { 
    ChatInputCommandInteraction,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';
import identity_config from './identity.json';

export default class change_avatar extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "change_avatar",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "人格變換",
            options: {
                string: [
                    {
                        name: "identity",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "就是身分",
                        required: true,
                        choices: [
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "高松燈", value: "高松燈" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "千早愛音", value: "千早愛音" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "長崎爽世", value: "長崎爽世" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "要樂奈", value: "要樂奈" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "椎名立希", value: "椎名立希" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "若葉睦", value: "若葉睦" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "豐川祥子", value: "豐川祥子" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "祐天寺にゃむ", value: "祐天寺にゃむ" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "三角初音", value: "三角初音" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "八幡海鈴", value: "八幡海鈴" },
                            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                            { name: "純田真奈", value: "純田真奈" }
                        ]
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const guild = interaction.guild;

            if (!guild) {
                await interaction.editReply({ content: bot.translator?.t('errors:command.guild_not_found') ?? ''});
                return;
            }
            if (!identity_config) {
                await interaction.editReply({ content: bot.translator?.t('replies:change_avatar.no_role_config') ?? ''});
                return;
            }

            // change nickname and avatar
            const newName = interaction.options.get("identity")?.value as string;
            const oldName = bot.guildInfo[guild?.id].bot_name;
            const userBot = guild.members.cache.get(bot.client.user?.id as string);
            if (!userBot) {
                await interaction.editReply({ content: bot.translator?.t('errors:command.bot_not_found') ?? ''});
                return;
            }
            const new_identity = identity_config.find((e) => e.name === newName)
            if (!new_identity) {
                await interaction.editReply({ content: bot.translator?.t('replies:change_avatar.new_role_not_found') ?? ''});
                return;
            }

            // change nickname and avatar (need to re-login the client)
            await userBot.setNickname(newName);
            await userBot.client.user.setAvatar(new_identity.avatar_url);
            await bot.reLogin();
            bot.guildInfo[guild.id].bot_name = newName;

            // change color role
            const colorRole = userBot.roles.color;
            if (colorRole) {
                await userBot.roles.remove(colorRole);
            }
            
            const newColorRole = guild?.roles.cache.find(role => role.name === new_identity.color_role);
            if (newColorRole)
                await userBot.roles.add(newColorRole);

            await interaction.editReply({ content: `${oldName}已死，現在正是${newName}復權的時刻` });
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:change_avatar.failed') ?? ''});
        }
    }
}