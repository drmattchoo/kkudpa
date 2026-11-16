import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/rules/planner';
import { applyOverrides } from '../../src/rules/overrides';
import { airfareInvoice, boardingPass, ctx, file, ibisCombined, settings } from './helpers';

const files = [
  file('ibis', ibisCombined(4321.5)),
  file('inv', airfareInvoice()),
  file('bp-out', boardingPass('2026-11-10', 'KKC', 'CNX', '3201', '17:30')),
  file('bp-in', boardingPass('2026-11-13', 'CNX', 'KKC', '3202', '15:20', '16:45')),
  file('merged-signed', airfareInvoice()),
];
const base = () => buildPlan({ files: files.slice(0, 4), ctx: ctx(), existing: [], settings });

describe('review edits', () => {
  it('recomputes the hotel amount from edited nights and rate', () => {
    const p = applyOverrides(base(), { hotel: { nights: 2, ratePerNight: 1500 } }, files, [], ctx(), settings);
    const h = p.lines.find((l) => l.id === 'hotel')!;
    expect(h.amount).toBe(3000);
    expect(h.traces.at(-1)!.source.kind).toBe('user');
  });
  it('choosing one signed merged PDF clears the one-file block for that line', () => {
    const before = base().flags.filter((f) => f.lineId === 'airfare:ABC123' && f.level === 'block');
    expect(before.map((f) => f.rule)).toContain('evidence.one-file');
    const p = applyOverrides(base(), { 'airfare:ABC123': { evidenceFileId: 'merged-signed' } }, files, [], ctx(), settings);
    expect(p.flags.filter((f) => f.lineId === 'airfare:ABC123' && f.level === 'block')).toEqual([]);
    expect(p.lines.find((l) => l.id === 'airfare:ABC123')!.evidenceFileIds).toEqual(['merged-signed']);
  });
  it('re-runs the budget check on edited amounts', () => {
    const p = applyOverrides(base(), { 'airfare:ABC123': { amount: 6000 } }, files, [], ctx(), settings);
    expect(p.flags.some((f) => f.rule === 'budget.category')).toBe(true);
  });
  it('records confirmation', () => {
    const p = applyOverrides(base(), { per_diem: { confirmed: true } }, files, [], ctx(), settings);
    expect(p.lines.find((l) => l.id === 'per_diem')!.confirmed).toBe(true);
  });
});
