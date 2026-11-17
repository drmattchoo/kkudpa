// Turns extracted documents + DPA trip context into planned claim lines and flags.
// Pure: no DOM, no network. Every number on a line carries a Trace (spec §2 rule 5).

import type { ClaimRow, Flag, IngestedFile, Plan, PlannedLine, PlannedTimes, Settings, TripContext } from '../shared/types';
import { docUnits } from '../shared/types';
import { CATEGORY, ITEM } from '../config/labels';
import { formatMoney, parseBeDateTime, round2 } from '../shared/dates';
import { RULES } from './text';
import { countPerDiemDays, flightLegs, proposeTimes } from './perDiem';
import { planHotel } from './hotel';
import { planAirfare } from './airfare';
import { checkBilledTo, checkBudget, checkEvidence, checkExtraction, findExisting } from './checks';

export interface PlanInput {
  files: IngestedFile[];
  ctx: TripContext;
  existing: ClaimRow[];
  settings: Settings;
  /** Times the user confirmed or edited. When absent, defaults are proposed. */
  times?: PlannedTimes;
  timesConfirmed?: boolean;
}

export function buildPlan(input: PlanInput): Plan {
  const { files, ctx, existing, settings } = input;
  const flags: Flag[] = [];
  const lines: PlannedLine[] = [];

  // Rules work per document; a file can hold several (receipt + boarding passes).
  const units = docUnits(files);
  for (const u of units) flags.push(...checkExtraction(u));

  // Times shared by every line.
  const legs = flightLegs(units);
  const proposed = proposeTimes(legs, ctx, settings);
  const times: PlannedTimes = input.times ?? { depart: proposed.depart, start: proposed.start, end: proposed.end, return: proposed.return };
  const timeTraces = input.times
    ? [{ label: 'times', value: `${times.depart} → ${times.return}`, source: { kind: 'user' as const, note: 'Confirmed in review' } }]
    : [
        legs[0]
          ? { label: 'departure', value: times.depart, source: { kind: 'document' as const, fileId: legs[0].fileId, fileName: legs[0].fileName, page: legs[0].evidencePage, quote: proposed.basis.depart } }
          : { label: 'departure', value: times.depart, source: { kind: 'rule' as const, rule: proposed.basis.depart } },
        legs.length > 1
          ? { label: 'return', value: times.return, source: { kind: 'document' as const, fileId: legs.at(-1)!.fileId, fileName: legs.at(-1)!.fileName, page: legs.at(-1)!.evidencePage, quote: proposed.basis.return } }
          : { label: 'return', value: times.return, source: { kind: 'rule' as const, rule: proposed.basis.return } },
      ];
  // Boarding-pass dates should match DPA's departure and return dates.
  if (!input.times) {
    const off: string[] = [];
    if (proposed.outbound && ctx.departDate && proposed.outbound.date !== ctx.departDate) off.push(`outbound ${proposed.outbound.flightNo} is dated ${proposed.outbound.date}, DPA departure is ${ctx.departDate}`);
    if (proposed.inbound && ctx.returnDate && proposed.inbound.date !== ctx.returnDate) off.push(`return ${proposed.inbound.flightNo} is dated ${proposed.inbound.date}, DPA return is ${ctx.returnDate}`);
    if (legs.length === 1) off.push(`only one boarding pass was found (${legs[0]!.flightNo} on ${legs[0]!.date}), so the return time comes from the DPA date`);
    if (off.length) flags.push({ level: 'warn', rule: RULES.perDiemTimesUnconfirmed.id, message: `Check the times: ${off.join('; ')}.` });
  }
  if (!input.timesConfirmed) {
    flags.push({ level: 'block', rule: RULES.perDiemTimesUnconfirmed.id, message: proposed.fromFlights || input.times ? RULES.perDiemTimesUnconfirmed.text : RULES.perDiemNoFlights.text });
  }

  // Per diem: no evidence file, only the four times.
  let depMs: number | null = null;
  let retMs: number | null = null;
  try {
    depMs = parseBeDateTime(times.depart);
    retMs = parseBeDateTime(times.return);
  } catch (e) {
    flags.push({ level: 'block', rule: RULES.perDiemDays.id, message: (e as Error).message });
  }
  const rate = ctx.traveller?.perDiemRate ?? null;
  if (rate == null) flags.push({ level: 'block', rule: RULES.missingEntitlement.id, message: `${RULES.missingEntitlement.text} อัตราค่าเบี้ยเลี้ยง not found.` });
  if (depMs != null && retMs != null && retMs > depMs && rate != null) {
    const c = countPerDiemDays(depMs, retMs);
    const tripDays = ctx.departDate && ctx.returnDate ? Math.round((Date.parse(ctx.returnDate) - Date.parse(ctx.departDate)) / 86_400_000) : 0;
    const used = [proposed.outbound && `out ${proposed.outbound.flightNo} on ${proposed.outbound.date}`, proposed.inbound && `back ${proposed.inbound.flightNo} on ${proposed.inbound.date}`].filter(Boolean).join(', ');
    if (c.days === 0 && tripDays >= 1) {
      flags.push({ level: 'block', rule: RULES.perDiemDays.id, lineId: 'per_diem', message: `The times give 0 days (${times.depart} → ${times.return}), but DPA has the trip from ${ctx.departDate} to ${ctx.returnDate}. A boarding pass date was probably misread${used ? ` (${used})` : ''}. Correct the times in Review.` });
    } else if (c.totalMinutes < 1440) {
      flags.push({ level: 'info', rule: RULES.perDiemShortTrip.id, message: RULES.perDiemShortTrip.text, lineId: 'per_diem' });
    }
    lines.push({
      id: 'per_diem',
      kind: 'per_diem',
      category: CATEGORY.perDiem,
      item: ITEM.perDiemDomestic,
      times,
      days: c.days,
      ratePerDay: rate,
      amount: round2(c.days * rate),
      note: '',
      evidenceFileIds: [],
      traces: [
        ...timeTraces,
        { label: 'duration', value: `${c.d} d ${c.h} h ${c.m} min → ${c.days} days`, source: { kind: 'rule', rule: RULES.perDiemDays.id } },
        { label: 'rate per day', value: formatMoney(rate), source: { kind: 'dpa', field: 'อัตราค่าเบี้ยเลี้ยง' } },
      ],
      confirmed: false,
    });
  } else if (depMs != null && retMs != null && retMs <= depMs) {
    flags.push({ level: 'block', rule: RULES.perDiemDays.id, message: 'Return time must be after departure time.' });
  }

  // Hotel
  const hotel = planHotel(units, ctx, 'hotel');
  if (hotel) {
    flags.push(...hotel.flags);
    if (hotel.cap) {
      lines.push({
        id: 'hotel',
        kind: 'hotel',
        category: CATEGORY.hotel,
        item: ITEM.hotelDomestic,
        times,
        nights: hotel.cap.nights,
        ratePerNight: hotel.cap.ratePerNight,
        amount: hotel.cap.amount,
        note: hotel.note,
        evidenceFileIds: hotel.evidenceFileIds,
        traces: [...hotel.traces, { label: 'claim = nights × rate per night', value: `${hotel.cap.nights} × ${formatMoney(hotel.cap.ratePerNight)} = ${formatMoney(hotel.cap.amount)}`, source: { kind: 'rule', rule: RULES.hotelCap.id } }],
        confirmed: false,
      });
    }
  }

  // Airfare: one line per booking
  for (const b of planAirfare(units, (ref) => `airfare:${ref}`)) {
    const id = `airfare:${b.bookingRef || 'unknown'}`;
    flags.push(...b.flags);
    if (!b.split) continue;
    const ev = [b.receipt, ...b.boardingPasses].filter((x): x is NonNullable<typeof x> => x != null);
    lines.push({
      id,
      kind: 'airfare',
      category: CATEGORY.vehicle,
      item: ITEM.airfareDomestic,
      times,
      amount: b.split.amount,
      note: b.note,
      evidenceFileIds: [...new Set(ev.map((f) => f.id))],
      traces: b.traces,
      confirmed: false,
    });
  }

  // Per-line evidence, billed-to and DPA duplicate checks.
  for (const l of lines) {
    const ev = l.evidenceFileIds.map((id) => files.find((f) => f.id === id)!).filter(Boolean);
    flags.push(...checkEvidence(ev, l.id));
    for (const u of units.filter((u) => l.evidenceFileIds.includes(u.id))) flags.push(...checkBilledTo(u, settings, l.id));
    const { duplicate, sameItem } = findExisting(l, existing);
    if (duplicate) {
      l.duplicate = true;
      flags.push({ level: 'info', rule: RULES.duplicate.id, message: `${RULES.duplicate.text} ${l.item} ${formatMoney(l.amount)}.`, lineId: l.id });
    } else if (sameItem.length) {
      flags.push({ level: 'warn', rule: RULES.existingDifferent.id, message: `${RULES.existingDifferent.text} DPA has ${sameItem.map((r) => formatMoney(r.amount)).join(', ')}; plan is ${formatMoney(l.amount)}.`, lineId: l.id });
    }
  }

  // Files the plan does not use (e.g. a taxi receipt).
  const used = new Set(lines.flatMap((l) => l.evidenceFileIds));
  for (const f of units) {
    if (f.extracted.doc_type === 'other' && !used.has(f.id)) {
      const taxi = /taxi|แท็กซี่|grab|bolt|รถรับจ้าง/i.test(`${f.extracted.issuer_name} ${f.extracted.line_items.map((i) => i.description).join(' ')}`);
      flags.push({ level: 'info', rule: taxi ? RULES.taxi.id : 'files.unused', message: taxi ? `${RULES.taxi.text} (${f.name})` : `${f.name} was not used for any line.` });
    }
  }

  const budget = checkBudget(lines, existing, ctx);
  flags.push(...budget.flags);

  return { lines, flags, totals: { planned: budget.planned, existing: budget.existing, requested: ctx.estimate.requested } };
}

/** True when nothing blocks filling. */
export function canFill(plan: Plan): boolean {
  return !plan.flags.some((f) => f.level === 'block') && plan.lines.every((l) => l.confirmed || l.duplicate);
}
