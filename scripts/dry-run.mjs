#!/usr/bin/env node
// End-to-end dry run of the BUILT extension against a saved DPA trip form.
//
// - Loads dist/ in Chromium, serves the anonymised saved form at the real DPA URL with
//   the K2 simulator (tests/dom/k2-sim.js) standing in for K2's scripts.
// - Makes two signed PDFs shaped like a real trip (airfare receipt + 2 boarding passes;
//   hotel receipt + folio) and drops them into the side panel.
// - A mock KKU GenAI gateway returns what a model would read from them.
// - Drives the side panel: read trip, read files, confirm times and lines, Fill (dry run).
//
// Usage: npm run build && node scripts/dry-run.mjs <outDir> [--empty-claims]
//   --empty-claims  remove the claim lines already in the saved table (a trip before claiming)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { makeSignedPdf } from './lib/signed-pdf.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'tests/.build/dry-run'));
const emptyClaims = process.argv.includes('--empty-claims');
fs.mkdirSync(out, { recursive: true });

// ---- the documents ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-'));
const airfarePdf = path.join(tmp, 'airfare-TEZT6J-signed.pdf');
const hotelPdf = path.join(tmp, 'hotel-signed.pdf');
fs.writeFileSync(airfarePdf, makeSignedPdf([
  ['TAX INVOICE / RECEIPT', 'Thai AirAsia Co., Ltd.', 'Bill to: Khon Kaen University  Tax ID 0994000165188', 'Booking TEZT6J', 'FD3437 KKC-CNX fare 1,412.36', 'Airport tax KKC 100.00', 'FD5504 CNX-KKC fare 1,385.38', 'Airport tax CNX 100.00', 'Seat selection 150.00', 'Payment fee 50.00', 'Total 3,197.74'],
  ['BOARDING PASS  FD3437', 'KKC -> CNX  10 NOV 2026', 'Boarding 17:30   Booking TEZT6J'],
  ['BOARDING PASS  FD5504', 'CNX -> KKC  13 NOV 2026', 'Boarding 15:20   Arrives 17:00   Booking TEZT6J'],
], { tmp }));
fs.writeFileSync(hotelPdf, makeSignedPdf([
  ['RECEIPT', 'Grand Chaiyaphruek Nimman Chiang Mai', 'Bill to: Khon Kaen University', 'Room 3 nights x 1,500.00', 'Total 4,500.00'],
  ['GUEST FOLIO', 'Arrival 10/11/2026  Departure 13/11/2026', 'Nights: 3   Room 512'],
], { tmp }));

