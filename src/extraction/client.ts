// Extraction call: one request per file, document/image block + structured output.
//
// Spec §5 asked for a forced tool call at temperature 0. On the current models both
// are rejected with a 400 (forced tool_choice on Sonnet 5.5; non-default sampling
// parameters on every model), so this uses structured outputs (output_config.format)
// with the same schema. That still guarantees one schema-valid object per file.

import Anthropic from '@anthropic-ai/sdk';
import type { ExtractedDocument, Settings } from '../shared/types';
import { RECORD_DOCUMENT_SCHEMA } from './schema';
import { EXTRACTION_SYSTEM, extractionUserText } from './prompt';
import { validateExtracted } from './validate';

export const SONNET = 'claude-sonnet-5-5';
export const HAIKU = 'claude-haiku-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface ExtractionInput {
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  base64: string;
}

export interface ExtractionResult {
  doc: ExtractedDocument;
  model: string;
  attempts: { model: string; outcome: string }[];
}

export function makeClient(s: Settings): Anthropic {
  if (s.mode === 'proxy') {
    if (!s.proxyUrl) throw new Error('Set the proxy URL in Settings.');
    // The proxy holds the key and authenticates the KKU user from the SSO cookie.
    return new Anthropic({
      baseURL: s.proxyUrl.replace(/\/+$/, ''),
      apiKey: 'held-by-proxy',
      dangerouslyAllowBrowser: true,
      fetchOptions: { credentials: 'include' },
      maxRetries: 2,
    });
  }
  if (!s.apiKey) throw new Error('Set an Anthropic API key in Settings, or use proxy mode.');
  // Sends anthropic-dangerous-direct-browser-access: true.
  return new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Builds the request body. Exported for tests. */
export function buildRequest(input: ExtractionInput, model: string, s: Settings) {
  const source =
    input.mime === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.base64 } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: input.mime, data: input.base64 } } as const);
  const useFallback = s.refusalFallback && model === SONNET;
  return {
    model,
    max_tokens: 16000,
    system: EXTRACTION_SYSTEM,
    messages: [{ role: 'user' as const, content: [source, { type: 'text' as const, text: extractionUserText(input.name) }] }],
    output_config: { effort: s.effort, format: { type: 'json_schema' as const, schema: RECORD_DOCUMENT_SCHEMA } },
    ...(useFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : { betas: [] as string[] }),
  };
}

async function callOnce(client: Anthropic, input: ExtractionInput, model: string, s: Settings): Promise<ExtractedDocument> {
  const req = buildRequest(input, model, s);
  // Streaming avoids HTTP timeouts on large multi-page scans.
  const stream = client.beta.messages.stream(req as Parameters<typeof client.beta.messages.stream>[0]);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`The model declined to read ${input.name}.`);
  if (msg.stop_reason === 'max_tokens') throw new Error(`Output was cut off for ${input.name}.`);
  const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`The reply for ${input.name} was not valid JSON.`);
  }
  return validateExtracted(parsed);
}

const needsRetry = (d: ExtractedDocument) => d.confidence !== 'high' || d.problems.length > 0;

/**
 * Runs extraction. With haikuFirst, PDFs go to Haiku first and are retried on Sonnet
 * when Haiku reports low/medium confidence, problems, or fails (spec §8).
 */
export async function extract(input: ExtractionInput, s: Settings, client = makeClient(s)): Promise<ExtractionResult> {
  const attempts: ExtractionResult['attempts'] = [];
  if (s.haikuFirst && input.mime === 'application/pdf' && s.model !== HAIKU) {
    try {
      const d = await callOnce(client, input, HAIKU, s);
      if (!needsRetry(d)) {
        attempts.push({ model: HAIKU, outcome: 'ok' });
        return { doc: d, model: HAIKU, attempts };
      }
      attempts.push({ model: HAIKU, outcome: `retrying: ${d.confidence} confidence${d.problems.length ? ', problems reported' : ''}` });
    } catch (e) {
      attempts.push({ model: HAIKU, outcome: `retrying: ${(e as Error).message}` });
    }
  }
  const d = await callOnce(client, input, s.model, s);
  attempts.push({ model: s.model, outcome: 'ok' });
  return { doc: d, model: s.model, attempts };
}
