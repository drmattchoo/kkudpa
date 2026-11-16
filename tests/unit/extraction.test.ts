import { describe, expect, it } from 'vitest';
import { buildRequest, describeStatus, extract, KKU_GATEWAY, listModels, parseJsonReply } from '../../src/extraction/client';
import { validateExtracted, validateFileReply } from '../../src/extraction/validate';
import { FILE_SCHEMA } from '../../src/extraction/schema';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { doc } from './helpers';

const input = {
  name: 'airfare-signed.pdf',
  pages: [
    { page: 1, imageDataUrl: 'data:image/jpeg;base64,AAA', text: 'TAX INVOICE  Total 4,890.00' },
    { page: 2, imageDataUrl: 'data:image/jpeg;base64,BBB', text: '' },
  ],
};
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-key' };

/** A fake gateway. `handle` gets the parsed body and returns [status, json]. */
function gateway(handle: (body: any) => [number, unknown]) {
  const calls: any[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, headers: init?.headers, body });
    const [status, json] = handle(body);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
const reply = (docs: object[], wrap = (t: string) => t) => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: wrap(JSON.stringify({ documents: docs })) } }] });

describe('request to the KKU gateway', () => {
  it('sends text and page images in OpenAI chat format, with the JSON schema', () => {
    const r: any = buildRequest(input, 'gemini-3.8-flash', { format: 'json_schema', images: true });
    expect(r.model).toBe('gemini-3.8-flash');
    expect(r.messages[0].role).toBe('system');
    const c = r.messages[1].content;
    expect(c.filter((x: any) => x.type === 'image_url').map((x: any) => x.image_url.url)).toEqual(['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB']);
    expect(c.some((x: any) => x.type === 'text' && x.text.includes('Total 4,890.00'))).toBe(true);
    expect(c.some((x: any) => x.type === 'text' && x.text.includes('no text layer'))).toBe(true);
    expect(r.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'record_documents', strict: true, schema: FILE_SCHEMA } });
  });
  it('can leave out images and the response format', () => {
    const r: any = buildRequest(input, 'deepseek-v4.1-flash-maas', { format: 'none', images: false });
    expect(r.messages[1].content.some((x: any) => x.type === 'image_url')).toBe(false);
    expect(r).not.toHaveProperty('response_format');
  });
  it('posts to the gateway with the person\'s own key as a bearer token', async () => {
    const g = gateway(() => [200, reply([doc({ doc_type: 'airfare_receipt' })])]);
    await extract(input, settings, g.f);
    expect(g.calls[0].url).toBe(`${KKU_GATEWAY}/chat/completions`);
    expect(g.calls[0].headers).toEqual({ authorization: 'Bearer test-key', 'content-type': 'application/json' });
  });
  it('asks for a key before calling', async () => {
    await expect(extract(input, { ...settings, apiKey: '' }, gateway(() => [200, {}]).f)).rejects.toThrow(/API key/);
  });
  it('lists models without a key', async () => {
    const g = gateway(() => [200, { object: 'list', data: [{ id: 'gemma4-26b' }, { id: 'gemini-3.8-flash' }] }]);
    expect(await listModels(g.f)).toEqual(['gemma4-26b', 'gemini-3.8-flash']);
  });
  it('schema: every object lists all its properties as required and forbids extras', () => {
    const walk = (s: any) => {
      if (!s || typeof s !== 'object') return;
      if (s.type === 'object') {
        expect(s.additionalProperties).toBe(false);
        expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
      }
      Object.values(s).forEach(walk);
    };
    walk(FILE_SCHEMA);
  });
});

