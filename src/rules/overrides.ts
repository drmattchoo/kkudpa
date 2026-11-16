// Applies the person's edits from the review screen to a plan and re-runs the checks
// those edits affect (evidence, billed-to, budget). Pure.

import type { ClaimRow, Flag, IngestedFile, Plan, PlannedLine, Settings, TripContext } from '../shared/types';
import { docUnits } from '../shared/types';
import { round2, formatMoney } from '../shared/dates';
import { checkBilledTo, checkBudget, checkEvidence, findExisting } from './checks';
import { RULES } from './text';

export interface LineOverride {
  amount?: number;
  nights?: number;
  ratePerNight?: number;
  note?: string;
  /** The single PDF to upload for this line, e.g. the signed merged file. */
  evidenceFileId?: string;
  confirmed?: boolean;
}

const EVIDENCE_RULES = new Set<string>([RULES.oneFilePerLine.id, RULES.pdfOnly.id, RULES.unsigned.id, RULES.modifiedAfterSigning.id, RULES.billedTo.id, RULES.duplicate.id, RULES.existingDifferent.id]);
const BUDGET_RULES = new Set<string>([RULES.budgetTotal.id, RULES.budgetCategory.id, RULES.budgetNoEstimate.id]);

export function applyOverrides(
  plan: Plan,
  overrides: Record<string, LineOverride>,
  files: IngestedFile[],
  existing: ClaimRow[],
  ctx: TripContext,
  settings: Settings,
): Plan {
  const touched = new Set<string>();
  const lines: PlannedLine[] = plan.lines.map((l) => {
    const o = overrides[l.id];
    if (!o) return l;
    const n: PlannedLine = { ...l, traces: [...l.traces] };
    if (l.kind === 'hotel' && (o.nights != null || o.ratePerNight != null)) {
      n.nights = o.nights ?? l.nights;
      n.ratePerNight = o.ratePerNight ?? l.ratePerNight;
      n.amount = round2((n.nights ?? 0) * (n.ratePerNight ?? 0));
      n.traces.push({ label: 'edited in review', value: `${n.nights} × ${formatMoney(n.ratePerNight)} = ${formatMoney(n.amount)}`, source: { kind: 'user', note: 'Changed by the person' } });
    }
    if (l.kind === 'airfare' && o.amount != null) {
      n.amount = round2(o.amount);
      n.traces.push({ label: 'edited in review', value: formatMoney(n.amount), source: { kind: 'user', note: 'Changed by the person' } });
    }
    if (o.note != null) n.note = o.note;
    if (o.evidenceFileId) {
      n.evidenceFileIds = [o.evidenceFileId];
      touched.add(l.id);
    }
    if (o.confirmed != null) n.confirmed = o.confirmed;
    if (n.amount !== l.amount) touched.add(l.id);
    return n;
  });

  let flags: Flag[] = plan.flags.filter((f) => !(f.lineId && touched.has(f.lineId) && EVIDENCE_RULES.has(f.rule)) && !BUDGET_RULES.has(f.rule));
  for (const l of lines) {
    if (!touched.has(l.id)) continue;
    const ev = l.evidenceFileIds.map((id) => files.find((f) => f.id === id)).filter((f): f is IngestedFile => !!f);
    flags.push(...checkEvidence(ev, l.id));
    for (const u of docUnits(ev)) flags.push(...checkBilledTo(u, settings, l.id));
    const { duplicate, sameItem } = findExisting(l, existing);
    l.duplicate = !!duplicate;
    if (duplicate) flags.push({ level: 'info', rule: RULES.duplicate.id, message: `${RULES.duplicate.text} ${l.item} ${formatMoney(l.amount)}.`, lineId: l.id });
    else if (sameItem.length) flags.push({ level: 'warn', rule: RULES.existingDifferent.id, message: `${RULES.existingDifferent.text} DPA has ${sameItem.map((r) => formatMoney(r.amount)).join(', ')}; plan is ${formatMoney(l.amount)}.`, lineId: l.id });
  }
  // A line whose evidence is now one signed PDF no longer needs the merge flag.
  flags = flags.filter((f) => !(f.rule === RULES.oneFilePerLine.id && f.lineId && lines.find((l) => l.id === f.lineId)?.evidenceFileIds.length === 1));
  const budget = checkBudget(lines, existing, ctx);
  flags.push(...budget.flags);
  return { lines, flags, totals: { planned: budget.planned, existing: budget.existing, requested: ctx.estimate.requested } };
}
