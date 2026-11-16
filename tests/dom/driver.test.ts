// DOM tests: the real content-script bundle against anonymised saves of the DPA trip
// form, with tests/dom/k2-sim.js standing in for K2's runtime. Run: npm run test:dom
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Browser, Page } from 'playwright';
import type { PlannedLine } from '../../src/shared/types';

// Playwright is pre-installed globally in the dev container; resolve it from there.
const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');

const root = path.resolve(__dirname, '../..');
const bundle = path.join(root, 'tests/.build/content.js');
const sim = path.join(root, 'tests/dom/k2-sim.js');
const fixture = (n: string) => 'file://' + path.join(root, 'tests/fixtures/dpa', n);
const signedPdf = fs.readFileSync(path.join(root, 'tests/fixtures/pdf/signed.pdf'));

let browser: Browser;
let page: Page;

beforeAll(async () => {
  if (!fs.existsSync(bundle)) throw new Error('Run "npm run build:driver-test" first (npm run test:dom does it).');
  browser = await chromium.launch();
});
afterAll(async () => browser?.close());

async function open(name: string) {
  if (page && !page.isClosed()) await page.close();
  page = await browser.newPage();
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && !f.url().endsWith(name)) console.warn('navigated to', f.url()); });
  await page.goto(fixture(name));
  await page.addScriptTag({ path: sim });
  await page.addScriptTag({ path: bundle });
}

const line = (over: Partial<PlannedLine>): PlannedLine => ({
  id: 'x',
  kind: 'per_diem',
  category: 'ค่าเบี้ยเลี้ยง',
  item: 'ค่าเบี้ยเลี้ยงเดินทางในประเทศ',
  times: { depart: '10-11-2569 06:00', start: '11-11-2569 08:30', end: '13-11-2569 16:30', return: '13-11-2569 19:00' },
  amount: 960,
  days: 4,
  ratePerDay: 240,
  note: '',
  evidenceFileIds: [],
  traces: [],
  confirmed: true,
  ...over,
});

async function fill(l: PlannedLine, opts: { add: boolean; evidence?: boolean; attachAutoTimeout?: number; manualAttachTimeout?: number } ) {
  return page.evaluate(
    async ({ l, opts, pdf }) => {
      const w = window as any;
      const evidence = opts.evidence ? { bytes: new Uint8Array(pdf), filename: 'hotel-signed.pdf' } : undefined;
      return w.__kkuDpa.fillLine(l, { add: opts.add, evidence, attachAutoTimeout: opts.attachAutoTimeout, manualAttachTimeout: opts.manualAttachTimeout, signedByTimeout: 5000 });
    },
    { l, opts, pdf: [...signedPdf] },
  );
}

describe.each(['vehicle-dropdown-open.html', 'hotel.html', 'perdiem.html'])('self-test on %s', (name) => {
  it('finds every label, grid and the file input', async () => {
    await open(name);
    const items = await page.evaluate(() => (window as any).__kkuDpa.selfTest());
    expect(items.filter((i: any) => !i.ok)).toEqual([]);
    await page.close();
  });
});

describe('reading the trip form', () => {
  beforeEach(() => open('hotel.html'));

  it('reads trip context, entitlements, estimate and finance notes', async () => {
    const ctx = await page.evaluate(() => (window as any).__kkuDpa.readTripContext());
    expect(ctx).toMatchObject({
      tripNo: 'TRIP20260000001',
      departDate: '2026-11-10',
      startDate: '2026-11-11',
      endDate: '2026-11-13',
      returnDate: '2026-11-13',
      province: 'เชียงใหม่',
      estimate: { perDiem: 960, hotel: 4500, vehicle: 4540, other: 0, requested: 10000 },
      traveller: { entitlement: 'แพทย์', perDiemRate: 240, roomType: 'ห้องพักเดี่ยว', roomRate: 1500 },
      summaryClaimed: 5220,
    });
    expect(ctx.financeNotes.length).toBeGreaterThan(0);
    expect(ctx.financeNotes[0].comment).toMatch(/หลักฐาน/);
    expect(ctx.financeNotes[0].comment).not.toMatch(/<|&nbsp;/);
  });

  it('reads the existing claim table', async () => {
    const rows = await page.evaluate(() => (window as any).__kkuDpa.readClaimTable());
    expect(rows.map((r: any) => [r.item, r.amount, r.days, r.nights])).toEqual([
      ['ค่าเบี้ยเลี้ยงเดินทางในประเทศ', 720, 3, null],
      ['ค่าที่พักเดินทางในประเทศ', 4500, null, 3],
    ]);
    expect(rows[1].signedBy).toBeTruthy();
    expect(rows[0].times).toMatch(/10-11-2569 15:30/);
  });
});

