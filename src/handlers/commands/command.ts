/**
 * Command metadata contract and i18n resolution.
 *
 * Split out of `commands/index.ts` so it carries no dependency on the
 * generated handler registry — handler subclasses, the deploy CLI, and
 * unit tests can import `Command` / `CommandConfig` / `localizeCommandConfig`
 * without dragging in every handler module (which `index.ts` does via
 * `registry.generated.ts`).
 */
import type {
    ChatInputCommandInteraction,
    ContextMenuCommandInteraction,
    ContextMenuCommandType,
} from 'discord.js';
import type { BaseBot } from '@bot';

import type { Translator } from '../../core/i18n';

/**
 * Self-describing slash-command metadata.
 *
 * `description` (and `CommandOption.description`) are not stored inline:
 * a handler's `setConfig` omits them entirely, and
 * {@link localizeCommandConfig} fills them from the `commands` i18n
 * namespace, deriving the catalog key from {@link CommandConfig.name}.
 * Context-menu commands take their localised `name` from
 * `commands:<name>.name`.
 *
 * The optional `description` therefore models the *pre-localisation*
 * shape stored by handlers; consumers that build the Discord command
 * JSON (`getCommandJsonBody`, `deploy.ts`) run the config through
 * `localizeCommandConfig` first so `description` is defined.
 */
/**
 * Grouping key used by `/help` to render commands under a labelled
 * section. Stable ASCII ids (the display label is resolved from
 * `replies:help.category.<key>`), so this stays CJK-free. A command
 * that omits `category` falls into `'other'`.
 */
export type CommandCategory =
    | 'auto_reply'
    | 'fun'
    | 'server_activity'
    | 'utility'
    | 'admin'
    | 'ai'
    | 'other';

export interface CommandConfig {
    name: string; // command name for handler lookup and Discord registration
    /** Resolved from `commands:<name>.description`; omitted by handlers. */
    description?: string;
    type?: ContextMenuCommandType; // for context menu commands, default is Chat Input
    /** `/help` grouping key; defaults to `'other'` when a handler omits it. */
    category?: CommandCategory;
    options?: {
        string?: CommandOption[];
        number?: CommandOption[];
        float?: CommandOption[];
        user?: CommandOption[];
        channel?: CommandOption[];
        attachment?: CommandOption[];
    };
}

export interface CommandOption {
    name: string;
    /** Resolved from `commands:<cmd>.options.<name>.description`. */
    description?: string;
    required: boolean;
    choices?: CommandChoice[];
    /** Minimum numeric value (only applies to `number` and `float` options). */
    min?: number;
    /** Maximum numeric value (only applies to `number` and `float` options). */
    max?: number;
}

export interface CommandChoice {
    /**
     * Display label. Optional in the pre-localisation shape: a handler
     * may omit it and let {@link localizeCommandConfig} fill it from
     * `commands:<cmd>.options.<opt>.choices.<value>`. Handlers whose
     * choice list is sourced from a colocated data file (e.g.
     * `change_avatar`, `random_restaurant`) set it directly.
     */
    name?: string;
    value: string;
}

/**
 * A {@link CommandConfig} whose i18n-keyed metadata has been resolved
 * to concrete display strings by {@link localizeCommandConfig}. The
 * Discord command-JSON builder consumes this stricter shape so the
 * `description` fields are statically known to be present.
 */
export interface LocalizedCommandConfig extends CommandConfig {
    description: string;
    options?: {
        string?: LocalizedCommandOption[];
        number?: LocalizedCommandOption[];
        float?: LocalizedCommandOption[];
        user?: LocalizedCommandOption[];
        channel?: LocalizedCommandOption[];
        attachment?: LocalizedCommandOption[];
    };
}

/** A {@link CommandOption} with its description and choices resolved. */
export interface LocalizedCommandOption extends CommandOption {
    description: string;
    choices?: LocalizedCommandChoice[];
}

/** A {@link CommandChoice} with its display label resolved. */
export interface LocalizedCommandChoice extends CommandChoice {
    name: string;
}

/**
 * Abstract base for every slash-command / context-menu handler.
 *
 * Command pattern: each concrete handler is a self-describing command
 * object the dispatcher invokes polymorphically through `execute`.
 */
export abstract class Command {
    public config: CommandConfig;

    public constructor() {
        this.config = { name: '' };
    }

    public setConfig(config: CommandConfig): void {
        this.config = config;
    }

    public abstract execute(
        interaction: ChatInputCommandInteraction | ContextMenuCommandInteraction,
        bot: BaseBot,
    ): Promise<void>;
}

/**
 * Resolve a {@link CommandConfig}'s i18n-keyed metadata into a config
 * carrying concrete display strings.
 *
 * Catalog keys are derived from the command / option names:
 *   - command description -> `commands:<name>.description`
 *   - context-menu display name -> `commands:<name>.name`
 *   - option description -> `commands:<name>.options.<opt>.description`
 *   - choice label -> `commands:<name>.options.<opt>.choices.<value>`
 *
 * Resolution happens against the translator's default locale. Returns
 * a shallow copy; the input is not mutated.
 */
export const localizeCommandConfig = (
    config: CommandConfig,
    translator: Translator | undefined,
): LocalizedCommandConfig => {
    const t = (key: string): string => translator?.t(key) ?? '';
    const isContextMenu = config.type !== undefined;
    const localizeOption = (opt: CommandOption): LocalizedCommandOption => {
        const { choices, ...rest } = opt;
        const localizedChoices = choices?.map(
            (choice): LocalizedCommandChoice => ({
                value: choice.value,
                // A choice that already carries a `name` (data-file sourced)
                // keeps it; otherwise the label is resolved by stable `value`.
                name:
                    choice.name ??
                    t(`commands:${config.name}.options.${opt.name}.choices.${choice.value}`),
            }),
        );
        return {
            ...rest,
            description: t(`commands:${config.name}.options.${opt.name}.description`),
            ...(localizedChoices ? { choices: localizedChoices } : {}),
        };
    };

    const localizedOptions: LocalizedCommandConfig['options'] | undefined = config.options
        ? Object.fromEntries(
              Object.entries(config.options).map(([optType, opts]) => [
                  optType,
                  (opts as CommandOption[]).map((opt) => localizeOption(opt)),
              ]),
          )
        : undefined;

    return {
        // A context-menu command's `config.name` is a stable ASCII id
        // (the handler directory name); its user-facing Discord name is
        // resolved from `commands:<id>.name`. Chat-input commands keep
        // their name (Discord requires a lowercase-ASCII command name,
        // which the id already is).
        name: isContextMenu ? t(`commands:${config.name}.name`) : config.name,
        ...(config.type !== undefined ? { type: config.type } : {}),
        // Context-menu commands carry no description; chat-input commands do.
        description: isContextMenu ? '' : t(`commands:${config.name}.description`),
        ...(localizedOptions ? { options: localizedOptions } : {}),
    };
};
