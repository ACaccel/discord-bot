/**
 * Shared bounded HTTP client for outbound third-party calls.
 *
 * Lives in `infra/` because it is an axios adapter — an SDK boundary,
 * the same category as the Mongo connection manager or a provider
 * client. Both `handlers/` and `plugins/` may import it.
 *
 * A bare `axios.get` has **no** timeout by default, so an upstream that
 * accepts the connection and then stalls leaves the caller's promise
 * pending for the lifetime of the process — inside a Discord
 * interaction that means a deferred reply that is never edited and a
 * socket that is never released. The instance also caps the response
 * size and the redirect chain: a handler renders the response into a
 * Discord message, so nothing it could legitimately receive is large,
 * and an unbounded redirect chain is a server-side-request-forgery
 * amplifier.
 *
 * {@link getJson} / {@link postJson} are the preferred entry points:
 * axios types `response.data` as `any`, and validating against a zod
 * schema at the boundary is what stops that `any` leaking into a
 * handler, where a shape change becomes a `TypeError` mistaken for a
 * domain outcome. The generic is bound to the schema (not to its output
 * type) so `z.infer` resolves the parsed shape rather than the input
 * shape — the two differ wherever a field carries `.default()`.
 */
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { z } from 'zod';

/**
 * Per-request deadline. Chosen well below Discord's 15-minute
 * interaction window but above the tail latency of the public APIs the
 * callers use, so a slow-but-alive upstream still answers.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Ceiling on a response body a caller will read into memory. */
const MAX_CONTENT_LENGTH = 8 * 1024 * 1024;

/** Redirect hops followed before the request is abandoned. */
const MAX_REDIRECTS = 3;

/**
 * Bounded axios instance. Use this rather than the bare `axios`
 * default export.
 */
export const boundedHttp: AxiosInstance = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  maxContentLength: MAX_CONTENT_LENGTH,
  maxBodyLength: MAX_CONTENT_LENGTH,
  maxRedirects: MAX_REDIRECTS,
});

/**
 * `GET` `url` and validate the JSON body against `schema`.
 *
 * @throws {z.ZodError} when the body does not match — model the
 *   upstream's *empty* answer as a valid parse (a nullable field) so a
 *   real shape change stays distinguishable from "nothing found".
 */
export const getJson = async <S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  config?: AxiosRequestConfig,
): Promise<z.infer<S>> => {
  const response = await boundedHttp.get<unknown>(url, config);
  return schema.parse(response.data) as z.infer<S>;
};

/** `POST` `url` and validate the JSON body against `schema`. See {@link getJson}. */
export const postJson = async <S extends z.ZodTypeAny>(
  url: string,
  schema: S,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<z.infer<S>> => {
  const response = await boundedHttp.post<unknown>(url, body, config);
  return schema.parse(response.data) as z.infer<S>;
};