describe('deny and allow lists', () => {
  beforeEach(() => open('hotel.html'));
  it.each(['ส่งเอกสารขออนุมัติเบิกจ่าย', 'บันทึกเอกสาร', 'ส่งอนุมัติ', 'ส่งเอกสารคำร้อง', 'ส่งให้ผู้ขอแก้ไขเอกสาร', 'ยกเลิกการเดินทาง', 'ไม่เบิกจ่ายงบประมาณที่ขอ', 'ลบรายการขอเบิก', 'พิมพ์เอกสาร'])('refuses to press %s', async (text) => {
    const err = await page.evaluate((t) => {
      const w = window as any;
      const b = [...document.querySelectorAll('a.SourceCode-Forms-Controls-Web-Button')].find((a) => a.textContent!.trim() === t)!;
      try {
        w.__kkuDpa.dom.userClick(b);
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    }, text);
    expect(err).toMatch(/Refusing/);
    expect(await page.evaluate(() => (window as any).__sim.clicks)).toEqual([]);
  });
});

describe('controls', () => {
  it('selects the airfare item from the K2 dropdown', async () => {
    await open('vehicle-dropdown-open.html');
    const r = await page.evaluate(async () => {
      const k2 = (window as any).__kkuDpa.k2;
      await k2.selectRadio('หมวดรายการที่เบิก', 'ค่ายานพาหนะ');
      const opts = await k2.listDropdownOptions('รายการที่เบิก');
      await k2.selectDropdown('รายการที่เบิก', 'ค่าบัตรโดยสารเครื่องบินในประเทศ');
      return { opts, now: k2.readDropdown('รายการที่เบิก') };
    });
    expect(r.opts).toEqual(['ค่าพาหนะเดินทางในประเทศ', 'ค่าบัตรโดยสารเครื่องบินในประเทศ']);
    expect(r.now).toBe('ค่าบัตรโดยสารเครื่องบินในประเทศ');
  });
});

describe('filling a line', () => {
  beforeEach(() => open('hotel.html'));

  it('per diem dry run: types the four times, no file, reads DPA days and amount, does not add', async () => {
    const r = await fill(line({}), { add: false });
    expect(r.status).toBe('filled');
    expect(r.computed).toBe(960);
    expect(r.steps.find((s: any) => s.step === 'DPA per diem days').ok).toBe(true);
    expect(r.attachMode).toBeUndefined();
    expect(await page.evaluate(() => (window as any).__sim.clicks)).toEqual([]);
  });

  it('skips a line that is already in the table', async () => {
    const r = await fill(line({ amount: 720 }), { add: true });
    expect(r.status).toBe('skipped-duplicate');
    expect(await page.evaluate(() => (window as any).__sim.clicks)).toEqual([]);
  });

  it('hotel: nights and rate, attaches the exact signed bytes, adds the line, sees SIGNED BY', async () => {
    const l = line({ id: 'hotel', kind: 'hotel', category: 'ค่าที่พัก', item: 'ค่าที่พักเดินทางในประเทศ', nights: 2, ratePerNight: 1400, amount: 2800, evidenceFileIds: ['f'], note: 'เบิกจ่ายเพียง 2,800.00 บาท' });
    const r = await fill(l, { add: true, evidence: true });
    expect(r.status, JSON.stringify(r.steps)).toBe('added');
    expect(r.attachMode).toBe('auto');
    expect(r.signedBy).toBe('Test Signer');
    const uploaded = await page.evaluate(() => (window as any).__sim.uploaded);
    const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');
    expect(uploaded.name).toBe('hotel-signed.pdf');
    expect(sha(Uint8Array.from(uploaded.bytes))).toBe(sha(signedPdf));
    expect(await page.evaluate(() => (window as any).__sim.clicks)).toEqual(['เพิ่มรายการขอเบิก']);
    const rows = await page.evaluate(() => (window as any).__kkuDpa.readClaimTable());
    expect(rows).toHaveLength(3);
  });

  it('airfare: types the amount and adds the line', async () => {
    const l = line({ id: 'airfare:ABC', kind: 'airfare', category: 'ค่ายานพาหนะ', item: 'ค่าบัตรโดยสารเครื่องบินในประเทศ', amount: 4180, evidenceFileIds: ['f'] });
    const r = await fill(l, { add: true, evidence: true });
    expect(r.status, JSON.stringify(r.steps)).toBe('added');
    expect(r.computed).toBe(4180);
  });

  it('stops on a mismatch and does not press เพิ่มรายการขอเบิก', async () => {
    await page.evaluate(() => ((window as any).__sim.computeOffset = 10));
    const l = line({ id: 'airfare:ABC', kind: 'airfare', category: 'ค่ายานพาหนะ', item: 'ค่าบัตรโดยสารเครื่องบินในประเทศ', amount: 4180, evidenceFileIds: ['f'] });
    const r = await fill(l, { add: true, evidence: true });
    expect(r.status).toBe('mismatch');
    expect(r.computed).toBe(4190);
    expect(await page.evaluate(() => (window as any).__sim.clicks)).toEqual([]);
  });

  it('falls back to a manual attach when K2 ignores the synthetic file event', async () => {
    await page.evaluate(() => {
      const s = (window as any).__sim;
      s.ignoreFileChange = true;
      setTimeout(() => s.manualAttach('hotel-signed.pdf'), 1500); // the person attaches it
    });
    const l = line({ id: 'hotel', kind: 'hotel', category: 'ค่าที่พัก', item: 'ค่าที่พักเดินทางในประเทศ', nights: 2, ratePerNight: 1500, amount: 3000, evidenceFileIds: ['f'] });
    const r = await fill(l, { add: false, evidence: true, attachAutoTimeout: 500, manualAttachTimeout: 10_000 });
    expect(r.status, JSON.stringify(r.steps)).toBe('filled');
    expect(r.attachMode).toBe('manual');
  });
});
