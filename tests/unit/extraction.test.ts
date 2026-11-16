import { describe, expect, it } from 'vitest';
import { buildRequest, extract, HAIKU, SONNET } from '../../src/extraction/client';
import { validateExtracted } from '../../src/extraction/validate';
import { RECORD_DOCUMENT_SCHEMA } from '../../src/extraction/schema';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { doc } from './helpers';

const input = { name: 'receipt.pdf', mime: 'application/pdf' as const, base64: 'JVBERi0=' };

describe('request', () => {
  it('sends the PDF as a base64 document block before the text', () => {
    const r = buildRequest(input, SONNET, DEFAULT_SETTINGS);
    const content = r.messages[0]!.content;
    expect(content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } });
    expect(content[1]!.type).toBe('text');
  });
  it('sends images as image blocks', () => {
    const r = buildRequest({ ...input, mime: 'image/jpeg' }, SONNET, DEFAULT_SETTINGS);
    expect(r.messages[0]!.content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
  });
  it('uses structured output, no forced tool choice and no temperature', () => {
    const r = buildRequest(input, SONNET, DEFAULT_SETTINGS) as Record<string, unknown>;
    expect(r.output_config).toMatchObject({ format: { type: 'json_schema', schema: RECORD_DOCUMENT_SCHEMA } });
    expect(r).not.toHaveProperty('tool_choice');
    expect(r).not.toHaveProperty('temperature');
  });
  it('enables server-side refusal fallback on Sonnet only', () => {
    expect(buildRequest(input, SONNET, DEFAULT_SETTINGS)).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    expect(buildRequest(input, HAIKU, DEFAULT_SETTINGS)).not.toHaveProperty('fallbacks');
    expect(buildRequest(input, SONNET, { ...DEFAULT_SETTINGS, refusalFallback: false })).not.toHaveProperty('fallbacks');
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
    walk(RECORD_DOCUMENT_SCHEMA);
  });
});

describe('validation', () => {
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

describe('model retry', () => {
  const reply = (d: object) => ({
    stream: () => ({ finalMessage: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(d) }] }) }),
  });
  const fakeClient = (byModel: Record<string, object>) => {
    const calls: string[] = [];
    return {
      calls,
      client: { beta: { messages: { stream: (req: { model: string }) => { calls.push(req.model); return reply(byModel[req.model]!).stream(); } } } } as any,
    };
  };
  it('keeps a confident Haiku result', async () => {
    const f = fakeClient({ [HAIKU]: doc({ doc_type: 'airfare_receipt' }) });
    const r = await extract(input, { ...DEFAULT_SETTINGS, haikuFirst: true }, f.client);
    expect(r.model).toBe(HAIKU);
    expect(f.calls).toEqual([HAIKU]);
  });
  it('retries on Sonnet when Haiku reports low confidence', async () => {
    const f = fakeClient({ [HAIKU]: doc({ doc_type: 'airfare_receipt', confidence: 'low' }), [SONNET]: doc({ doc_type: 'airfare_receipt' }) });
    const r = await extract(input, { ...DEFAULT_SETTINGS, haikuFirst: true }, f.client);
    expect(r.model).toBe(SONNET);
    expect(f.calls).toEqual([HAIKU, SONNET]);
  });
  it('sends images straight to the configured model', async () => {
    const f = fakeClient({ [SONNET]: doc({ doc_type: 'boarding_pass' }) });
    await extract({ ...input, mime: 'image/png' }, { ...DEFAULT_SETTINGS, haikuFirst: true }, f.client);
    expect(f.calls).toEqual([SONNET]);
  });
});
