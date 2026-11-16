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

/** Fixes common JSON slips: trailing commas, raw line breaks inside strings. */
export function repairJson(t: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      else if (ch === '\n') { out += '\\n'; continue; }
      else if (ch === '\r') continue;
      else if (ch === '\t') { out += '\\t'; continue; }
    } else if (ch === '"') inStr = true;
    out += ch;
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}

/** Pulls the JSON object out of a reply that may carry code fences or prose. */
export function parseJsonReply(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  const candidates = [t, a >= 0 && b > a ? t.slice(a, b + 1) : null].filter((x): x is string => !!x);
  let first: Error | null = null;
  for (const c of candidates) {
    for (const v of [c, repairJson(c)]) {
      try {
        return JSON.parse(v);
      } catch (e) {
        first ??= e as Error;
      }
    }
  }
  const cut = looksCut(t);
  throw new BadReplyError(cut ? `The reply was cut off after ${text.length} characters` : `The reply was not valid JSON (${first?.message ?? 'no JSON found'})`, text, cut);
}

/** An unterminated reply: more opening than closing brackets, or ends mid-value. */
function looksCut(t: string): boolean {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const ch of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth > 0 || inStr;
}

export class BadReplyError extends Error {
  constructor(message: string, readonly reply: string, readonly cut: boolean) {
    super(message);
  }
}

/** Thrown when every attempt failed. `details` is shown on the file card for diagnosis. */
export class ExtractionError extends Error {
  constructor(message: string, readonly details: string) {
    super(message);
  }
}

const CUT_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'MAX_TOKENS']);

interface Reply { text: string; finish: string }

async function post(f: Fetch, s: Settings, body: unknown): Promise<Reply> {
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
  const content = choice?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: any) => c?.text ?? '').join('') : '';
  const finish = String(choice?.finish_reason ?? '');
  if (!text) throw new Error(`The model returned an empty reply${finish ? ` (finish_reason ${finish})` : ''}`);
  return { text, finish };
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

type Log = ExtractionResult['attempts'];
const short = (t: string) => (t.length > 160 ? `…${t.slice(-160)}` : t);

/** Asks the model once to turn a broken reply into valid JSON. */
async function repairWithModel(f: Fetch, s: Settings, model: string, broken: string): Promise<unknown> {
  const { text } = await post(f, s, {
    model,
    max_tokens: 16000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You fix malformed JSON. Return the same data as one valid JSON object and nothing else. Do not add, drop or change any value.' },
      { role: 'user', content: broken },
    ],
  });
  return parseJsonReply(text);
}

/**
 * One request for the given pages with one model. Steps down response format, drops
 * temperature or images when the model rejects them, and repairs bad JSON.
 * Throws BadReplyError with cut=true when the reply was cut off.
 */
async function readPages(f: Fetch, input: ExtractionInput, model: string, s: Settings, log: Log, state: { images: boolean; temperature: boolean; fi: number }): Promise<ExtractedDocument[]> {
  const formats: ResponseFormat[] = ['json_schema', 'json_object', 'none'];
  const scope = input.pages.length === 1 ? `page ${input.pages[0]!.page}` : `${input.pages.length} pages`;
  for (;;) {
    const format = formats[state.fi]!;
    let reply: Reply | null = null;
    try {
      reply = await post(f, s, buildRequest(input, model, { format, images: state.images, temperature: state.temperature }));
      if (CUT_REASONS.has(reply.finish)) throw new BadReplyError(`The reply was cut off (finish_reason ${reply.finish}, ${reply.text.length} characters)`, reply.text, true);
      let parsed: unknown;
      try {
        parsed = parseJsonReply(reply.text);
      } catch (e) {
        if ((e as BadReplyError).cut) throw e;
        log.push({ model, outcome: `${scope}: ${(e as Error).message}; asking the model to fix it. Reply ended: ${short(reply.text)}` });
        parsed = await repairWithModel(f, s, model, reply.text);
      }
      const docs = validateFileReply(parsed);
      log.push({ model, outcome: `${scope}: ok (${format}, ${state.images ? 'images' : 'text only'}, finish ${reply.finish || '—'})` });
      return docs;
    } catch (e) {
      const status = e instanceof GatewayError ? e.status : 0;
      const body = e instanceof GatewayError ? e.body : '';
      if (e instanceof BadReplyError && e.cut) {
        log.push({ model, outcome: `${scope}: ${e.message}. Reply ended: ${short(e.reply)}` });
        throw e;
      }
      if (status === 400 || status === 422) {
        if (state.temperature && /temperature/i.test(body)) {
          state.temperature = false;
          continue;
        }
        if (state.images && IMAGE_REJECTED.test(body) && !FORMAT_REJECTED.test(body)) {
          state.images = false;
          log.push({ model, outcome: 'model does not take images; retrying with the text layer' });
          continue;
        }
        if (state.fi < formats.length - 1) {
          state.fi++;
          log.push({ model, outcome: `${format} not supported (${short(body)}); retrying` });
          continue;
        }
      }
      if (!status && state.fi < formats.length - 1 && !(e instanceof GatewayError)) {
        log.push({ model, outcome: `${scope}: ${(e as Error).message}; retrying with ${formats[state.fi + 1]}` });
        state.fi++;
        continue;
      }
      log.push({ model, outcome: `${scope}: failed: ${(e as Error).message}` });
      throw e;
    }
  }
}