describe('models with fewer features', () => {
  it('steps down from json_schema to json_object to plain text', async () => {
    const g = gateway((b) => {
      if (b.response_format) return [400, { error: { message: `response_format ${b.response_format.type} is not supported` } }];
      return [200, reply([doc({ doc_type: 'hotel_folio' })], (t) => '```json\n' + t + '\n```')];
    });
    const r = await extract(input, settings, g.f);
    expect(g.calls.map((c) => c.body.response_format?.type ?? 'none')).toEqual(['json_schema', 'json_object', 'none']);
    expect(r.docs[0]!.doc_type).toBe('hotel_folio');
  });
  it('drops images for a text-only model and says so on each document', async () => {
    const g = gateway((b) => {
      const hasImage = b.messages[1].content.some((x: any) => x.type === 'image_url');
      return hasImage ? [400, { error: { message: 'This model does not support image input' } }] : [200, reply([doc({ doc_type: 'airfare_receipt' })])];
    });
    const r = await extract(input, { ...settings, model: 'deepseek-v4.1-flash-maas' }, g.f);
    expect(g.calls).toHaveLength(2);
    expect(r.docs[0]!.problems.join()).toMatch(/text layer only/);
    expect(r.docs[0]!.confidence).toBe('high'); // problems are noted; confidence comes from the model
  });
  it('drops temperature when a model rejects it', async () => {
    const g = gateway((b) => ('temperature' in b ? [400, { error: { message: 'Unsupported parameter: temperature' } }] : [200, reply([doc({ doc_type: 'boarding_pass' })])]));
    await extract(input, settings, g.f);
    expect(g.calls.map((c) => 'temperature' in c.body)).toEqual([true, false]);
  });
  it('asks the second-opinion model when the first is unsure', async () => {
    const g = gateway((b) => [200, reply([doc({ doc_type: 'airfare_receipt', confidence: b.model === 'gemma4-26b' ? 'low' : 'high' })])]);
    const r = await extract(input, { ...settings, model: 'gemma4-26b', secondModel: 'gemini-3.8-flash' }, g.f);
    expect(g.calls.map((c) => c.body.model)).toEqual(['gemma4-26b', 'gemini-3.8-flash']);
    expect(r.model).toBe('gemini-3.8-flash');
  });
  it('does not retry another model on a bad key', async () => {
    const g = gateway(() => [401, { error: 'Invalid API key' }]);
    await expect(extract(input, { ...settings, secondModel: 'gemma4-26b' }, g.f)).rejects.toThrow(/own KKU GenAI key/);
    expect(g.calls).toHaveLength(1);
  });
  it('explains quota errors', () => {
    expect(describeStatus(429, '{"error":"Daily token limit exceeded"}')).toMatch(/quota/);
  });
});

describe('reply parsing and validation', () => {
  it('finds the JSON inside fences or prose', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Here it is: {"a":1} done')).toEqual({ a: 1 });
    expect(() => parseJsonReply('no json')).toThrow();
  });
  it('returns every document in a file', () => {
    const docs = validateFileReply({ documents: [doc({ doc_type: 'airfare_receipt' }), doc({ doc_type: 'boarding_pass' }), doc({ doc_type: 'boarding_pass' })] });
    expect(docs.map((d) => d.doc_type)).toEqual(['airfare_receipt', 'boarding_pass', 'boarding_pass']);
    expect(() => validateFileReply({ documents: [] })).toThrow();
    expect(() => validateFileReply({})).toThrow();
  });
  it('converts Buddhist Era dates and flags them', () => {
    const d = validateExtracted({ ...doc({ doc_type: 'hotel_folio' }), receipt_date: '2569-11-13' });
    expect(d.receipt_date).toBe('2026-11-13');
    expect(d.problems.join()).toMatch(/Buddhist Era/);
    expect(d.confidence).toBe('medium');
  });
  it('parses number strings and pads times', () => {
    const raw = { ...doc({ doc_type: 'boarding_pass' }), total_amount: '6,205.04', flight: { carrier: 'FD', flight_no: '3201', booking_ref: 'X', from_iata: 'KKC', to_iata: 'CNX', date: '2026-11-10', boarding_time: '7:30', departure_time: null, arrival_time: null } };
    const d = validateExtracted(raw);
    expect(d.total_amount).toBe(6205.04);
    expect(d.flight!.boarding_time).toBe('07:30');
  });
  it('rejects unknown document types', () => {
    expect(() => validateExtracted({ ...doc({}), doc_type: 'invoice' })).toThrow();
  });
});