const base = { issuer_tax_id: null, billed_to_tax_id: null, receipt_no: null, receipt_date: null, currency: 'THB', total_amount: null, vat_amount: null, line_items: [], passenger_or_guest_name: 'TEST TRAVELLER', flight: null, stay: null, handwritten_notes: null, evidence: [], confidence: 'high', problems: [] };
const bp = (page, no, from, to, date, boarding, arrival) => ({ ...base, doc_type: 'boarding_pass', pages: [page], issuer_name: 'AirAsia', flight: { carrier: 'FD', flight_no: no, booking_ref: 'TEZT6J', from_iata: from, to_iata: to, date, boarding_time: boarding, departure_time: null, arrival_time: arrival }, evidence: [{ field: 'flight.boarding_time', page, quote: boarding }, { field: 'flight.date', page, quote: date }] });
const READINGS = {
  'airfare-TEZT6J-signed.pdf': [
    { ...base, doc_type: 'airfare_receipt', pages: [1], issuer_name: 'Thai AirAsia Co., Ltd.', billed_to_name: 'Khon Kaen University', billed_to_tax_id: '0994000165188', receipt_no: 'TEZT6J', receipt_date: '2026-10-20', total_amount: 3197.74,
      line_items: [
        { description: 'ค่าตั๋วโดยสารและ/หรือค่าธรรมเนียมอื่นๆ (TEZT6J) FD3437 KKC-CNX', amount: 1412.36, category: 'fare' },
        { description: 'ค่าบริการผู้โดยสารขาออก (ภาษีสนามบิน) KKC', amount: 100, category: 'airport_tax' },
        // Filed as an add-on by the model, as happened on the real receipt.
        { description: 'ค่าตั๋วโดยสารและ/หรือค่าธรรมเนียมอื่นๆ (TEZT6J) FD5504 CNX-KKC', amount: 1385.38, category: 'addon' },
        { description: 'ค่าบริการผู้โดยสารขาออก (ภาษีสนามบิน) CNX', amount: 100, category: 'airport_tax' },
        { description: 'เลือกที่นั่ง', amount: 150, category: 'addon' },
        { description: 'ค่าธรรมเนียมการชำระเงิน', amount: 50, category: 'addon' },
      ],
      flight: { carrier: 'FD', flight_no: '3437', booking_ref: 'TEZT6J', from_iata: 'KKC', to_iata: 'CNX', date: '2026-11-10', boarding_time: null, departure_time: null, arrival_time: null },
      evidence: [{ field: 'total_amount', page: 1, quote: '3,197.74' }, { field: 'line_items[0].amount', page: 1, quote: '1,412.36' }, { field: 'line_items[2].amount', page: 1, quote: '1,385.38' }] },
    bp(2, '3437', 'KKC', 'CNX', '2026-11-10', '17:30', null),
    bp(3, '5504', 'CNX', 'KKC', '2026-11-13', '15:20', '17:00'),
  ],
  'hotel-signed.pdf': [
    { ...base, doc_type: 'hotel_receipt', pages: [1], issuer_name: 'Grand Chaiyaphruek Nimman', billed_to_name: 'Khon Kaen University', receipt_no: 'H-0912', receipt_date: '2026-11-13', total_amount: 4500, line_items: [{ description: 'Room 3 nights', amount: 4500, category: 'room' }], evidence: [{ field: 'total_amount', page: 1, quote: '4,500.00' }] },
    { ...base, doc_type: 'hotel_folio', pages: [2], issuer_name: 'Grand Chaiyaphruek Nimman', stay: { check_in: '2026-11-10', check_out: '2026-11-13', nights: 3, room_no: '512' }, evidence: [{ field: 'stay.nights', page: 2, quote: 'Nights: 3' }] },
  ],
};

// ---- browser ----
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/dpa/hotel.html'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'tests/dom/k2-sim.js'), 'utf8');
const clearClaims = `(() => { const g = [...document.querySelectorAll('div.grid')].find((x) => /Signed By/.test(x.querySelector('.grid-column-header-table')?.textContent || '')); g.querySelectorAll('.grid-content-table tr').forEach((tr) => tr.remove()); })();`;
const html = fixture.replace('</body>', `<script>${sim}</script>${emptyClaims ? `<script>${clearClaims}</script>` : ''}</body>`);
// The sim needs a row to clone when adding; keep a hidden template when emptied.
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'kku-dry-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${path.join(root, 'dist')}`, `--load-extension=${path.join(root, 'dist')}`],
  viewport: { width: 1280, height: 900 },
});
await ctx.route('https://dpa.kku.ac.th/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
const gatewayLog = [];
await ctx.route('https://gen.ai.kku.ac.th/**', async (r) => {
  const url = r.request().url();
  if (url.endsWith('/models')) return r.fulfill({ json: { object: 'list', data: ['gemini-3.8-flash', 'gemma4-26b'].map((id) => ({ id, object: 'model' })) } });
  const body = r.request().postDataJSON();
  const first = body.messages[1].content.find((c) => c.type === 'text').text;
  const name = /File name: ([^\s]+?)\.?\s/.exec(first + ' ')?.[1];
  gatewayLog.push({ file: name, model: body.model, pages: body.messages[1].content.filter((c) => c.type === 'image_url').length });
  const docs = READINGS[name];
  if (!docs) return r.fulfill({ status: 400, json: { error: `unknown file ${name}` } });
  return r.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ documents: docs }) } }] } });
});

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

const trip = await ctx.newPage();
await trip.goto('https://dpa.kku.ac.th/Runtime/Runtime/Form/KKU.BusinessTrip.Input.Form/?SerialNo=0_0');
await trip.waitForTimeout(500);

