import { Message } from "discord.js";
import db from "@db";
import { Nijika } from "./types";

export const anti_dizzy_react = (msg: Message) => {
    const content = msg.content;
    const andyDictionary = [
        /暈/, /她{1}不{0,1}在{1}/, /他{1}不{0,1}在{1}/, /女{1}朋{0,1}友{1}/, /男{1}朋{0,1}友{1}/
    ]
    if(andyDictionary.some((e) => content.match(e))) {
        msg.react('1067851490271711312');
    }
}

const search_reply = async (msg: string) => {
    try {
        let res = await db.Reply.find({input: msg});
        let success = (res.length !== 0);
        let reply = "";
        if(res.length !== 0) {
            reply = res[Math.floor(Math.random() * res.length)].reply;
        }
        return { reply, success };
    } catch (e) {
        let success = false;
        return { e, success };
    };
}

const roll_dice = (expression: string) => {
    // Regular expression to match the pattern: (XdY), where X and Y are integers
    const diceRegex = /(\d+)d(\d+)/g;
    
    // Replace each dice roll expression with its evaluated value
    try {
        expression = expression.replace(diceRegex, function(match, numDice, numSides) {
            // Roll the dice
            let result = 0;
            let numDiceInt = parseInt(numDice);
            let numSidesInt = parseInt(numSides);
            if (numDiceInt <= 0 || numSidesInt <= 0) {
                result = 0;
            } else if (numDiceInt > 10000) {
                result = NaN;
            } else {
                for (let i = 0; i < numDiceInt; i++) {
                    result += Math.floor(Math.random() * numSidesInt) + 1;
                }
            }

            return `${result}`;
        });
        
        // Evaluate the expression using JavaScript's eval function
        return eval(expression).toString();
    } catch (e) {
        console.error(e);
        return "NaN";
    }
}

export const auto_reply = async (msg: Message, bot: Nijika) => {
    if (!msg.channel.isSendable()) return;
    
    // normal reply
    const { reply, success } = await search_reply(msg.content);
    if (success) { 
        await msg.channel.send(`${reply as string}`);
    }

    // special reply
    if (bot.nijikaConfig.bad_words.some((e) => { msg.content.includes(e) })) {
        // reply to bad words
        const { reply, success } = await search_reply("[$]");
        if (success) { 
            await msg.channel.send(`${reply as string}`);
        }
    }
    if (msg.author.id === "516912789369913371" && Math.random() > (1-0.005)) {
        // reply to fatcat
        await msg.channel.send("肥貓好gay");
    }
    if (msg.author.id === "705605105352966144" && Math.random() > (1-0.005)) {
        // reply to nijika
        await msg.channel.send("晴人杰");
    }
    if (msg.content.match(/(\d+)d(\d+)/g)) {
        // roll dice
        let res = roll_dice(msg.content);
        await msg.channel.send(`${res}`);
    }
    if (Math.random() > 0.999) {
        // reply to lucky
        const { reply, success } = await search_reply("[*]");
        if (success) { 
            await msg.channel.send(`${reply as string}`);
        }
    }
}