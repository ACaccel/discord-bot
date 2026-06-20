/**
 * Contract test for the guild-onboarding port. Verifies the typed
 * seam can be implemented and resolved through a typed token without
 * the port pulling in persistence / infra types.
 */
import { describe, expect, it } from 'vitest';
import { createContainer } from '../../../../src/core/ioc';
import { TOKENS } from '../../../../src/core/ioc/tokens';
import type { GuildOnboardingPort, GuildOnboardingResult } from '../../../../src/core/plugin';

describe('GuildOnboardingPort contract', () => {
  it('can be implemented and resolved via TOKENS.GuildOnboardingPort', async () => {
    const fake: GuildOnboardingPort = {
      onboardGuild: async (guildId: string): Promise<GuildOnboardingResult> => ({
        guildId,
        databaseConnected: true,
        commandsRegistered: true,
      }),
    };
    const container = createContainer();
    container.registerSingleton(TOKENS.GuildOnboardingPort, () => fake);

    const resolved = container.resolve(TOKENS.GuildOnboardingPort);
    const result = await resolved.onboardGuild('123456789012345678');

    expect(result).toEqual({
      guildId: '123456789012345678',
      databaseConnected: true,
      commandsRegistered: true,
    });
  });

  it('surfaces a failed database connection to the caller', async () => {
    const failing: GuildOnboardingPort = {
      onboardGuild: async (): Promise<GuildOnboardingResult> => {
        throw new Error('per-guild database connection failed');
      },
    };
    await expect(failing.onboardGuild('1')).rejects.toThrow('per-guild database connection failed');
  });
});
