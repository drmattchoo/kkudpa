import type { ClaimRow, Flag, IngestedFile, PlannedLine, Settings, TripContext } from '../shared/types';
import { ITEM } from '../config/labels';
import { formatMoney, round2 } from '../shared/dates';
import { RULES } from './text';

type Cat = 'perDiem' | 'hotel' | 'vehicle' | 'other';

export function itemCategory(item: string): Cat {
  if (item.includes('เบี้ยเลี้ยง')) return 'perDiem';
  if (item.includes('ที่พัก')) return 'hotel';
  if (item.includes('พาหนะ') || item.includes('เครื่องบิน') || item === ITEM.airfareDomestic) return 'vehicle';
  return 'other';
}

const CAT_NAME: Record<Cat, string> = { perDiem: '1. ค่าเบี้ยเลี้ยง', hotel: '2. ค่าที่พัก', vehicle: '3. ค่าพาหนะ', other: '4. อื่นๆ' };

/** Same item and same amount (to the satang) counts as a duplicate (spec §2 rule 4). */
export function findExisting(line: Pick<PlannedLine, 'item' | 'amount'>, rows: ClaimRow[]): { duplicate: ClaimRow | null; sameItem: ClaimRow[] } {
  const sameItem = rows.filter((r) => r.item.trim() === line.item.trim());
  const duplicate = sameItem.find((r) => r.amount != null && Math.abs(r.amount - line.amount) < 0.005) ?? null;
  return { duplicate, sameItem };
}

/**
 * Budget (spec §4): compare per-category and total claims (existing DPA lines plus
 * new lines that are not duplicates) with the approved estimate.
 */
export function checkBudget(lines: PlannedLine[], rows: ClaimRow[], ctx: TripContext): { flags: Flag[]; planned: number; existing: number } {
  const flags: Flag[] = [];
  const sums: Record<Cat, number> = { perDiem: 0, hotel: 0, vehicle: 0, other: 0 };
  let existing = 0;
  for (const r of rows) {
    if (r.amount == null) continue;
    sums[itemCategory(r.item)] += r.amount;
    existing += r.amount;
  }
  let planned = 0;
  for (const l of lines) {
    if (l.duplicate) continue;
    sums[itemCategory(l.item)] += l.amount;
    planned += l.amount;
  }
  const est = ctx.estimate;
  for (const cat of Object.keys(sums) as Cat[]) {
    const sum = round2(sums[cat]);
    if (sum <= 0) continue;
    const approved = est[cat];
    if (approved == null || approved <= 0) {
      flags.push({ level: 'warn', rule: RULES.budgetNoEstimate.id, message: `${RULES.budgetNoEstimate.text} ${CAT_NAME[cat]}: claiming ${formatMoney(sum)}.` });
    } else if (sum > approved + 0.005) {
      flags.push({ level: 'warn', rule: RULES.budgetCategory.id, message: `${RULES.budgetCategory.text} ${CAT_NAME[cat]}: ${formatMoney(sum)} vs approved ${formatMoney(approved)}.` });
    }
  }
  const total = round2(existing + planned);
  if (est.requested != null && total > est.requested + 0.005) {
    flags.push({ level: 'warn', rule: RULES.budgetTotal.id, message: `${RULES.budgetTotal.text} ${formatMoney(total)} vs ${formatMoney(est.requested)}.` });
  }
  return { flags, planned: round2(planned), existing: round2(existing) };
}

const UNIVERSITY = [/มหาวิทยาลัยขอนแก่น/, /khon\s*kaen\s*university/i, /\bKKU\b/];

/** Receipts should be in the unit's name and tax ID (spec §4). */
export function checkBilledTo(f: Pick<IngestedFile, 'name' | 'extracted'>, s: Settings, lineId?: string): Flag[] {
  const x = f.extracted;
  if (!x || !['airfare_receipt', 'hotel_receipt', 'hotel_receipt_and_folio'].includes(x.doc_type)) return [];
  const name = x.billed_to_name ?? '';
  const unitOk = UNIVERSITY.some((p) => p.test(name)) || (s.unitName && name.includes(s.unitName));
  const taxOk = !s.unitTaxId || (x.billed_to_tax_id ?? '').replace(/\D/g, '') === s.unitTaxId.replace(/\D/g, '');
  if (unitOk && taxOk) return [];
  const why = !name ? 'No billed-to name was found.' : !unitOk ? `Billed to "${name}".` : `Tax ID ${x.billed_to_tax_id ?? '(none)'} is not ${s.unitTaxId}.`;
  return [{ level: 'warn', rule: RULES.billedTo.id, message: `${RULES.billedTo.text} ${f.name}: ${why}`, lineId }];
}

/** Evidence must be one signed PDF per line. */
export function checkEvidence(files: IngestedFile[], lineId: string): Flag[] {
  const flags: Flag[] = [];
  if (files.length > 1) {
    flags.push({ level: 'block', rule: RULES.oneFilePerLine.id, message: `${RULES.oneFilePerLine.text} Files: ${files.map((f) => f.name).join(', ')}.`, lineId });
  }
  for (const f of files) {
    if (f.mime !== 'application/pdf') {
      flags.push({ level: 'block', rule: RULES.pdfOnly.id, message: `${RULES.pdfOnly.text} (${f.name})`, lineId });
      continue;
    }
    if (files.length > 1) continue; // will be merged and re-signed anyway
    if (f.signature && !f.signature.signed) {
      flags.push({ level: 'warn', rule: RULES.unsigned.id, message: `${RULES.unsigned.text} ${f.name} has no signature.`, lineId });
    }
    const last = f.signature?.signatures.at(-1);
    if (last && !last.coversWholeFile) {
      flags.push({ level: 'warn', rule: RULES.modifiedAfterSigning.id, message: `${RULES.modifiedAfterSigning.text} (${f.name})`, lineId });
    }
  }
  return flags;
}

export function checkExtraction(f: IngestedFile): Flag[] {
  const x = f.extracted;
  if (!x) return [];
  if (x.confidence === 'low' || x.problems.length) {
    return [{ level: x.confidence === 'low' ? 'warn' : 'info', rule: RULES.extraction.id, message: `${RULES.extraction.text} ${f.name}${x.problems.length ? ': ' + x.problems.join('; ') : ''}` }];
  }
  return [];
}