/**
 * Joins documents read page by page: a page that continues the previous document
 * (same type, same or no receipt number) is merged into it.
 */
export function mergePageDocs(docs: ExtractedDocument[]): ExtractedDocument[] {
  const out: ExtractedDocument[] = [];
  for (const d of docs) {
    const prev = out.at(-1);
    const continues =
      prev &&
      prev.doc_type === d.doc_type &&
      d.doc_type !== 'boarding_pass' &&
      (!d.receipt_no || !prev.receipt_no || d.receipt_no === prev.receipt_no) &&
      (!d.issuer_name || !prev.issuer_name || d.issuer_name === prev.issuer_name);
    if (!continues) {
      out.push({ ...d, pages: [...d.pages], line_items: [...d.line_items], evidence: [...d.evidence], problems: [...d.problems] });
      continue;
    }
    const pick = <K extends keyof ExtractedDocument>(k: K) => (d[k] ?? prev[k]) as ExtractedDocument[K];
    for (const k of ['issuer_tax_id', 'billed_to_name', 'billed_to_tax_id', 'receipt_no', 'receipt_date', 'total_amount', 'vat_amount', 'passenger_or_guest_name', 'flight', 'stay', 'handwritten_notes'] as const) {
      (prev as any)[k] = pick(k);
    }
    prev.pages = [...new Set([...prev.pages, ...d.pages])];
    prev.line_items.push(...d.line_items);
    prev.evidence.push(...d.evidence);
    prev.problems.push(...d.problems);
    if (d.confidence === 'low' || (d.confidence === 'medium' && prev.confidence === 'high')) prev.confidence = d.confidence;
  }
  return out;
}

/** One model: the whole file in one request; page by page if the reply is cut off. */
async function readWithModel(f: Fetch, input: ExtractionInput, model: string, s: Settings, log: Log): Promise<ExtractedDocument[]> {
  const state = { images: s.sendImages && input.pages.some((p) => p.imageDataUrl), temperature: true, fi: 0 };
  const note = (docs: ExtractedDocument[]) => {
    if (!state.images && s.sendImages) for (const d of docs) d.problems.push('Read from the PDF text layer only: this model does not take page images.');
    return docs;
  };
  try {
    return note(await readPages(f, input, model, s, log, state));
  } catch (e) {
    if (!(e instanceof BadReplyError && e.cut) || input.pages.length === 1) throw e;
  }
  log.push({ model, outcome: 'reply too long for one request; reading page by page' });
  const all: ExtractedDocument[] = [];
  for (const p of input.pages) {
    const docs = await readPages(f, { name: input.name, pages: [p] }, model, s, log, state);
    for (const d of docs) d.pages = [p.page];
    all.push(...docs);
  }
  return note(mergePageDocs(all));
}

const unsure = (docs: ExtractedDocument[]) => docs.some((d) => d.confidence !== 'high' || d.problems.length > 0);

/**
 * Reads one file with the chosen model. When a second-opinion model is set and the
 * first is unsure or fails, the file is read again with it (spec §8 retry idea).
 */
export async function extract(input: ExtractionInput, s: Settings, f: Fetch = fetch.bind(globalThis)): Promise<ExtractionResult> {
  const attempts: ExtractionResult['attempts'] = [];
  const second = s.secondModel && s.secondModel !== s.model ? s.secondModel : null;
  const fail = (e: unknown): never => {
    const details = attempts.map((a) => `${a.model}: ${a.outcome}`).join('\n');
    throw new ExtractionError((e as Error).message, details);
  };
  try {
    const docs = await readWithModel(f, input, s.model, s, attempts);
    if (!second || !unsure(docs)) return { docs, model: s.model, attempts };
    attempts.push({ model: s.model, outcome: 'unsure; asking the second model' });
  } catch (e) {
    if (!second || (e as GatewayError).status === 401) fail(e);
  }
  try {
    const docs = await readWithModel(f, input, second!, s, attempts);
    return { docs, model: second!, attempts };
  } catch (e) {
    return fail(e);
  }
}

/** Model ids from the gateway (no key needed for the list). */
export async function listModels(f: Fetch = fetch.bind(globalThis)): Promise<string[]> {
  const res = await f(`${KKU_GATEWAY}/models`);
  if (!res.ok) throw new Error(`Could not list models (${res.status})`);
  const data = await res.json();
  return (data?.data ?? []).map((m: { id: string }) => m.id).filter(Boolean);
}
