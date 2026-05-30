/**
 * Slash-command deploy CLI.
 *
 * The default registration scope is **global**: a single
 * `rest.put(Routes.applicationCommands)` call publishes the bot's
 * command set to every guild it is in (and every guild it joins
 * later). The guild-side path is an opt-in dev path via
 * `--dev-guild <id>` so iteration on a single test guild stays
 * instant (Discord propagation for global commands can take up to an
 * hour).
 *
 * The `--cleanup-guild-commands` flag wipes guild-scoped
 * registrations: it iterates `userGuilds()` and PUTs an empty array
 * to each guild's command bucket. Run it once to clear any
 * guild-scoped entries so users do not see duplicates alongside the
 * global commands.
 *
 * Usage:
 *   yarn deploy -t nijika                 # global (default)
 *   yarn deploy -t nijika --dev-guild ID  # guild-side fast iteration
 *   yarn deploy -t nijika --dry-run       # print resolved command text, register nothing
 *   yarn deploy -t nijika --cleanup-guild-commands
 *
 * Command text is localised to the bot's `config.language` (see
 * `buildDeployTranslator`). Note global registrations can take up to an
 * hour to propagate, and any stale guild-scoped commands override the
 * global set in that guild — use `--dev-guild` for instant iteration or
 * `--cleanup-guild-commands` to clear leftovers.
 */
import type { ApplicationCommandDataResolvable } from "discord.js";
import { REST, Routes } from "discord.js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import { buildCommandJsonBody, createCommand, localizeCommandConfig } from "@cmd";
import { createBootstrapLogger, loadEnv } from '@core/config';
import { createDefaultTranslator, isLocale, type Locale, type Translator } from '@core/i18n';

import { resolveLocalesDir } from './bot/locales-dir';

// Deploy runs before the IoC container is built, so the typed `Logger`
// bound to `TOKENS.Logger` is not available. Use the bootstrap logger
// (the same construct `BaseBot.run()` falls back to during phase 1)
// so the deploy CLI still emits structured pino lines instead of raw
// `console.*` writes. `fileRouter: false` keeps it console-only: deploy
// is a one-shot CLI with no `bot` binding (which the file router
// requires) and must not create a `logs/<botId>/` tree.
const logger = createBootstrapLogger({ component: 'deploy' }, { fileRouter: false });

type DeployArgs = {
    bot?: string;
    devGuild?: string;
    cleanupGuildCommands?: boolean;
    dryRun?: boolean;
};

type BotConfig = {
    commands?: string[];
    language?: string;
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
        } else if (a === "--dry-run") {
            out.dryRun = true;
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

function loadBotConfig(
    botName: string,
): { token: string; clientId: string; commands: string[]; language?: string } {
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

    return { token, clientId, commands: cfg.commands, language: cfg.language };
}

/**
 * Build the translator the deployed command JSON is localised against,
 * honouring the bot's `config.language` (mirrors `BaseBot.buildHost`).
 * An unsupported value warns and falls back to the framework default so
 * command descriptions register in the locale the running bot will use.
 */
async function buildDeployTranslator(language: string | undefined): Promise<Translator> {
    let fallbackLocale: Locale | undefined;
    if (isLocale(language)) {
        fallbackLocale = language;
    } else if (language !== undefined) {
        logger.warn(
            { language },
            'config.language is not a supported locale; deploying command text in the default locale.',
        );
    }
    return createDefaultTranslator({ localesDir: resolveLocalesDir(), fallbackLocale });
}

function buildCommandsFromConfig(
    commands: string[],
    translator: Translator,
): ApplicationCommandDataResolvable[] {
    const out: ApplicationCommandDataResolvable[] = [];

    for (const name of commands) {
        const instance = createCommand(name);
        if (!instance || !instance.config) {
            logger.warn({ command: name }, 'Command could not be created or has no config.');
            continue;
        }

        // Command / option descriptions are i18n keys resolved here
        // against the `commands` catalog so the deployed JSON keeps its
        // localised text.
        out.push(buildCommandJsonBody(localizeCommandConfig(instance.config, translator)));
    }

    return out;
}

async function deployGlobal(botName: string): Promise<void> {
    const { token, clientId, commands, language } = loadBotConfig(botName);

    const translator = await buildDeployTranslator(language);
    const body = buildCommandsFromConfig(commands, translator);
    if (body.length === 0) {
        logger.error('No commands to deploy (after filtering).');
        process.exit(1);
    }

    const rest = new REST({ version: "10" }).setToken(token);

    logger.info(
        { bot: botName, count: body.length, scope: 'global' },
        'Deploying commands GLOBALLY (visible in every guild after Discord propagation, typically minutes).',
    );

    const res = (await rest.put(Routes.applicationCommands(clientId), {
        body,
    })) as unknown as { id: string }[];

    logger.info({ count: res.length }, 'Successfully registered global command(s).');
}

async function deployDevGuild(botName: string, guildId: string): Promise<void> {
    const { token, clientId, commands, language } = loadBotConfig(botName);

    const translator = await buildDeployTranslator(language);
    const body = buildCommandsFromConfig(commands, translator);
    if (body.length === 0) {
        logger.error('No commands to deploy (after filtering).');
        process.exit(1);
    }

    const rest = new REST({ version: "10" }).setToken(token);

    logger.info(
        { bot: botName, count: body.length, scope: 'guild', guildId },
        'Deploying commands to dev guild (guild-scoped — instant propagation).',
    );

    const res = (await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body,
    })) as unknown as { id: string }[];

    logger.info({ count: res.length, guildId }, 'Successfully registered dev-guild command(s).');
}

