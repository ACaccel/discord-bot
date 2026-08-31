/**
 * Bounds on the shared outbound HTTP client.
 *
 * The timeout, size ceiling and redirect cap *are* the module: every
 * consumer test stubs the request, so without this file all four could
 * be deleted and the suite would stay green. They are the hang and
 * SSRF-amplification bounds the client exists to impose.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { boundedHttp, getJson, postJson } from '../../../../src/infra/http';

describe('boundedHttp defaults', () => {
  it('sets a request timeout', () => {
    // A bare axios has none, so a stalled upstream leaves a Discord
    // interaction's deferred reply hanging for the process lifetime.
    expect(boundedHttp.defaults.timeout).toBeGreaterThan(0);
    expect(boundedHttp.defaults.timeout).toBeLessThanOrEqual(30_000);
  });

  it('caps the response and request body size', () => {
    expect(boundedHttp.defaults.maxContentLength).toBeGreaterThan(0);
    expect(boundedHttp.defaults.maxContentLength).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(boundedHttp.defaults.maxBodyLength).toBe(boundedHttp.defaults.maxContentLength);
  });

  it('caps the redirect chain', () => {
    // An unbounded chain is a server-side-request-forgery amplifier.
    expect(boundedHttp.defaults.maxRedirects).toBeGreaterThan(0);
    expect(boundedHttp.defaults.maxRedirects).toBeLessThanOrEqual(5);
  });
});

const Schema = z.object({ id: z.number(), tags: z.array(z.string()).default([]) });

describe('getJson / postJson', () => {
  it('returns the parsed body, with defaults applied', async () => {
    const original = boundedHttp.get.bind(boundedHttp);
    boundedHttp.get = (async () => ({ data: { id: 7 } })) as typeof boundedHttp.get;
    try {
      const parsed = await getJson('https://example.test/x', Schema);
      // The generic resolves the schema's *output*, so `tags` is present
      // and non-optional here.
      expect(parsed).toEqual({ id: 7, tags: [] });
    } finally {
      boundedHttp.get = original;
    }
  });

  it('rejects a body that does not match the schema', async () => {
    const original = boundedHttp.post.bind(boundedHttp);
    boundedHttp.post = (async () => ({ data: { id: 'not-a-number' } })) as typeof boundedHttp.post;
    try {
      // A changed upstream shape must surface as a failure, not as an
      // `any` that becomes a TypeError somewhere downstream.
      await expect(postJson('https://example.test/x', Schema)).rejects.toThrow();
    } finally {
      boundedHttp.post = original;
    }
  });
});
