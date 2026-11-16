// Checks a parsed reply against the schema's shape. Structured outputs already
// guarantee the shape; this guards against proxies or future model changes and
// normalises small things (number strings, date formats).

import type { ExtractedDocument } from '../shared/types';
import { DOC_TYPES, ITEM_CATEGORIES } from './schema';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const hhmm = /^\d{1,2}:\d{2}$/;

export function validateExtracted(raw: unknown): ExtractedDocument {
  if (!raw || typeof raw !== 'object') throw new Error('Reply is not an object');
  const r = raw as Record<string, any>;
  const problems: string[] = Array.isArray(r.problems) ? r.problems.map(String) : [];

  if (!DOC_TYPES.includes(r.doc_type)) throw new Error(`Unknown doc_type: ${r.doc_type}`);
  const num = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const date = (v: unknown, field: string): string | null => {
    if (v == null || v === '') return null;
    const s = String(v);
    if (!isoDate.test(s)) {
      problems.push(`${field} "${s}" is not YYYY-MM-DD`);
      return null;
    }
    const y = +s.slice(0, 4);
    if (y > 2400) {
      problems.push(`${field} looked like a Buddhist Era year and was converted`);
      return `${y - 543}${s.slice(4)}`;
    }
    return s;
  };
  const time = (v: unknown, field: string): string | null => {
    if (v == null || v === '') return null;
    const s = String(v);
    if (!hhmm.test(s)) {
      problems.push(`${field} "${s}" is not HH:MM`);
      return null;
    }
    return s.padStart(5, '0');
  };

  const f = r.flight;
  const st = r.stay;
  const doc: ExtractedDocument = {
    doc_type: r.doc_type,
    pages: Array.isArray(r.pages) ? r.pages.map(Number).filter(Number.isFinite) : [1],
    issuer_name: String(r.issuer_name ?? ''),
    issuer_tax_id: r.issuer_tax_id ?? null,
    billed_to_name: r.billed_to_name ?? null,
    billed_to_tax_id: r.billed_to_tax_id ?? null,
    receipt_no: r.receipt_no ?? null,
    receipt_date: date(r.receipt_date, 'receipt_date'),
    currency: String(r.currency ?? 'THB'),
    total_amount: num(r.total_amount),
    vat_amount: num(r.vat_amount),
    line_items: Array.isArray(r.line_items)
      ? r.line_items.map((i: any) => ({
          description: String(i.description ?? ''),
          amount: num(i.amount) ?? 0,
          category: ITEM_CATEGORIES.includes(i.category) ? i.category : 'other',
        }))
      : [],
    passenger_or_guest_name: r.passenger_or_guest_name ?? null,
    flight: f
      ? {
          carrier: String(f.carrier ?? ''),
          flight_no: String(f.flight_no ?? ''),
          booking_ref: String(f.booking_ref ?? ''),
          from_iata: String(f.from_iata ?? ''),
          to_iata: String(f.to_iata ?? ''),
          date: date(f.date, 'flight.date') ?? '',
          boarding_time: time(f.boarding_time, 'flight.boarding_time'),
          departure_time: time(f.departure_time, 'flight.departure_time'),
          arrival_time: time(f.arrival_time, 'flight.arrival_time'),
        }
      : null,
    stay: st
      ? {
          check_in: date(st.check_in, 'stay.check_in') ?? '',
          check_out: date(st.check_out, 'stay.check_out') ?? '',
          nights: Number.isInteger(st.nights) ? st.nights : Number(st.nights) || 0,
          room_no: st.room_no ?? null,
        }
      : null,
    handwritten_notes: r.handwritten_notes ?? null,
    evidence: Array.isArray(r.evidence)
      ? r.evidence.map((e: any) => ({ field: String(e.field ?? ''), page: Number(e.page) || 1, quote: String(e.quote ?? '') }))
      : [],
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'low',
    problems,
  };
  if (doc.problems.length && doc.confidence === 'high') doc.confidence = 'medium';
  return doc;
}