const panel = await ctx.newPage();
await panel.setViewportSize({ width: 400, height: 1100 });
const errors = [];
panel.on('pageerror', (e) => errors.push(e.message));
panel.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await panel.goto(`chrome-extension://${extId}/index.html`);
await panel.waitForTimeout(800);
const shot = async (name, page = panel) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const tab = async (t) => { await panel.click(`button[data-tab=${t}]`); await panel.waitForTimeout(300); };

// Settings: key
await panel.fill('input[type=password]', 'dry-run-key');
await panel.locator('input[type=password]').dispatchEvent('change');

// 1 Trip
await tab('trip');
await panel.click('button.primary');
await panel.waitForSelector('text=Page check', { timeout: 15000 });
await shot('1-trip');

// 2 Files
await tab('files');
await panel.setInputFiles('input[type=file]', [airfarePdf, hotelPdf]);
await panel.waitForSelector('.badge');
await panel.click('button.primary:has-text("Read")');
await panel.waitForFunction(() => document.querySelectorAll('.doc').length >= 5, null, { timeout: 30000 });
await shot('2-files');

// 3 Review: confirm times and every line
await tab('review');
// The panel re-renders on every change, so click and re-query rather than check().
await panel.locator('label:has-text("I confirm these four times") input').click();
await panel.waitForTimeout(200);
for (let i = 0; i < 10; i++) {
  const box = panel.locator('label:has-text("I checked this line") input:not(:checked)').first();
  if (!(await box.count())) break;
  await box.click();
  await panel.waitForTimeout(200);
}
const unticked = await panel.locator('label:has-text("I checked this line") input:not(:checked)').count();
if (unticked) throw new Error(`${unticked} line(s) would not stay ticked`);
const review = await panel.evaluate(() => ({
  times: [...document.querySelectorAll('.grid2 input.mono')].map((i) => i.value),
  lines: [...document.querySelectorAll('.card')].filter((c) => c.querySelector('h3')?.textContent?.includes('·')).map((c) => ({ line: c.querySelector('h3').textContent, amount: c.querySelector('strong.num')?.textContent, flags: [...c.querySelectorAll('.flag')].map((f) => f.textContent) })),
  globalFlags: [...document.querySelectorAll('main > .flag')].map((f) => f.textContent),
}));
await shot('3-review');

// 4 Fill (dry run), one line at a time
await tab('fill');
const results = [];
const cards = await panel.locator('.card:has(button.primary)').count();
for (let i = 0; i < cards; i++) {
  const card = panel.locator('.card:has(button.primary)').nth(i);
  const title = await card.locator('h3').innerText();
  const btn = card.locator('button.primary');
  if (await btn.isDisabled()) {
    results.push({ line: title, status: 'blocked', why: await card.locator('.flag.block').first().innerText().catch(() => '') });
    continue;
  }
  await btn.click();
  await panel.waitForFunction((n) => {
    const c = [...document.querySelectorAll('.card')].filter((x) => x.querySelector('button.primary'))[n];
    return c && /Filled\.|Stopped|DPA shows|Already in DPA|Added/.test(c.textContent ?? '');
  }, i, { timeout: 60000 });
  const c = panel.locator('.card:has(button.primary)').nth(i);
  results.push({ line: title, result: (await c.locator('.flag').last().innerText()), steps: await c.locator('ol.steps li').allInnerTexts() });
  // Show the DPA claim panel as the extension left it.
  const rect = await trip.evaluate(() => {
    const lab = [...document.querySelectorAll('.SourceCode-Forms-Controls-Web-Label')].find((l) => l.textContent.trim() === 'หมวดรายการที่เบิก');
    const g = lab.closest('div.Grid-Layout');
    g.scrollIntoView();
    const r = g.getBoundingClientRect();
    return { x: r.x, y: r.y, width: Math.min(r.width, 1280), height: Math.min(r.height, 900) };
  });
  await trip.screenshot({ path: path.join(out, `5-dpa-panel-${i + 1}.png`), clip: rect });
}
await shot('4-fill');

const summary = { emptyClaims, gatewayCalls: gatewayLog, review, fill: results, panelErrors: errors };
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await ctx.close();
