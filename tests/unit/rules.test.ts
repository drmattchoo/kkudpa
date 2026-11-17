import { describe, expect, it } from 'vitest';
import { countPerDiemDays, flightLegs, proposeTimes } from '../../src/rules/perDiem';
import { hotelCap, planHotel } from '../../src/rules/hotel';
import { splitAirfare, planAirfare, isClaimableAirfareItem } from '../../src/rules/airfare';
import { checkBudget, checkBilledTo, checkEvidence, findExisting } from '../../src/rules/checks';
import { buildPlan, canFill } from '../../src/rules/planner';
import { parseBeDateTime } from '../../src/shared/dates';
import { airfareInvoice, boardingPass, ctx, doc, file, ibisCombined, settings } from './helpers';
import type { ClaimRow, PlannedLine } from '../../src/shared/types';

const t = parseBeDateTime;

describe('per diem day counting', () => {
  it('matches DPA on the recorded trip: 10-11 15:30 to 13-11 18:00 is 3 d 2 h 30 min, 3 days', () => {
    const c = countPerDiemDays(t('10-11-2569 15:30'), t('13-11-2569 18:00'));
    expect(c).toMatchObject({ d: 3, h: 2, m: 30, days: 3 });
  });
  it('counts a remainder over 12 hours as one more day', () => {
    expect(countPerDiemDays(t('10-11-2569 06:00'), t('12-11-2569 18:01')).days).toBe(3);
  });
  it('does not count a remainder of exactly 12 hours', () => {
    expect(countPerDiemDays(t('10-11-2569 06:00'), t('12-11-2569 18:00')).days).toBe(2);
  });
  it('exact multiples of 24 hours', () => {
    expect(countPerDiemDays(t('10-11-2569 08:00'), t('11-11-2569 08:00')).days).toBe(1);
  });
  it('a day trip over 12 hours is one day, 12 hours or less is zero', () => {
    expect(countPerDiemDays(t('10-11-2569 06:00'), t('10-11-2569 18:30')).days).toBe(1);
    expect(countPerDiemDays(t('10-11-2569 06:00'), t('10-11-2569 17:00')).days).toBe(0);
  });
  it('crosses month and year boundaries', () => {
    expect(countPerDiemDays(t('30-12-2569 20:00'), t('02-01-2570 09:00')).days).toBe(3);
  });
  it('rejects return before departure', () => {
    expect(() => countPerDiemDays(t('13-11-2569 18:00'), t('10-11-2569 15:30'))).toThrow();
  });
  it('rejects CE years in DPA date-times', () => {
    expect(() => t('10-11-2026 15:30')).toThrow(/Buddhist Era/);
  });
});

