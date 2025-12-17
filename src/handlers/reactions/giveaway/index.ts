import { MessageReaction, User } from "discord.js";
import { ReactionHandler } from "@reaction";
import { BaseBot } from "@bot";
import { isGiveawayBot } from "utils/giveaway";

export default class roll_call extends ReactionHandler {
    public override async executeAdded(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void> {
        if (!isGiveawayBot(bot)) return;

        bot.giveaway_jobs.forEach(async (job, message_id) => {
            if (reaction.message.id === message_id) {
                const db = bot.guildInfo[reaction.message.guild?.id as string].db
                if (!db) return "Database not found";
                db.models["Giveaway"].findOne({ message_id }).then(async (giveaway: any) => {
                    if (!giveaway) return "Giveaway not found";
                    if (giveaway.participants.includes(user.id)) return "User already participated";
                    giveaway.participants.push(user.id);
                    await giveaway.save();
                });
            }
        });
    }

    public override async executeRemoved(reaction: MessageReaction, user: User, bot: BaseBot): Promise<void> {
        if (!isGiveawayBot(bot)) return;

        bot.giveaway_jobs.forEach(async (job, message_id) => {
            if (reaction.message.id === message_id) {
                const db = bot.guildInfo[reaction.message.guild?.id as string].db
                if (!db) return "Database not found";
                db.models["Giveaway"].findOne({ message_id }).then(async (giveaway: any) => {
                    if (!giveaway) return "Giveaway not found";
                    if (!giveaway.participants.includes(user.id)) return "User did not participate";
                    giveaway.participants = giveaway.participants.filter((id: string) => id !== user.id);
                    await giveaway.save();
                });
            }
        });
    }
}