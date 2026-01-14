import { REST, Routes, ApplicationCommandDataResolvable } from "discord.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import { createCommand } from "@cmd";
import { bot_cmd } from "@utils";

type DeployArgs = { bot?: string };

type BotConfig = {
    commands?: string[];
};

function parseArgs(argv: string[]): DeployArgs {
    const out: DeployArgs = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if ((a === "-b" || a === "--bot" || a === "-t" || a === "--target") && argv[i + 1]) {
            out.bot = argv[++i];
        }
    }

    return out;
}

function resolveBotPaths(botName: string) {
    const baseDir = path.resolve(__dirname, "bot", botName);
    const configPath = path.join(baseDir, "config.json");
    const envPath = path.join(baseDir, ".env");

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }
    if (!fs.existsSync(envPath)) {
        throw new Error(`Env file not found: ${envPath}`);
    }

    return { baseDir, configPath, envPath };
}

function loadBotConfig(botName: string): { token: string; clientId: string; commands: string[] } {
    const { configPath, envPath } = resolveBotPaths(botName);

    dotenv.config({ path: envPath });
    const token = process.env.TOKEN;
    const clientId = process.env.CLIENT_ID;

    if (!token || !clientId) {
        throw new Error(`Missing TOKEN or CLIENT_ID in ${envPath}`);
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const cfg = JSON.parse(raw) as BotConfig;

    if (!cfg.commands || !Array.isArray(cfg.commands) || cfg.commands.length === 0) {
        throw new Error(`No commands defined in ${configPath}`);
    }

    return { token, clientId, commands: cfg.commands };
}

function buildCommandsFromConfig(commands: string[]): ApplicationCommandDataResolvable[] {
    const out: ApplicationCommandDataResolvable[] = [];

    for (const name of commands) {
        const instance = createCommand(name);
        if (!instance || !instance.config) {
            console.warn(`[WARN] Command "${name}" could not be created or has no config.`);
            continue;
        }

        out.push(bot_cmd.buildCommandJsonBody(instance.config));
    }

    return out;
}

async function deployCommands(botName: string) {
    const { token, clientId, commands } = loadBotConfig(botName);

    const body = buildCommandsFromConfig(commands);
    if (body.length === 0) {
        console.error("No commands to deploy (after filtering).");
        process.exit(1);
    }

    const rest = new REST({ version: "10" }).setToken(token);

    const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];

    console.log(`Deploying ${body.length} commands for bot "${botName}" to ${guilds.length} guild(s).`);

    for (const guild of guilds) {
        try {
            console.log(`- Deploying to guild ${guild.name} (${guild.id})...`);

            const res = (await rest.put(
                Routes.applicationGuildCommands(clientId, guild.id),
                { body }
            )) as unknown as any[];

            console.log(`  Successfully registered ${res.length} command(s).`);
        } catch (err) {
            console.error(`  Failed to register commands for guild ${guild.id}:`, err);
        }
    }

    console.log("Done.");
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const bot = args.bot;

    if (!bot || !args.bot) {
        console.error("Usage: yarn deploy -t <bot_name>");
        process.exit(1);
    }

    try {
        await deployCommands(bot);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();