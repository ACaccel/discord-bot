import type { MessageReaction, User } from "discord.js";
import { ReactionHandler } from "..";
import type { BaseBot } from "@bot";

export default class roll_call extends ReactionHandler {
    public override async executeAdded(reaction: MessageReaction, user: User, _bot: BaseBot): Promise<void> {
        await rollCallReact(reaction, user);
    }

    public override async executeRemoved(reaction: MessageReaction, user: User, _bot: BaseBot): Promise<void> {
        await rollCallReact(reaction, user);
    }
}

const rollCallReact = async (reaction: MessageReaction, _user: User) => {
    // i18n-ignore: trigger prefix matched against the announcement broadcast by /roll_call.
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