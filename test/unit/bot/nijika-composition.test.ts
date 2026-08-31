/**
 * Composition test for the Nijika personality.
 *
 * Pins nijika's plugin set: the full interactive suite, without
 * `llm-auto-reply` (a gopher-only feature). Adding it here — or dropping
 * one of the registered plugins — is caught by spying on
 * `BaseBot.prototype.use`.
 */
/* eslint-disable import/first */
import { describe, expect, it, vi } from 'vitest';

import { buildInertClient } from '../../fixtures/discord/client-builder';
import { barrelStubs } from '../../fixtures/handler-barrel-stubs';

vi.mock('@cmd', () => barrelStubs.cmd);
vi.mock('@button', () => barrelStubs.button);
vi.mock('@modal', () => barrelStubs.modal);
vi.mock('@select-menu', () => barrelStubs.selectMenu);
vi.mock('@reaction', () => barrelStubs.reaction);

import { BaseBot } from '../../../src/bot/index';
import { Nijika } from '../../../src/bot/nijika/nijika';
import type { Plugin } from '../../../src/core/plugin';

const collectRegisteredPluginIds = (): string[] => {
  const ids: string[] = [];
  const useSpy = vi.spyOn(BaseBot.prototype, 'use').mockImplementation(function (
    this: BaseBot,
    plugin: Plugin,
  ) {
    ids.push(plugin.id);
    return this;
  });
  try {
    new Nijika(
      buildInertClient(),
      'token',
      '',
      'bot-client',
      { commands: [], level_roles: {} },
      3000,
    );
  } finally {
    useSpy.mockRestore();
  }
  return ids;
};

describe('Nijika composition', () => {
  it('registers its full interactive plugin set', () => {
    expect(new Set(collectRegisteredPluginIds())).toEqual(
      new Set([
        'auto-reply',
        'guild-events',
        'social-link-preview',
        'giveaway',
        'temp-role',
        'activity',
        'voice',
        'x-media-feed',
        'earthquake',
      ]),
    );
  });

  it('no longer registers llm-auto-reply (moved to gopher)', () => {
    expect(collectRegisteredPluginIds()).not.toContain('llm-auto-reply');
  });
});
