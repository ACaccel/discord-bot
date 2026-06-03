/**
 * Unit tests for the settings-api plugin's config contract and shape.
 * The live HTTP behaviour (auth, validation, persistence) is exercised
 * end-to-end in `test/integration/plugins/settings-api-route.int.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { createSettingsApiPlugin } from '../../../src/plugins/settings-api';
import { parseSettingsApiConfig } from '../../../src/plugins/settings-api/config';

describe('parseSettingsApiConfig', () => {
  it('fills safe defaults for an absent block', () => {
    expect(parseSettingsApiConfig(undefined)).toEqual({
      enabled: false,
      host: '127.0.0.1',
      basePath: '/settings',
    });
  });

  it('rejects an unknown key (strict)', () => {
    expect(() => parseSettingsApiConfig({ bogus: 1 })).toThrow();
  });

  it('rejects a basePath that does not start with "/"', () => {
    expect(() => parseSettingsApiConfig({ basePath: 'settings' })).toThrow();
  });
});

describe('createSettingsApiPlugin', () => {
  it('has the expected plugin shape', () => {
    const plugin = createSettingsApiPlugin(
      {},
      { port: 0, apiKey: 'k', getEndpoint: () => 'x', setEndpoint: async () => undefined },
    );
    expect(plugin.id).toBe('settings-api');
    expect(plugin.scope).toBe('bot');
    expect(plugin.critical).toBe(false);
    expect(plugin.start).toBeTypeOf('function');
    expect(plugin.onShutdown).toBeTypeOf('function');
  });
});
