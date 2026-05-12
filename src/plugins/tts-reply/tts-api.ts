/**
 * TTS API client.
 *
 * Phase 4b-2 ports `utils/misc.ts#tts_api` into a strict-clean module
 * co-located with the plugin so the strict typecheck does not have to
 * follow the legacy `utils/misc.ts` cascade (which still uses `@bot` /
 * `@utils` path aliases and pre-Phase-1 typing). The function is the
 * sole user of `tts_api` after PR 2 — `src/events/message_reply.ts`
 * still imports the legacy copy from `utils/misc.ts`, but that file is
 * itself dead after PR 2 strips BaseBot's legacy listener bodies.
 *
 * Behaviour preserved verbatim: 40-char limit, translate-to-Japanese
 * via Google Translate's web endpoint, post to local TTS service, read
 * the resulting wav from the wine-bridge temp path, return as a
 * discord.js attachment.
 */
import * as fs from 'node:fs/promises';

import axios, { AxiosError } from 'axios';
import { AttachmentBuilder } from 'discord.js';

const MAX_INPUT_LENGTH = 40;
const TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const TTS_ENDPOINT = 'http://localhost:7860/run/predict/';
const TTS_TEMP_PATH = '/home/acaccel/.wine/drive_c/users/acaccel/Temp';

export interface TtsResult {
  readonly attachment: AttachmentBuilder | null;
  readonly error: string;
}

const errorResult = (message: string): TtsResult => ({ attachment: null, error: message });

export const ttsApi = async (input: string): Promise<TtsResult> => {
  if (input.length > MAX_INPUT_LENGTH) {
    return errorResult(`Message cannot exceed ${MAX_INPUT_LENGTH} characters.`);
  }

  let translated: string;
  try {
    const url =
      `${TRANSLATE_ENDPOINT}?client=gtx&sl=auto&tl=ja&dt=t&q=${encodeURIComponent(input)}`;
    const response = await axios.get<unknown>(url);
    // Google Translate's web endpoint returns nested arrays; access
    // [0][0][0] to reach the translated text. Guard the path so a
    // shape change degrades to an actionable error instead of a
    // runtime TypeError.
    const data = response.data as unknown;
    const first = Array.isArray(data) ? data[0] : undefined;
    const firstPair = Array.isArray(first) ? first[0] : undefined;
    const text = Array.isArray(firstPair) ? firstPair[0] : undefined;
    if (typeof text !== 'string' || text.length === 0) {
      return errorResult('Cannot translate the message.');
    }
    translated = text;
  } catch (err: unknown) {
    return errorResult(
      err instanceof AxiosError
        ? `Translate API failed: ${err.message}`
        : 'Translate API failed.',
    );
  }
  if (translated.includes(' ')) {
    return errorResult('Message cannot contain spaces.');
  }

  let ttsFileName: string;
  try {
    const response = await axios.post<unknown>(TTS_ENDPOINT, {
      fn_index: 0,
      data: [translated, 'setsuna_short1-3_wav', '日本語', 1],
      session_hash: 's5r78fhbum',
    });
    // Expected payload: { data: ["Success", { name: "...wav" }] }
    const data = response.data as { data?: unknown } | undefined;
    const dataArr = Array.isArray(data?.data) ? data.data : undefined;
    const second = dataArr?.[1] as { name?: unknown } | undefined;
    if (typeof second?.name !== 'string' || second.name.length === 0) {
      return errorResult('TTS API did not return a file name.');
    }
    ttsFileName = second.name;
  } catch (err: unknown) {
    return errorResult(
      err instanceof AxiosError ? `TTS API failed: ${err.message}` : 'TTS API failed.',
    );
  }

  // Translate the wine-side path (`C:\\users\\...\\Temp\\X.wav`) to
  // the Linux side mount (`/home/.../Temp/X.wav`).
  const baseName = ttsFileName.split(/[\\/]/).pop();
  if (baseName === undefined || baseName.length === 0) {
    return errorResult('TTS API returned an unusable file path.');
  }
  const linuxPath = `${TTS_TEMP_PATH}/${baseName}`;

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(linuxPath);
  } catch {
    return errorResult('Cannot read the file.');
  }

  const timestamp = new Date().toLocaleString().replace(/\/|:|\s/g, '-');
  const attachment = new AttachmentBuilder(buffer, { name: `${timestamp}.wav` });
  return { attachment, error: '' };
};
