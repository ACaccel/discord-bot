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

  it('marks a string option autocomplete so Discord queries the handler hook', () => {
    const config: LocalizedCommandConfig = {
      name: 'feed_unsubscribe',
      description: 'Stop forwarding posts',
      options: {
        string: [{ name: 'account', description: 'Account', required: false, autocomplete: true }],
      },
    };

    const json = buildCommandJsonBody(config);
    const options = 'options' in json ? (json.options ?? []) : [];

    // Read off the REST payload rather than the config: `setAutocomplete`
    // is the only thing that makes Discord send the interaction at all,
    // and a builder that dropped the call would look identical upstream.
    expect(options[0]).toMatchObject({ name: 'account', autocomplete: true });
  });

  it('leaves autocomplete off an option that did not ask for it', () => {
    const config: LocalizedCommandConfig = {
      name: 'remind',
      description: 'Set a reminder',
      options: { string: [{ name: 'note', description: 'Note', required: false }] },
    };

    const json = buildCommandJsonBody(config);
    const options = 'options' in json ? (json.options ?? []) : [];

    expect(options[0]).not.toHaveProperty('autocomplete', true);
  });

  it('rejects a string option carrying both choices and autocomplete', () => {
    // Discord answers this combination with an opaque 400 at deploy
    // time, naming neither the command nor the option.
    const config: LocalizedCommandConfig = {
      name: 'feed_unsubscribe',
      description: 'Stop forwarding posts',
      options: {
        string: [
          {
            name: 'account',
            description: 'Account',
            required: false,
            autocomplete: true,
            choices: [{ name: 'One', value: 'one' }],
          },
        ],
      },
    };

    expect(() => buildCommandJsonBody(config)).toThrow(TypeError);
    expect(() => buildCommandJsonBody(config)).toThrow(/mutually exclusive/);
  });

  it('rejects autocomplete on an option kind Discord does not support it on', () => {
    const config: LocalizedCommandConfig = {
      name: 'remind',
      description: 'Set a reminder',
      options: {
        number: [{ name: 'count', description: 'Count', required: false, autocomplete: true }],
      },
    };

    expect(() => buildCommandJsonBody(config)).toThrow(/string options only/);
  });
});
