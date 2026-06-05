import * as path from 'node:path';

import type { Client } from 'discord.js';

import type { Config } from '@bot';
import { BaseBot } from '@bot';
import {
    createIdentitySyncPlugin,
    createLlmAutoReplyPlugin,
    createSettingsApiPlugin,
} from '@plugins';

import { GopherSettingsStore } from './settings-store';

interface GopherConfig extends Config {
    /**
     * Raw `llm_auto_reply` block. Parsed and defaulted by the plugin
     * (see `createLlmAutoReplyPlugin`), so it is intentionally `unknown`
     * here and may be omitted entirely.
     */
    llm_auto_reply?: unknown;
    /** Raw `settings_api` block, parsed by `createSettingsApiPlugin`. */
    settings_api?: unknown;
    /** Raw `identity_sync` block, parsed by `createIdentitySyncPlugin`. */
    identity_sync?: unknown;
}

/**
 * Gopher composition root. A focused, database-free personality whose job
 * is the ported self-hosted LLM auto-reply (formerly nijika's), plus two
 * gopher-only capabilities: an owner-only settings REST API and a daily
 * avatar/nickname identity sync.
 *
 * The runtime-mutable LLM endpoint lives in {@link GopherSettingsStore}
 * (this layer owns `config.json` persistence); the auto-reply plugin reads
 * it through an `endpointProvider` and the settings API mutates it, so the
 * two plugins stay decoupled from the file.
 */
export class Gopher extends BaseBot<GopherConfig> {
    /**
     * @param settingsPort - TCP port for the settings REST API (from the
     *   validated `Env.PORT`).
     * @param settingsApiKey - Bearer key for the settings API (from
     *   `Env.GOPHER_SETTINGS_API_KEY`). Both are threaded through the
     *   constructor rather than read here so the composition root in
     *   `index.ts` stays the single place that touches the environment.
     */
    public constructor(
        client: Client,
        token: string,
        mongoURI: string,
        clientId: string,
        config: GopherConfig,
        settingsPort: number,
        settingsApiKey: string | undefined,
    ) {
        super(client, token, mongoURI, clientId, config);
        this.helpMessageKey = 'replies:gopher.help_message';

        // Single owner of the runtime-mutable endpoint and its persistence.
        // Seeded from the already-imported `llm_auto_reply` block so
        // construction stays free of filesystem I/O; the path is used only
        // when persisting an operator's runtime update.
        const store = new GopherSettingsStore(
            path.join(__dirname, 'config.json'),
            this.config.llm_auto_reply,
        );

        // Ported from nijika: occasional self-hosted LLM auto-reply. The live
        // endpoint comes from the store so the settings API can swap it at
        // runtime. gopher applies no channel exclusions.
        this.use(
            createLlmAutoReplyPlugin(this.config.llm_auto_reply, {
                clientId: this.clientId,
                endpointProvider: () => store.getEndpoint(),
            }),
        );
        // Owner-only REST API to read/update the endpoint and persist it.
        this.use(
            createSettingsApiPlugin(this.config.settings_api, {
                port: settingsPort,
                apiKey: settingsApiKey,
                getEndpoint: () => store.getEndpoint(),
                setEndpoint: (url) => store.setEndpoint(url),
            }),
        );
        // Daily avatar/nickname sync with a source user (or static fallback).
        this.use(createIdentitySyncPlugin(this.config.identity_sync));
    }
}
