import { describe, expect, it } from 'vitest';
import { PluginHost, EventDispatcher, InteractionRouter } from '../../../../src/core/plugin';

/**
 * The `core/plugin` barrel is the plugin layer's only window onto core.
 * This test pins that surface down from both sides: the contracts a
 * plugin legitimately needs are present, and the container's write side
 * plus the composition root's token catalog are not.
 */
describe('core/plugin barrel', () => {
  it('exports the plugin runtime surface', () => {
    expect(PluginHost).toBeDefined();
    expect(EventDispatcher).toBeDefined();
    expect(InteractionRouter).toBeDefined();
  });

  it('does NOT export the container write side or the token catalog', async () => {
    // Importing the barrel as an opaque record lets us assert that the
    // intentionally-withheld names are absent without tripping TS.
    const barrel = (await import('../../../../src/core/plugin')) as Record<string, unknown>;
    expect(barrel.createContainer).toBeUndefined();
    expect(barrel.token).toBeUndefined();
    expect(barrel.ServiceResolutionError).toBeUndefined();
    expect(barrel.DuplicateRegistrationError).toBeUndefined();
    // TOKENS names concrete infra / persistence / plugin types, so it
    // lives with the composition root (src/bot/tokens.ts), not here.
    expect(barrel.TOKENS).toBeUndefined();
  });
});
