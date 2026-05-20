/**
 * Slash-command deploy CLI.
 *
 * Audit B-5 (3.11) flipped the default registration scope from
 * guild-side to **global**: a single `rest.put(Routes.applicationCommands)`
 * call now publishes the bot's command set to every guild it is in
 * (and every guild it joins later). The guild-side path is preserved
 * as an opt-in dev path via `--dev-guild <id>` so iteration on a
 * single test guild stays instant (Discord propagation for global
 * commands can take up to an hour).
 *
 * The `--cleanup-guild-commands` flag wipes the legacy guild-scoped
 * registrations: it iterates `userGuilds()` and PUTs an empty array
 * to each guild's command bucket. Operators run this once during the
 * guild → global migration window so users do not see duplicate
 * entries (global + legacy guild-scoped at once).
 *
 * Usage:
 *   yarn deploy -t nijika                 # global (default)
 *   yarn deploy -t nijika --dev-guild ID  # guild-side fast iteration
 *   yarn deploy -t nijika --cleanup-guild-commands
 */
import type { ApplicationCommandDataResolvable } from "discord.js";
import { REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import { createCommand, localizeCommandConfig } from "@cmd";
import { bot_cmd } from "@utils";
import { loadEnv } from '@core/config';
import { createDefaultTranslator, type Translator } from '@core/i18n';

type DeployArgs = {
    bot?: string;
    devGuild?: string;
    cleanupGuildCommands?: boolean;
};

type BotConfig = {
    commands?: string[];
};

function parseArgs(argv: string[]): DeployArgs {
    const out: DeployArgs = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if ((a === "-b" || a === "--bot" || a === "-t" || a === "--target") && argv[i + 1]) {
            out.bot = argv[++i];
        } else if (a === "--dev-guild" && argv[i + 1]) {
            out.devGuild = argv[++i];
        } else if (a === "--cleanup-guild-commands") {
            out.cleanupGuildCommands = true;
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
    const env = loadEnv({ exitOnFailure: false, requireDb: false });
    const token = env.TOKEN;
    const clientId = env.CLIENT_ID;

    const raw = fs.readFileSync(configPath, "utf8");
    const cfg = JSON.parse(raw) as BotConfig;

    if (!cfg.commands || !Array.isArray(cfg.commands) || cfg.commands.length === 0) {
        throw new Error(`No commands defined in ${configPath}`);
    }

    return { token, clientId, commands: cfg.commands };
}

function buildCommandsFromConfig(
    commands: string[],
    translator: Translator,
): ApplicationCommandDataResolvable[] {
    const out: ApplicationCommandDataResolvable[] = [];

    for (const name of commands) {
        const instance = createCommand(name);
        if (!instance || !instance.config) {
            console.warn(`[WARN] Command "${name}" could not be created or has no config.`);
            continue;
        }

        // Gap D7: command / option descriptions are i18n keys resolved
        // here against the `commands` catalog so the deployed JSON keeps
        // its localised text.
        out.push(bot_cmd.buildCommandJsonBody(localizeCommandConfig(instance.config, translator)));
    }

    return out;
}

async function deployGlobal(botName: string): Promise<void> {
    const { token, clientId, commands } = loadBotConfig(botName);

    const translator = await createDefaultTranslator();
    const body = buildCommandsFromConfig(commands, translator);
    if (body.length === 0) {
        console.error("No commands to deploy (after filtering).");
        process.exit(1);
    }

    const rest = new REST({ version: "10" }).setToken(token);

    console.log(
        `Deploying ${body.length} commands for bot "${botName}" GLOBALLY (visible in every guild after Discord propagation, typically minutes).`,
    );

    const res = (await rest.put(Routes.applicationCommands(clientId), {
        body,
    })) as unknown as { id: string }[];

    console.log(`Successfully registered ${res.length} global command(s).`);
}

async function deployDevGuild(botName: string, guildId: string): Promise<void> {
    const { token, clientId, commands } = loadBotConfig(botName);

    const translator = await createDefaultTranslator();
    const body = buildCommandsFromConfig(commands, translator);
    if (body.length === 0) {
        console.error("No commands to deploy (after filtering).");
        process.exit(1);
    }

    const rest = new REST({ version: "10" }).setToken(token);

    console.log(
        `Deploying ${body.length} commands for bot "${botName}" to dev guild ${guildId} (guild-scoped — instant propagation).`,
    );

    const res = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body,
    })) as unknown as { id: string }[];

    console.log(`Successfully registered ${res.length} command(s) in dev guild.`);
}

/**
 * One-shot migration tool. NOT safe to invoke routinely on bots with
 * many hundreds of guilds: Discord's per-route + global rate limits
 * apply, and the discord.js REST queue handles retries but the loop
 * still walks each guild sequentially. A `rateLimited` listener is
 * registered so operators can see when the queue is throttling, and
 * an explicit per-iteration delay paces the worst case under the
 * 50 req/s global ceiling. Increase `PER_ITER_DELAY_MS` if your
 * deployment regularly hits the global limit during cleanup.
 */
const PER_ITER_DELAY_MS = 250;

async function cleanupGuildCommands(botName: string): Promise<void> {
    const { token, clientId } = loadBotConfig(botName);

    const rest = new REST({ version: "10" }).setToken(token);
    rest.on('rateLimited', (info) => {
        console.warn(
            `[rate-limit] route=${info.route} timeout=${info.timeToReset}ms global=${info.global}`,
        );
    });
    const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];

    console.log(
        `Cleanup mode: removing guild-scoped commands from ${guilds.length} guild(s). Global commands left untouched.`,
    );
    if (guilds.length > 50) {
        console.warn(
            `[warn] ${guilds.length} guilds detected. Cleanup is a one-shot migration tool; ` +
                `consider running off-peak. Pacing at ${PER_ITER_DELAY_MS}ms between PUTs.`,
        );
    }

    for (const guild of guilds) {
        try {
            await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            console.log(`- Cleared guild commands: ${guild.name} (${guild.id}).`);
        } catch (err) {
            console.error(`- Failed to clear commands for guild ${guild.id}:`, err);
        }
        await new Promise((resolve) => setTimeout(resolve, PER_ITER_DELAY_MS));
    }

    console.log("Cleanup done.");
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const bot = args.bot;

    if (!bot) {
        console.error(
            "Usage:\n" +
                "  yarn deploy -t <bot_name>                          # global (default)\n" +
                "  yarn deploy -t <bot_name> --dev-guild <guild_id>   # guild-side fast iteration\n" +
                "  yarn deploy -t <bot_name> --cleanup-guild-commands # remove legacy guild-scoped commands",
        );
        process.exit(1);
    }

    try {
        if (args.cleanupGuildCommands === true) {
            await cleanupGuildCommands(bot);
        } else if (args.devGuild !== undefined) {
            await deployDevGuild(bot, args.devGuild);
        } else {
            await deployGlobal(bot);
        }
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main();
