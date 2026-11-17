import type { DocUnit, ExtractedDocument, Flag, Trace } from '../shared/types';
import { round2, formatMoney } from '../shared/dates';
import { RULES } from './text';
import { docTrace } from './hotel';

export interface AirfareSplit {
  amount: number;
  included: { description: string; amount: number }[];
  excluded: { description: string; amount: number }[];
  itemised: boolean;
}

// Extras that are never claimable, whatever the line also says.
const ADDON = [
  /seat|ที่นั่ง/i, /baggage|\bbag\b|luggage|กระเป๋า|สัมภาระ|น้ำหนัก/i, /insurance|ประกัน/i, /meal|อาหาร/i,
  /priority|fast ?track|lounge/i, /sport|equipment/i, /change fee|เปลี่ยนแปลง|เปลี่ยนเที่ยวบิน/i,
];
// The ticket itself. Airline receipts often word it "ค่าตั๋วโดยสารและ/หรือค่าธรรมเนียมอื่นๆ"
// (fare and/or other charges): that is the fare, so naming the fare wins over "fee".
const FARE = [/fare|ticket|ค่าตั๋ว|ตั๋วโดยสาร|ค่าโดยสาร|ค่าบัตรโดยสาร|fuel|surcharge/i];
const TAX = [/airport tax|passenger service charge|\bpsc\b|ภาษีสนามบิน|ค่าธรรมเนียมสนามบิน|ค่าบริการผู้โดยสาร/i];
// Fees that are add-ons when nothing on the line names the fare.
const FEE = [/convenience|processing|service fee|booking fee|payment fee|transaction fee|ค่าธรรมเนียม/i];

const has = (ps: RegExp[], t: string) => ps.some((p) => p.test(t));

/** Is a receipt line claimable? Exported for tests. */
export function isClaimableAirfareItem(description: string, category: string): boolean {
  if (has(TAX, description)) return true;
  if (has(ADDON, description)) return false;
  if (has(FARE, description)) return true;
  if (has(FEE, description)) return false;
  return category === 'fare' || category === 'airport_tax';
}

/**
 * Only the fare and airport tax are claimable (spec §4). The wording on the receipt
 * decides first; the reader's category is used when the wording says neither.
 */
export function splitAirfare(doc: ExtractedDocument): AirfareSplit {
  const items = doc.line_items ?? [];
  if (items.length === 0) {
    return { amount: round2(doc.total_amount ?? 0), included: [{ description: 'Total (not itemised)', amount: doc.total_amount ?? 0 }], excluded: [], itemised: false };
  }
  const included: AirfareSplit['included'] = [];
  const excluded: AirfareSplit['excluded'] = [];
  for (const it of items) {
    (isClaimableAirfareItem(it.description, it.category) ? included : excluded).push({ description: it.description, amount: it.amount });
  }
  return { amount: round2(included.reduce((s, i) => s + i.amount, 0)), included, excluded, itemised: true };
}

type F = Pick<DocUnit, 'id' | 'name' | 'extracted' | 'mime'>;

export interface AirfareBooking {
  bookingRef: string;
  receipt: F | null;
  boardingPasses: F[];
  split: AirfareSplit | null;
  traces: Trace[];
  flags: Flag[];
  note: string;
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '').toUpperCase();

/** Group airfare receipts and boarding passes by booking reference: one claim line per booking. */
export function planAirfare(files: F[], lineIdFor: (ref: string) => string): AirfareBooking[] {
  const receipts = files.filter((f) => f.extracted?.doc_type === 'airfare_receipt');
  const passes = files.filter((f) => f.extracted?.doc_type === 'boarding_pass');
  const refs = new Set<string>();
  const refOf = (f: F) => norm(f.extracted?.flight?.booking_ref) || norm(f.extracted?.receipt_no);
  receipts.forEach((r) => refs.add(refOf(r)));
  passes.forEach((p) => refs.add(norm(p.extracted?.flight?.booking_ref)));
  // One receipt and passes that share one booking ref (or none): treat as one booking,
  // since receipts often print a receipt number rather than the PNR.
  const passRefs = new Set(passes.map((p) => norm(p.extracted?.flight?.booking_ref)).filter(Boolean));
  const singleBooking = receipts.length === 1 && passRefs.size <= 1;
  if (singleBooking) {
    refs.clear();
    refs.add([...passRefs][0] ?? refOf(receipts[0]!));
  }

  const out: AirfareBooking[] = [];
  for (const ref of refs) {
    const lineId = lineIdFor(ref || 'unknown');
    const receipt = singleBooking ? receipts[0]! : (receipts.find((r) => refOf(r) === ref) ?? null);
    const bps = singleBooking ? passes : passes.filter((p) => norm(p.extracted?.flight?.booking_ref) === ref);
    const flags: Flag[] = [];
    const traces: Trace[] = [];
    const flag = (level: Flag['level'], rule: { id: string; text: string }, extra = '') =>
      flags.push({ level, rule: rule.id, message: extra ? `${rule.text} ${extra}` : rule.text, lineId });

    if (!receipt) flag('block', RULES.airfareDocs, `No receipt for booking ${ref || '(no reference)'}.`);
    if (bps.length === 0) flag('block', RULES.airfareDocs, `No boarding pass for booking ${ref || '(no reference)'}.`);

    let split: AirfareSplit | null = null;
    if (receipt?.extracted) {
      split = splitAirfare(receipt.extracted);
      if (!split.itemised) flag('warn', RULES.airfareNoItemisation);
      if (split.excluded.length) {
        flag('info', RULES.airfareAddons, `Not claimed: ${split.excluded.map((e) => `${e.description} ${formatMoney(e.amount)}`).join('; ')}.`);
      }
      for (const inc of split.included) {
        traces.push({ ...docTrace(inc.description, formatMoney(inc.amount), receipt, ['line_items', 'total_amount']), label: `claimable: ${inc.description}` });
      }
      if (!receipt.extracted.billed_to_tax_id) flag('info', RULES.airfareTaxInvoice);
    }
    const flightNos = bps.map((b) => `${b.extracted?.flight?.carrier ?? ''}${b.extracted?.flight?.flight_no ?? ''}`).filter(Boolean);
    const note = [ref && `Booking ${ref}`, flightNos.length && flightNos.join(', ')].filter(Boolean).join(' · ');
    out.push({ bookingRef: ref, receipt, boardingPasses: bps, split, traces, flags, note });
  }
  return out;
}
