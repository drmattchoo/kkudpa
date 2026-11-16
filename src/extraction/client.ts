// Extraction through the KKU GenAI gateway (KKU IntelSphere), which speaks the
// OpenAI chat-completions protocol at https://gen.ai.kku.ac.th/api/v1. Each person
// uses their own key. One request per file.
//
// The gateway takes no PDF uploads, so the side panel renders each page to an image
// and reads its text layer (src/extraction/pages.ts); the signed file itself is never
// changed. Text goes with the images so text-only models can still read born-digital
// PDFs. Not every model behind the gateway supports images or JSON schemas, so the
// client steps down: json_schema → json_object → plain text, and images → text only.

import type { ExtractedDocument, Settings } from '../shared/types';
import { FILE_SCHEMA } from './schema';
import { EXTRACTION_SYSTEM, extractionUserText } from './prompt';
import { validateFileReply } from './validate';

export const KKU_GATEWAY = 'https://gen.ai.kku.ac.th/api/v1';
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export interface PageInput {
  /** 1-based */
  page: number;
  /** data:image/jpeg;base64,... or null when only text is sent */
  imageDataUrl: string | null;
  text: string;
}

export interface ExtractionInput {
  name: string;
  pages: PageInput[];
}

export interface ExtractionResult {
  docs: ExtractedDocument[];
  model: string;
  attempts: { model: string; outcome: string }[];
}

type Fetch = typeof fetch;
type ResponseFormat = 'json_schema' | 'json_object' | 'none';

export class GatewayError extends Error {
  constructor(message: string, readonly status: number, readonly body: string) {
    super(message);
  }
}

/** Builds the chat-completions body. Exported for tests. */
export function buildRequest(input: ExtractionInput, model: string, opts: { format: ResponseFormat; images: boolean; temperature?: boolean }) {
  const content: unknown[] = [{ type: 'text', text: extractionUserText(input.name, input.pages.length) }];
  for (const p of input.pages) {
    const text = p.text.trim();
    content.push({ type: 'text', text: `--- Page ${p.page} ---${text ? `\nText layer:\n${text}` : '\n(no text layer: read the image)'}` });
    if (opts.images && p.imageDataUrl) content.push({ type: 'image_url', image_url: { url: p.imageDataUrl } });
  }
  const body: Record<string, unknown> = {
    model,
    ...(opts.temperature === false ? {} : { temperature: 0 }),
    max_tokens: 16000,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM },
      { role: 'user', content },
    ],
  };
  if (opts.format === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: 'record_documents', strict: true, schema: FILE_SCHEMA } };
  else if (opts.format === 'json_object') body.response_format = { type: 'json_object' };
  return body;
}

/** Pulls the JSON object out of a reply that may carry code fences or prose. */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('The reply was not JSON');
  }
}

async function post(f: Fetch, s: Settings, body: unknown): Promise<string> {
  if (!s.apiKey) throw new Error('Enter your KKU GenAI API key in Settings.');
  const res = await f(`${KKU_GATEWAY}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${s.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) throw new GatewayError(describeStatus(res.status, raw), res.status, raw);
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new GatewayError('The gateway returned something that is not JSON', res.status, raw.slice(0, 300));
  }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('The reply was cut off. Try a file with fewer pages.');
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: any) => c?.text ?? '').join('') : '';
  if (!text) throw new Error('The model returned an empty reply');
  return text;
}

export function describeStatus(status: number, body: string): string {
  const msg = (() => {
    try {
      const j = JSON.parse(body);
      return j?.error?.message ?? (typeof j?.error === 'string' ? j.error : '') ?? '';
    } catch {
      return body.slice(0, 200);
    }
  })();
  if (status === 401) return 'The API key was rejected. Check it in Settings (each person uses their own KKU GenAI key).';
  if (status === 429) return `Daily token quota or rate limit reached for this model. Try another model in Settings, or wait for the daily reset. ${msg}`.trim();
  if (status === 413) return 'The file is too large for one request. Lower the page image size in Settings.';
  return `Gateway error ${status}${msg ? `: ${msg}` : ''}`;
}

// A 400 that names one of these means the model or gateway does not support the feature.
const FORMAT_REJECTED = /response_format|json_schema|json_object|structured|schema/i;
const IMAGE_REJECTED = /image|vision|multimodal|image_url|content type|modalit/i;

/** One model: steps down response format and drops images when the model rejects them. */
async function readWithModel(f: Fetch, input: ExtractionInput, model: string, s: Settings, attempts: ExtractionResult['attempts']): Promise<ExtractedDocument[]> {
  const formats: ResponseFormat[] = ['json_schema', 'json_object', 'none'];
  let images = s.sendImages && input.pages.some((p) => p.imageDataUrl);
  let temperature = true;
  let fi = 0;
  for (;;) {
    const format = formats[fi]!;
    try {
      const text = await post(f, s, buildRequest(input, model, { format, images, temperature }));
      const docs = validateFileReply(parseJsonReply(text));
      if (!images && s.sendImages) for (const d of docs) d.problems.push('Read from the PDF text layer only: this model does not take page images.');
      attempts.push({ model, outcome: `ok (${format}${images ? ', images' : ', text only'})` });
      return docs;
    } catch (e) {
      const err = e as Error;
      const status = e instanceof GatewayError ? e.status : 0;
      const body = e instanceof GatewayError ? e.body : '';
      if (status === 400 || status === 422) {
        if (temperature && /temperature/i.test(body)) {
          temperature = false;
          continue;
        }
        if (images && IMAGE_REJECTED.test(body) && !FORMAT_REJECTED.test(body)) {
          images = false;
          attempts.push({ model, outcome: 'model does not take images; retrying with the text layer' });
          continue;
        }
        if (fi < formats.length - 1) {
          fi++;
          attempts.push({ model, outcome: `${format} not supported; retrying` });
          continue;
        }
      }
      // Valid HTTP reply but unusable JSON: plain text mode may still help.
      if (!status && /JSON|documents|doc_type/.test(err.message) && fi < formats.length - 1) {
        fi++;
        attempts.push({ model, outcome: `${err.message}; retrying` });
        continue;
      }
      throw err;
    }
  }
}

const unsure = (docs: ExtractedDocument[]) => docs.some((d) => d.confidence !== 'high' || d.problems.length > 0);

/**
 * Reads one file with the chosen model. When a second-opinion model is set and the
 * first is unsure or fails, the file is read again with it (spec §8 retry idea).
 */
export async function extract(input: ExtractionInput, s: Settings, f: Fetch = fetch.bind(globalThis)): Promise<ExtractionResult> {
  const attempts: ExtractionResult['attempts'] = [];
  const second = s.secondModel && s.secondModel !== s.model ? s.secondModel : null;
  try {
    const docs = await readWithModel(f, input, s.model, s, attempts);
    if (!second || !unsure(docs)) return { docs, model: s.model, attempts };
    attempts.push({ model: s.model, outcome: 'unsure; asking the second model' });
  } catch (e) {
    if (!second || (e as GatewayError).status === 401) throw e;
    attempts.push({ model: s.model, outcome: `failed: ${(e as Error).message}` });
  }
  const docs = await readWithModel(f, input, second!, s, attempts);
  return { docs, model: second!, attempts };
}

/** Model ids from the gateway (no key needed for the list). */
export async function listModels(f: Fetch = fetch.bind(globalThis)): Promise<string[]> {
  const res = await f(`${KKU_GATEWAY}/models`);
  if (!res.ok) throw new Error(`Could not list models (${res.status})`);
  const data = await res.json();
  return (data?.data ?? []).map((m: { id: string }) => m.id).filter(Boolean);
}