describe('per diem default times', () => {
  const files = [
    file('bp-out', boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30')),
    file('bp-in', boardingPass('2026-11-13', 'CNX', 'KKC', '3202', '15:20', '16:45')),
  ];
  it('departure = outbound boarding − 2 h, return = inbound arrival + 1 h', () => {
    const p = proposeTimes(flightLegs(files), ctx(), settings);
    expect(p.depart).toBe('10-11-2569 15:30');
    expect(p.return).toBe('13-11-2569 17:45');
    expect(p.fromFlights).toBe(true);
  });
  it('uses boarding + default flight time + 1 h when arrival is not printed', () => {
    const f2 = [files[0]!, file('bp-in', boardingPass('2026-11-13', 'CNX', 'KKC', '3202', '15:20'))];
    expect(proposeTimes(flightLegs(f2), ctx(), settings).return).toBe('13-11-2569 17:35');
  });
  it('offsets are settings', () => {
    const p = proposeTimes(flightLegs(files), ctx(), { ...settings, departOffsetMin: -180, returnOffsetMin: 90 });
    expect(p.depart).toBe('10-11-2569 14:30');
    expect(p.return).toBe('13-11-2569 18:15');
  });
  it('keeps work end no later than return', () => {
    const p = proposeTimes(flightLegs(files), ctx(), { ...settings, workEndTime: '20:00' });
    expect(p.end).toBe(p.return);
  });
  it('falls back to DPA trip dates without boarding passes', () => {
    const p = proposeTimes([], ctx(), settings);
    expect(p.fromFlights).toBe(false);
    expect(p.depart).toBe('10-11-2569 08:30');
    expect(p.return).toBe('13-11-2569 16:30');
  });
});

describe('hotel cap', () => {
  it('claims the receipt when under nights × rate', () => {
    expect(hotelCap(3, 1500, 4500)).toMatchObject({ capped: false, ratePerNight: 1500, amount: 4500, capNote: null });
  });
  it('caps at nights × rate and produces the เบิกจ่ายเพียง note', () => {
    const c = hotelCap(3, 1500, 6205.04);
    expect(c).toMatchObject({ capped: true, cap: 4500, amount: 4500, ratePerNight: 1500 });
    expect(c.capNote).toBe('เบิกจ่ายเพียง 4,500.00 บาท');
  });
  it('splits an uneven receipt per night, rounded to satang', () => {
    const c = hotelCap(3, 1500, 4321.5);
    expect(c.ratePerNight).toBe(1440.5);
    expect(c.amount).toBe(4321.5);
    const c2 = hotelCap(3, 1500, 4000);
    expect(c2.ratePerNight).toBe(1333.33);
    expect(c2.amount).toBe(3999.99);
  });
  it('rejects nonsense', () => {
    expect(() => hotelCap(0, 1500, 100)).toThrow();
    expect(() => hotelCap(1, 1500, 0)).toThrow();
  });
  it('blocks when the folio is missing', () => {
    const r = file('r', { ...ibisCombined(), doc_type: 'hotel_receipt' });
    const p = planHotel([r], ctx(), 'hotel')!;
    expect(p.flags.some((f) => f.level === 'block' && f.rule === 'hotel.receipt-and-folio')).toBe(true);
  });
  it('warns when the folio nights disagree with the dates', () => {
    const p = planHotel([file('h', ibisCombined(4500, 2))], ctx(), 'hotel')!;
    expect(p.flags.some((f) => f.rule === 'hotel.nights')).toBe(true);
  });
  it('says the note is already on the receipt when it is', () => {
    const d = { ...ibisCombined(6205.04), handwritten_notes: 'เบิกจ่ายเพียง 4,500 บาท' };
    const p = planHotel([file('h', d)], ctx(), 'hotel')!;
    expect(p.flags.find((f) => f.rule === 'hotel.cap')?.level).toBe('info');
  });
});

describe('airfare line items', () => {
  it('claims fare and airport tax only', () => {
    const s = splitAirfare(airfareInvoice());
    expect(s.amount).toBe(4180); // 3380 + 200 + 600
    expect(s.excluded.map((e) => e.description)).toEqual(['Seat selection', 'Checked baggage 20kg', 'Processing fee']);
  });
  it('catches add-ons the reader filed as fare', () => {
    const d = doc({ doc_type: 'airfare_receipt', line_items: [
      { description: 'Fare', amount: 1000, category: 'fare' },
      { description: 'Travel insurance', amount: 100, category: 'fare' },
      { description: 'ค่าธรรมเนียมสนามบิน', amount: 100, category: 'airport_tax' },
    ] });
    expect(splitAirfare(d).amount).toBe(1100);
  });
  it('claims a Thai airline line that names the fare and "other charges" (real receipt wording)', () => {
    const d = doc({ doc_type: 'airfare_receipt', line_items: [
      { description: 'ค่าตั๋วโดยสารและ/หรือค่าธรรมเนียมอื่นๆ (QZ7K2P) FD3442 CNX-KKC', amount: 1385.38, category: 'addon' },
      { description: 'ค่าธรรมเนียมการชำระเงิน', amount: 50, category: 'other' },
      { description: 'น้ำหนักสัมภาระ 20 กก.', amount: 400, category: 'fare' },
      { description: 'ค่าบริการผู้โดยสารขาออก (ภาษีสนามบิน)', amount: 100, category: 'other' },
    ] });
    const s = splitAirfare(d);
    expect(s.included.map((i) => i.amount)).toEqual([1385.38, 100]);
    expect(s.excluded.map((i) => i.amount)).toEqual([50, 400]);
  });
  it.each([
    ['Base fare', 'fare', true], ['Fuel surcharge', 'other', true], ['Airport tax', 'other', true],
    ['Seat selection', 'fare', false], ['Travel insurance', 'fare', false], ['Processing fee', 'fare', false],
    ['ค่าตั๋วโดยสาร', 'other', true], ['เลือกที่นั่ง', 'fare', false], ['Something unlabelled', 'fare', true], ['Something unlabelled', 'other', false],
  ])('%s (%s) claimable: %s', (desc, cat, want) => {
    expect(isClaimableAirfareItem(desc as string, cat as string)).toBe(want);
  });
  it('uses the total and warns when not itemised', () => {
    const d = doc({ doc_type: 'airfare_receipt', total_amount: 2500 });
    expect(splitAirfare(d)).toMatchObject({ amount: 2500, itemised: false });
  });
  it('groups receipt and boarding passes into one booking', () => {
    const files = [file('inv', airfareInvoice()), file('o', boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30')), file('i', boardingPass('2026-11-13', 'CNX', 'KKC', '3202', '15:20'))];
    const b = planAirfare(files, (r) => r);
    expect(b).toHaveLength(1);
    expect(b[0]!.boardingPasses).toHaveLength(2);
    expect(b[0]!.flags.filter((f) => f.level === 'block')).toHaveLength(0);
  });
  it('blocks a booking with no boarding pass', () => {
    const b = planAirfare([file('inv', airfareInvoice())], (r) => r);
    expect(b[0]!.flags.some((f) => f.level === 'block')).toBe(true);
  });
  it('reminds about a tax invoice when the receipt has no billed-to tax ID', () => {
    const b = planAirfare([file('inv', { ...airfareInvoice(), billed_to_tax_id: null }), file('o', boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30'))], (r) => r);
    expect(b[0]!.flags.some((f) => f.rule === 'airfare.tax-invoice')).toBe(true);
  });
});

describe('budget check', () => {
  const line = (item: string, amount: number): PlannedLine => ({ id: item, kind: 'hotel', category: '', item, times: { depart: '', start: '', end: '', return: '' }, amount, note: '', evidenceFileIds: [], traces: [], confirmed: true });
  it('passes within estimate', () => {
    expect(checkBudget([line('ค่าที่พักเดินทางในประเทศ', 4500)], [], ctx()).flags).toHaveLength(0);
  });
  it('flags a category overrun', () => {
    const r = checkBudget([line('ค่าเบี้ยเลี้ยงเดินทางในประเทศ', 1200)], [], ctx());
    expect(r.flags.map((f) => f.rule)).toEqual(['budget.category']);
  });
  it('flags a category with no approved estimate', () => {
    const r = checkBudget([line('ค่าบัตรโดยสารเครื่องบินในประเทศ', 100)], [], ctx({ estimate: { perDiem: 960, hotel: 4500, vehicle: 0, other: 0, requested: 10000 } }));
    expect(r.flags.map((f) => f.rule)).toEqual(['budget.no-estimate']);
  });
  it('flags a total overrun, counting existing DPA lines', () => {
    const existing: ClaimRow[] = [{ name: '', item: 'ค่าที่พักเดินทางในประเทศ', evidence: '', signedBy: '', days: null, nights: 3, amount: 4500, times: '' }];
    const r = checkBudget([line('ค่าบัตรโดยสารเครื่องบินในประเทศ', 4540)], existing, ctx({ estimate: { perDiem: 960, hotel: 4500, vehicle: 4540, other: 0, requested: 9000 } }));
    expect(r.flags.map((f) => f.rule)).toEqual(['budget.total']);
  });
  it('does not count duplicates twice', () => {
    const existing: ClaimRow[] = [{ name: '', item: 'ค่าที่พักเดินทางในประเทศ', evidence: '', signedBy: '', days: null, nights: 3, amount: 4500, times: '' }];
    const l = { ...line('ค่าที่พักเดินทางในประเทศ', 4500), duplicate: true };
    expect(checkBudget([l], existing, ctx()).flags).toHaveLength(0);
  });
});

describe('receipts and evidence', () => {
  it('flags a receipt in a personal name', () => {
    const f = file('h', { ...ibisCombined(), billed_to_name: 'Mr Test Traveller' });
    expect(checkBilledTo(f, settings)).toHaveLength(1);
  });
  it('accepts the university in Thai or English', () => {
    expect(checkBilledTo(file('h', ibisCombined()), settings)).toHaveLength(0);
    expect(checkBilledTo(file('a', airfareInvoice()), settings)).toHaveLength(0);
  });
  it('checks the unit tax ID when configured', () => {
    expect(checkBilledTo(file('h', ibisCombined()), { ...settings, unitTaxId: '1234567890123' })).toHaveLength(1);
  });
  it('blocks more than one evidence file and non-PDF evidence', () => {
    const a = file('a', ibisCombined());
    const b = file('b', ibisCombined(), { mime: 'image/jpeg' });
    const rules = checkEvidence([a, b], 'x').map((f) => f.rule);
    expect(rules).toContain('evidence.one-file');
    expect(rules).toContain('evidence.pdf-only');
  });
  it('warns on unsigned and modified-after-signing PDFs', () => {
    const u = file('u', ibisCombined(), { signature: { signed: false, signatures: [] } });
    const m = file('m', ibisCombined(), { signature: { signed: true, signatures: [{ signerName: 'X', signingTime: null, coversWholeFile: false }] } });
    expect(checkEvidence([u], 'x').map((f) => f.rule)).toEqual(['evidence.signed']);
    expect(checkEvidence([m], 'x').map((f) => f.rule)).toEqual(['evidence.modified']);
  });
});

describe('de-duplication', () => {
  const rows: ClaimRow[] = [{ name: '', item: 'ค่าที่พักเดินทางในประเทศ', evidence: '', signedBy: '', days: null, nights: 3, amount: 4500, times: '' }];
  it('same item and amount is a duplicate', () => {
    expect(findExisting({ item: 'ค่าที่พักเดินทางในประเทศ', amount: 4500 }, rows).duplicate).not.toBeNull();
  });
  it('same item, different amount is not a duplicate but is reported', () => {
    const r = findExisting({ item: 'ค่าที่พักเดินทางในประเทศ', amount: 4321.5 }, rows);
    expect(r.duplicate).toBeNull();
    expect(r.sameItem).toHaveLength(1);
  });
});

describe('planner end to end', () => {
  const files = [
    file('ibis', ibisCombined(6205.04)),
    file('inv', airfareInvoice()),
    file('bp-out', boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30')),
    file('bp-in', boardingPass('2026-11-13', 'CNX', 'KKC', '3202', '15:20', '16:45')),
  ];
  it('proposes per diem, hotel and airfare lines with traces', () => {
    const plan = buildPlan({ files, ctx: ctx(), existing: [], settings });
    const byId = Object.fromEntries(plan.lines.map((l) => [l.id, l]));
    expect(Object.keys(byId).sort()).toEqual(['airfare:ABC123', 'hotel', 'per_diem']);
    expect(byId.per_diem).toMatchObject({ days: 3, ratePerDay: 240, amount: 720, evidenceFileIds: [] });
    expect(byId.hotel).toMatchObject({ nights: 3, ratePerNight: 1500, amount: 4500, note: 'เบิกจ่ายเพียง 4,500.00 บาท', evidenceFileIds: ['ibis'] });
    expect(byId['airfare:ABC123']).toMatchObject({ amount: 4180 });
    for (const l of plan.lines) expect(l.traces.length).toBeGreaterThan(0);
  });
  it('blocks until the times are confirmed, and blocks airfare until its files are one PDF', () => {
    const plan = buildPlan({ files, ctx: ctx(), existing: [], settings });
    const blocks = plan.flags.filter((f) => f.level === 'block').map((f) => f.rule);
    expect(blocks).toContain('per-diem.times-unconfirmed');
    expect(blocks).toContain('evidence.one-file');
    expect(canFill(plan)).toBe(false);
  });
  it('skips lines already in DPA', () => {
    const existing: ClaimRow[] = [
      { name: '', item: 'ค่าเบี้ยเลี้ยงเดินทางในประเทศ', evidence: '', signedBy: '', days: 3, nights: null, amount: 720, times: '' },
      { name: '', item: 'ค่าที่พักเดินทางในประเทศ', evidence: '', signedBy: '', days: null, nights: 3, amount: 4500, times: '' },
    ];
    const plan = buildPlan({ files, ctx: ctx(), existing, settings });
    expect(plan.lines.filter((l) => l.duplicate).map((l) => l.id).sort()).toEqual(['hotel', 'per_diem']);
  });
  it('uses confirmed times', () => {
    const times = { depart: '10-11-2569 15:00', start: '11-11-2569 08:30', end: '13-11-2569 12:00', return: '13-11-2569 18:00' };
    const plan = buildPlan({ files: [], ctx: ctx(), existing: [], settings, times, timesConfirmed: true });
    expect(plan.lines[0]).toMatchObject({ id: 'per_diem', days: 3, times });
    expect(plan.flags.filter((f) => f.level === 'block')).toHaveLength(0);
  });
});

describe('one signed file per claim line', () => {
  // What the person actually adds: one signed PDF per line, each holding several documents.
  const airfareBundle = file('airfare-signed', [
    airfareInvoice(),
    boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30'),
    boardingPass('2026-11-13', 'CNX', 'KKC', '3202', '15:20', '16:45'),
  ]);
  const hotelBundle = file('hotel-signed', [
    { ...ibisCombined(4321.5), doc_type: 'hotel_receipt' as const, stay: null },
    { ...ibisCombined(4321.5), doc_type: 'hotel_folio' as const, total_amount: null },
  ]);

  it('takes the per diem times from both boarding passes inside the airfare file', () => {
    const plan = buildPlan({ files: [airfareBundle, hotelBundle], ctx: ctx(), existing: [], settings });
    const pd = plan.lines.find((l) => l.id === 'per_diem')!;
    expect(pd.times.depart).toBe('10-11-2569 15:30');
    expect(pd.times.return).toBe('13-11-2569 17:45');
  });
  it('uses each signed file, as is, as the evidence for its line, with nothing to fix', () => {
    const plan = buildPlan({ files: [airfareBundle, hotelBundle], ctx: ctx(), existing: [], settings, timesConfirmed: true });
    const byId = Object.fromEntries(plan.lines.map((l) => [l.id, l]));
    expect(byId['airfare:ABC123']!.evidenceFileIds).toEqual(['airfare-signed']);
    expect(byId['airfare:ABC123']!.amount).toBe(4180);
    expect(byId.hotel!.evidenceFileIds).toEqual(['hotel-signed']);
    expect(byId.hotel!.amount).toBe(4321.5);
    expect(plan.flags.filter((f) => f.level === 'block')).toEqual([]);
  });
  it('blocks a line whose file is not signed', () => {
    const unsigned = { ...hotelBundle, signature: { signed: false, signatures: [] } };
    const plan = buildPlan({ files: [airfareBundle, unsigned], ctx: ctx(), existing: [], settings, timesConfirmed: true });
    expect(plan.flags.filter((f) => f.level === 'block').map((f) => [f.lineId, f.rule])).toEqual([['hotel', 'evidence.signed']]);
  });
  it('blocks a line whose documents are spread over two files', () => {
    const r = file('r', { ...ibisCombined(), doc_type: 'hotel_receipt' });
    const fo = file('fo', { ...ibisCombined(), doc_type: 'hotel_folio' });
    const plan = buildPlan({ files: [r, fo], ctx: ctx(), existing: [], settings, timesConfirmed: true });
    expect(plan.flags.some((f) => f.lineId === 'hotel' && f.rule === 'evidence.one-file' && f.level === 'block')).toBe(true);
  });
});

describe('per diem sanity', () => {
  it('blocks 0 days when DPA says the trip spans several days, naming the flights', () => {
    // Inbound pass misread with the outbound date
    const files = [file('a', [airfareInvoice(), boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '07:30'), boardingPass('2026-11-10', 'CNX', 'KKC', '3442', '10:20', '11:45')])];
    const plan = buildPlan({ files, ctx: ctx(), existing: [], settings, timesConfirmed: true });
    const f = plan.flags.find((x) => x.lineId === 'per_diem' && x.level === 'block');
    expect(f?.message).toMatch(/0 days[\s\S]*FD3442 on 2026-11-10/);
  });
  it('warns when boarding-pass dates differ from DPA dates', () => {
    const files = [file('a', [airfareInvoice(), boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30'), boardingPass('2026-11-14', 'CNX', 'KKC', '3442', '15:20', '16:45')])];
    const plan = buildPlan({ files, ctx: ctx(), existing: [], settings });
    expect(plan.flags.some((x) => x.level === 'warn' && /return FD3442 is dated 2026-11-14/.test(x.message))).toBe(true);
  });
});
