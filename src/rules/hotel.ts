import type { ExtractedDocument, Flag, IngestedFile, Trace, TripContext } from '../shared/types';
import { round2, formatMoney, isoToNaive, HOUR } from '../shared/dates';
import { RULES } from './text';

export interface HotelCap {
  nights: number;
  entitlementRate: number;
  receiptTotal: number;
  cap: number;
  /** rate per night to type into อัตราต่อคืน */
  ratePerNight: number;
  /** nights × ratePerNight, what DPA will compute */
  amount: number;
  capped: boolean;
  /** text the receipt must carry when capped */
  capNote: string | null;
}

/**
 * Claim at most nights × entitlement rate (spec §4). Below the cap, the claim is the
 * receipt divided evenly over the nights, rounded to satang.
 */
export function hotelCap(nights: number, entitlementRate: number, receiptTotal: number): HotelCap {
  if (!(nights > 0)) throw new Error('Nights must be at least 1');
  if (!(entitlementRate > 0)) throw new Error('Entitlement rate must be positive');
  if (!(receiptTotal > 0)) throw new Error('Receipt total must be positive');
  const cap = round2(nights * entitlementRate);
  const capped = receiptTotal > cap;
  const ratePerNight = capped ? entitlementRate : round2(receiptTotal / nights);
  const amount = round2(nights * ratePerNight);
  return {
    nights,
    entitlementRate,
    receiptTotal,
    cap,
    ratePerNight,
    amount,
    capped,
    capNote: capped ? `เบิกจ่ายเพียง ${formatMoney(cap)} บาท` : null,
  };
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((isoToNaive(checkOut) - isoToNaive(checkIn)) / (24 * HOUR));
}

type F = Pick<IngestedFile, 'id' | 'name' | 'extracted'>;

export interface HotelDocs {
  receipt: F | null;
  folio: F | null;
  /** files to attach, receipt first */
  evidence: F[];
}

/** Pick the hotel receipt and folio from the extracted files. */
export function findHotelDocs(files: F[]): HotelDocs {
  const combined = files.find((f) => f.extracted?.doc_type === 'hotel_receipt_and_folio') ?? null;
  if (combined) return { receipt: combined, folio: combined, evidence: [combined] };
  const receipt = files.find((f) => f.extracted?.doc_type === 'hotel_receipt') ?? null;
  const folio = files.find((f) => f.extracted?.doc_type === 'hotel_folio') ?? null;
  return { receipt, folio, evidence: [receipt, folio].filter((x): x is F => x != null) };
}

export interface HotelPlan {
  cap: HotelCap | null;
  nights: number | null;
  traces: Trace[];
  flags: Flag[];
  evidenceFileIds: string[];
  note: string;
}

export function planHotel(files: F[], ctx: TripContext, lineId: string): HotelPlan | null {
  const docs = findHotelDocs(files);
  if (!docs.receipt && !docs.folio) return null;
  const flags: Flag[] = [];
  const traces: Trace[] = [];
  const flag = (level: Flag['level'], rule: { id: string; text: string }, extra = '') =>
    flags.push({ level, rule: rule.id, message: extra ? `${rule.text} ${extra}` : rule.text, lineId });

  if (!docs.receipt || !docs.folio) {
    flag('block', RULES.hotelNeedsFolio, docs.receipt ? 'The folio is missing.' : 'The receipt is missing.');
  }

  const stayDoc = (docs.folio ?? docs.receipt)!;
  const stay = stayDoc.extracted?.stay ?? docs.receipt?.extracted?.stay ?? null;
  let nights: number | null = stay?.nights ?? null;
  if (stay?.check_in && stay?.check_out) {
    const byDates = nightsBetween(stay.check_in, stay.check_out);
    if (nights == null) nights = byDates;
    else if (nights !== byDates) flag('warn', RULES.hotelNightsMismatch, `Folio says ${nights}, dates give ${byDates}.`);
    if (ctx.departDate && ctx.returnDate) {
      const inTrip = stay.check_in >= addDays(ctx.departDate, -1) && stay.check_out <= addDays(ctx.returnDate, 1);
      if (!inTrip) flag('warn', RULES.hotelNightsMismatch, `Stay ${stay.check_in} to ${stay.check_out} is outside the trip ${ctx.departDate} to ${ctx.returnDate}.`);
    }
  }
  if (nights != null) {
    traces.push(docTrace('nights', String(nights), stayDoc, ['stay.nights', 'nights', 'stay']));
  }

  const rate = ctx.traveller?.roomRate ?? null;
  if (rate == null) flag('block', RULES.missingEntitlement, 'อัตราค่าห้องพัก not found.');
  else traces.push({ label: 'entitlement rate per night', value: formatMoney(rate), source: { kind: 'dpa', field: 'อัตราค่าห้องพัก' } });

  const total = docs.receipt?.extracted?.total_amount ?? null;
  if (docs.receipt && total != null) {
    traces.push(docTrace('receipt total', formatMoney(total), docs.receipt, ['total_amount']));
  }

  let cap: HotelCap | null = null;
  let note = '';
  if (nights && rate && total) {
    cap = hotelCap(nights, rate, total);
    traces.push({ label: 'cap = nights × rate', value: formatMoney(cap.cap), source: { kind: 'rule', rule: RULES.hotelCap.id } });
    if (cap.capped) {
      const onReceipt = /เบิกจ่ายเพียง/.test(docs.receipt?.extracted?.handwritten_notes ?? '');
      flag(
        onReceipt ? 'info' : 'warn',
        RULES.hotelCap,
        `Receipt ${formatMoney(total)} is over the cap. Claiming ${formatMoney(cap.cap)}. ` +
          (onReceipt ? 'The receipt already carries a เบิกจ่ายเพียง note; check the amount.' : `Write "${cap.capNote}" on the receipt before signing.`),
      );
      note = cap.capNote!;
    } else if (cap.amount !== total) {
      flag('info', RULES.hotelRounding, `Claim ${formatMoney(cap.amount)} vs receipt ${formatMoney(total)}.`);
    }
  }

  return { cap, nights, traces, flags, evidenceFileIds: docs.evidence.map((f) => f.id), note };
}

function addDays(iso: string, n: number): string {
  const t = isoToNaive(iso) + n * 24 * HOUR;
  return new Date(t).toISOString().slice(0, 10);
}

export function docTrace(label: string, value: string, f: F, fields: string[]): Trace {
  const x = f.extracted as ExtractedDocument;
  const ev = x.evidence.find((e) => fields.includes(e.field)) ?? x.evidence.find((e) => fields.some((k) => e.field.startsWith(k)));
  return {
    label,
    value,
    source: { kind: 'document', fileId: f.id, fileName: f.name, page: ev?.page ?? x.pages[0] ?? 1, quote: ev?.quote ?? '(no quote returned)' },
  };
}
