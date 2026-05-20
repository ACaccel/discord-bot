import { describe, expect, it } from 'vitest';
import { ApplicationCommandType } from 'discord.js';

import { buildCommandJsonBody } from '../../../src/handlers/commands/command-builder';
import type { LocalizedCommandConfig } from '../../../src/handlers/commands/command';

describe('buildCommandJsonBody', () => {
  it('builds a bare chat-input command with name and description', () => {
    const config: LocalizedCommandConfig = {
      name: 'ping',
      description: 'Check latency',
    };

    const json = buildCommandJsonBody(config);

    expect(json.name).toBe('ping');
    expect('description' in json && json.description).toBe('Check latency');
  });

  it('builds a context-menu command without description or options', () => {
    const config: LocalizedCommandConfig = {
      name: 'Report Message',
      description: 'unused for context menus',
      type: ApplicationCommandType.Message,
    };

    const json = buildCommandJsonBody(config);

    expect(json.name).toBe('Report Message');
    expect(json.type).toBe(ApplicationCommandType.Message);
  });

  it('orders required options before optional ones', () => {
    const config: LocalizedCommandConfig = {
      name: 'remind',
      description: 'Set a reminder',
      options: {
        string: [
          { name: 'note', description: 'Optional note', required: false },
          { name: 'when', description: 'When to remind', required: true },
        ],
      },
    };

    const json = buildCommandJsonBody(config);
    const options = 'options' in json ? (json.options ?? []) : [];

    expect(options.map((o) => o.name)).toEqual(['when', 'note']);
  });

  it('renders every supported option kind', () => {
    const config: LocalizedCommandConfig = {
      name: 'configure',
      description: 'Configure settings',
      options: {
        string: [
          {
            name: 'mode',
            description: 'Mode',
            required: true,
            choices: [{ name: 'Fast', value: 'fast' }],
          },
        ],
        number: [{ name: 'count', description: 'Count', required: true, min: 1, max: 9 }],
        float: [{ name: 'ratio', description: 'Ratio', required: false, min: 0, max: 1 }],
        user: [{ name: 'target', description: 'Target user', required: true }],
        channel: [{ name: 'where', description: 'Target channel', required: false }],
        attachment: [{ name: 'file', description: 'A file', required: false }],
      },
    };

    const json = buildCommandJsonBody(config);
    const options = 'options' in json ? (json.options ?? []) : [];

    expect(options.map((o) => o.name).sort()).toEqual(
      ['count', 'file', 'mode', 'ratio', 'target', 'where'].sort(),
    );
  });
});
