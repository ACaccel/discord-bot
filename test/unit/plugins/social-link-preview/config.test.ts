/**
 * Unit tests for {@link parseSocialLinkPreviewConfig}: an absent / partial
 * block yields the disabled, fully-defaulted config; an unknown key fails
 * fast (`.strict()`).
 */
import { describe, expect, it } from 'vitest';

import { parseSocialLinkPreviewConfig } from '../../../../src/plugins/social-link-preview/config';
import { DEFAULT_PROXY_HOSTS } from '../../../../src/infra/link-preview';

describe('parseSocialLinkPreviewConfig', () => {
  it('returns the disabled, fully-defaulted config when the block is absent', () => {
    const config = parseSocialLinkPreviewConfig(undefined);
    expect(config.enabled).toBe(false);
    expect(config.originalMessageStrategy).toBe('suppress');
    expect(config.maxUrlsPerMessage).toBe(1);
    expect(config.timeoutMs).toBe(4000);
    expect(config.validationBudgetMs).toBe(8000);
    // The config defaults must stay in lockstep with the registry's
    // DEFAULT_PROXY_HOSTS — this guards against the two lists drifting.
    expect(config.twitterProxyHosts).toEqual(DEFAULT_PROXY_HOSTS.twitter);
    expect(config.instagramProxyHosts).toEqual(DEFAULT_PROXY_HOSTS.instagram);
    expect(config.threadsProxyHosts).toEqual(DEFAULT_PROXY_HOSTS.threads);
    expect(config.facebookProxyHosts).toEqual(DEFAULT_PROXY_HOSTS.facebook);
    expect(config.redditProxyHosts).toEqual(DEFAULT_PROXY_HOSTS.reddit);
    expect(config.providers).toBeUndefined();
  });

  it('fills defaults around a partial block, keeping other proxy lists at default', () => {
    const config = parseSocialLinkPreviewConfig({
      enabled: true,
      providers: ['twitter', 'bahamut'],
      twitterProxyHosts: ['fxtwitter.com'],
    });
    expect(config.enabled).toBe(true);
    expect(config.providers).toEqual(['twitter', 'bahamut']);
    expect(config.twitterProxyHosts).toEqual(['fxtwitter.com']);
    expect(config.instagramProxyHosts).toEqual(['kkinstagram.com', 'uuinstagram.com']);
    expect(config.originalMessageStrategy).toBe('suppress');
  });

  it('rejects an unknown key (strict schema)', () => {
    expect(() => parseSocialLinkPreviewConfig({ enabled: true, bogus: 1 })).toThrow();
  });

  it('rejects the removed scalar proxy-host keys (migrated to arrays)', () => {
    expect(() => parseSocialLinkPreviewConfig({ twitterProxyHost: 'fxtwitter.com' })).toThrow();
  });

  it('rejects an empty proxy-host list (nonempty)', () => {
    expect(() => parseSocialLinkPreviewConfig({ twitterProxyHosts: [] })).toThrow();
  });

  it('rejects an out-of-range timeout / budget and an invalid provider name', () => {
    expect(() => parseSocialLinkPreviewConfig({ timeoutMs: 999_999 })).toThrow();
    expect(() => parseSocialLinkPreviewConfig({ validationBudgetMs: 999_999 })).toThrow();
    expect(() => parseSocialLinkPreviewConfig({ providers: ['myspace'] })).toThrow();
  });
});