/**
 * Build the command payload and print each command's resolved name and
 * description WITHOUT registering anything with Discord. Lets operators
 * confirm the per-bot `language` produces the expected localised text
 * locally, sidestepping global-command propagation delay (up to ~1h)
 * and stale guild-scoped registrations when debugging command text.
 */
async function deployDryRun(botName: string): Promise<void> {
    const { commands, language } = loadBotConfig(botName);
    const translator = await buildDeployTranslator(language);
    const body = buildCommandsFromConfig(commands, translator);

    logger.info(
        { bot: botName, count: body.length, language: language ?? '(default)' },
        'Dry run — built command JSON locally; nothing registered with Discord.',
    );
    for (const cmd of body) {
        const c = cmd as { name?: string; description?: string };
        logger.info({ command: c.name, description: c.description }, 'resolved command');
    }
}

/**
 * One-shot cleanup tool. NOT safe to invoke routinely on bots with
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
        logger.warn(
            { route: info.route, timeoutMs: info.timeToReset, global: info.global },
            'Discord REST rate limit hit.',
        );
    });
    const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];

    logger.info(
        { guildCount: guilds.length },
        'Cleanup mode: removing guild-scoped commands. Global commands left untouched.',
    );
    if (guilds.length > 50) {
        logger.warn(
            { guildCount: guilds.length, perIterDelayMs: PER_ITER_DELAY_MS },
            'Large guild count detected. Cleanup is a one-shot migration tool; consider running off-peak.',
        );
    }

    for (const guild of guilds) {
        try {
            await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: [] });
            logger.info({ guildName: guild.name, guildId: guild.id }, 'Cleared guild commands.');
        } catch (err) {
            logger.error(
                { guildId: guild.id, err: err instanceof Error ? err : new Error(String(err)) },
                'Failed to clear commands for guild.',
            );
        }
        await new Promise((resolve) => setTimeout(resolve, PER_ITER_DELAY_MS));
    }

    logger.info('Cleanup done.');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const bot = args.bot;

    if (!bot) {
        logger.error(
            'Usage:\n' +
                '  yarn deploy -t <bot_name>                          # global (default)\n' +
                '  yarn deploy -t <bot_name> --dev-guild <guild_id>   # guild-side fast iteration\n' +
                '  yarn deploy -t <bot_name> --dry-run                # print resolved command text, register nothing\n' +
                '  yarn deploy -t <bot_name> --cleanup-guild-commands # remove legacy guild-scoped commands',
        );
        process.exit(1);
    }

    try {
        if (args.dryRun === true) {
            await deployDryRun(bot);
        } else if (args.cleanupGuildCommands === true) {
            await cleanupGuildCommands(bot);
        } else if (args.devGuild !== undefined) {
            await deployDevGuild(bot, args.devGuild);
        } else {
            await deployGlobal(bot);
        }
    } catch (err) {
        logger.error(
            { err: err instanceof Error ? err : new Error(String(err)) },
            'Deploy CLI failed.',
        );
        process.exit(1);
    }
}

main();
