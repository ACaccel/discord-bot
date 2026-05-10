import {
    ChatInputCommandInteraction,
    LabelBuilder,
    ModalBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
} from 'discord.js';
import { BaseBot } from '@bot';
import { Command } from '@cmd';
import { logger } from '@utils';
import { LLMProviderName, listProviderModels } from '@llm_chat';

interface UserApiDoc {
    provider: string;
    model: string;
    temperature: number;
    system_prompt: string;
    web_search: boolean;
}

const PROVIDER_CHOICES: Array<{ name: string; value: LLMProviderName }> = [
    { name: 'xAI (Grok)', value: 'xai' },
    { name: 'OpenAI (GPT)', value: 'openai' },
    { name: 'Anthropic (Claude)', value: 'anthropic' },
    { name: 'Google Gemini', value: 'gemini' },
];

export default class ai_settings extends Command {
    constructor() {
        super();
        this.setConfig({
            name: 'ai_settings',
            description: '一次性編輯你的 AI 設定（model / temperature / web search / system prompt）',
            options: {
                string: [
                    {
                        name: 'provider',
                        description: '選擇 AI provider，後續 model 候選將依此 provider 動態載入',
                        required: true,
                        choices: PROVIDER_CHOICES,
                    },
                ],
            },
        });
    }

    public override async execute(interaction: ChatInputCommandInteraction, bot: BaseBot): Promise<void> {
        const provider = interaction.options.getString('provider', true) as LLMProviderName;
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.reply({ content: '此指令只能在伺服器中使用。', flags: MessageFlags.Ephemeral });
            return;
        }

        const UserApiSetting = bot.guildInfo[guildId]?.db?.models['UserApiSetting'];
        if (!UserApiSetting) {
            await interaction.reply({ content: '資料庫連線異常，請稍後再試。', flags: MessageFlags.Ephemeral });
            return;
        }

        let doc: UserApiDoc | null;
        try {
            doc = await UserApiSetting.findOne({ userId }).lean() as UserApiDoc | null;
        } catch (err) {
            logger.errorLogger(bot.clientId, guildId, err);
            await interaction.reply({ content: '資料庫操作失敗，請稍後再試。', flags: MessageFlags.Ephemeral });
            return;
        }
        if (!doc) {
            await interaction.reply({ content: '你不在白名單中，請聯絡管理員。', flags: MessageFlags.Ephemeral });
            return;
        }

        // listProviderModels is synchronous: cache hit -> live list, cache
        // miss -> empty array (it kicks off a background SDK refresh). We
        // never fall back to a guessed list, so the user gets an honest
        // signal when the provider is unreachable instead of seeing stale
        // model names treated as canonical.
        const modelOptions = listProviderModels(provider);
        if (modelOptions.length === 0) {
            await interaction.reply({
                content: `目前無法取得 \`${provider}\` 的可用模型清單。可能原因：API 金鑰未設定、網路暫時失敗，或服務剛啟動仍在載入。請稍候片刻後重試。`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const modal = buildSettingsModal(provider, doc, modelOptions);
        await interaction.showModal(modal);
    }
}

function buildSettingsModal(
    provider: LLMProviderName,
    current: UserApiDoc,
    modelOptions: string[],
): ModalBuilder {
    const modelSelect = new StringSelectMenuBuilder()
        .setCustomId('model')
        .setPlaceholder('選擇模型')
        .addOptions(
            modelOptions.map((m) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(m)
                    .setValue(m)
                    .setDefault(m === current.model),
            ),
        );

    const webSearchSelect = new StringSelectMenuBuilder()
        .setCustomId('web_search')
        .setPlaceholder('網頁搜尋')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('開啟')
                .setValue('on')
                .setDefault(current.web_search),
            new StringSelectMenuOptionBuilder()
                .setLabel('關閉')
                .setValue('off')
                .setDefault(!current.web_search),
        );

    const temperatureInput = new TextInputBuilder()
        .setCustomId('temperature')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(current.temperature.toString())
        .setPlaceholder('0.0 – 2.0');

    const systemPromptInput = new TextInputBuilder()
        .setCustomId('system_prompt')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(4000)
        .setValue(current.system_prompt ?? '')
        .setPlaceholder('（選填）為 AI 設定角色或規則');

    return new ModalBuilder()
        .setCustomId(`ai_settings|${provider}`)
        .setTitle(`AI 設定 — ${provider}`)
        .setLabelComponents(
            new LabelBuilder()
                .setLabel('Model')
                .setStringSelectMenuComponent(modelSelect),
            new LabelBuilder()
                .setLabel('Temperature (0.0 – 2.0)')
                .setTextInputComponent(temperatureInput),
            new LabelBuilder()
                .setLabel('Web Search')
                .setStringSelectMenuComponent(webSearchSelect),
            new LabelBuilder()
                .setLabel('System Prompt')
                .setTextInputComponent(systemPromptInput),
        );
}
