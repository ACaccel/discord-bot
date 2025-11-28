import { MessageReaction, User } from "discord.js";

export const rollCallReact = async (reaction: MessageReaction, user: User) => {
    if (reaction.message.content?.startsWith("初華大人的點名簿")) {
        // parse all users
        const userIds = reaction.message.content.match(/<@!?(\d+)>/g);
        let parsedUserIds = userIds
            ? userIds.map(id => id.replace(/[<@!>]/g, ""))
            : [];
        parsedUserIds = parsedUserIds.slice(1);
        // console.log(parsedUserIds);

        let msg = `${reaction.message.content.split("\n")[0]}\n`;
        let count = 1;
        parsedUserIds.forEach(id => {
            if (reaction.users.cache.has(id)) {
                msg += `${count}. ✅ <@${id}> \n`;
            } else {
                msg += `${count}. <@${id}> \n`;
            }
            count += 1;
        });

        reaction.message.edit(msg);
    }
}