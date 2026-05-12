import { 
    ChatInputCommandInteraction,
    Events,
    GuildMember,
    Message,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger, bot_cmd, misc } from '@utils';

export default class ban_user extends Command {
    constructor() {
        super();
        this.setConfig({
            name: "ban_user",
            // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
            description: "暫時禁言使用者(ban_threshold: 5 votes, judge_time: 1 min)",
            options: {
                user: [
                    {
                        name: "user",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "被禁言的使用者",
                        required: true
                    }
                ],
                number: [
                    {
                        name: "duration",
                        // i18n-ignore: command-builder metadata; localised in PR 6-3 via name_localizations.
                        description: "禁言時限 (單位: 分鐘, max: 5)",
                        required: false
                    }
                ]
            }
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        await interaction.deferReply();
        try {
            const BAN_THRESHOLD = 5; // number of votes required to ban
            const JUDGE_TIME = 1; // minutes to judge
            const user = interaction.options.get("user")?.value as string;
            const member = interaction.guild?.members.cache.get(user);
            const ban_user_role = bot.guildInfo[interaction.guild?.id as string]?.roles?.ban_user?.id || "role not set";
            if (!member) {
                await interaction.editReply({ content: bot.translator?.t('errors:command.user_not_found') ?? '' });
                return;
            }
            
            let duration = interaction.options.get("duration")?.value as number;
            if (!duration) duration = 1; // 1 minutes
            if (duration > 5) duration = 5; // max 5 minutes
            if (duration < 1) duration = 1; // min 1 minute
    
            // ban message
            const initiator = interaction.member as GuildMember || interaction.user;
            const ban_msg = `**${initiator.displayName}** 發起了審判！\n` +
                            `是否禁言 **${member.displayName}** ${duration} 分鐘？\n` +
                            `**${JUDGE_TIME}** 分鐘後累積 **${BAN_THRESHOLD}** 票則禁言，<@&${ban_user_role}> 讓他看看豐川家的黑暗！`
            await interaction.deleteReply();
            const ch = interaction.channel;
            if (!ch?.isSendable()) return;
            const judge_msg = await ch.send({ content: ban_msg });
            await bot_cmd.msgReact(judge_msg, ["👍"]);
    
            // judgement time (todo: save to db like giveaway)
            const current_time = Date.now();
            const end_time = current_time + JUDGE_TIME * 60 * 1000;
            const end_time_date = new Date(end_time);
    
            // delete message for unbanable users
            const delete_on_msg_create = async () => {
                const deleteListener = async (msg: Message) => {
                    if (!msg.author.bot && msg.author?.id === member.id && msg.guild?.id === interaction.guild?.id) {
                        try {
                            await msg.delete();
                        } catch (err) {
                            logger.errorLogger(bot.clientId, interaction.guild?.id, err);
                        }
                    }
                };
                bot.client.on(Events.MessageCreate, deleteListener);
    
                setTimeout(() => {
                    bot.client.off("messageCreate", deleteListener);
                }, duration * 60 * 1000);
            }
    
            const ban_judgement = async () => {
                const emoji = judge_msg.reactions.resolve("👍");
                if (!emoji) {
                    await judge_msg.reply("無法取得投票數");
                    return;
                }
                if (member.user.bot) {
                    await judge_msg.reply("還想ban機器人阿");
                    return;
                }
    
                const judge_count = emoji.count - 1;
                if (judge_count >= BAN_THRESHOLD) {
                    try {
                        await member.timeout(duration * 60 * 1000, "初華大人的禁言裁決！");
                        await judge_msg.reply(`${member.user.tag} 已被初華大人禁言 ${duration} 分鐘`);
                    } catch (error) {
                        await judge_msg.reply("雖然初華大人無法禁言他，但將予以無限刪除之審判，即刻裁決！");
                        await delete_on_msg_create();
                    }
                } else {
                    await judge_msg.reply(`投票數 ${judge_count} 票，未達到禁言門檻 ${BAN_THRESHOLD} 票`);
                }
            }
            misc.scheduleJob(end_time_date, () => ban_judgement());
        } catch (error) {
            logger.errorLogger(bot.clientId, interaction.guild?.id, error);
            await interaction.editReply({ content: bot.translator?.t('replies:ban_user.failed') ?? '' });
        }
    }
}