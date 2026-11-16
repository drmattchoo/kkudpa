#!/usr/bin/env node
// Smoke test of the BUILT extension (dist/) in Chromium:
// - loads dist/ as an unpacked extension,
// - serves an anonymised trip-form save at the real DPA URL so the manifest injects content.js,
// - asks the content script for the trip context through chrome.tabs.sendMessage,
// - opens the side panel page, adds a signed PDF and screenshots each tab.
// Usage: npm run build && node scripts/smoke-extension.mjs [outDir]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const out = path.resolve(process.argv[2] ?? path.join(root, 'tests/.build/smoke'));
fs.mkdirSync(out, { recursive: true });

const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/dpa/hotel.html'), 'utf8');
const sim = fs.readFileSync(path.join(root, 'tests/dom/k2-sim.js'), 'utf8');
const TRIP_URL = 'https://dpa.kku.ac.th/Runtime/Runtime/Form/KKU.BusinessTrip.Input.Form/?SerialNo=0_0';

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'kku-smoke-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: 420, height: 900 },
});
// Never reach the real DPA: serve the fixture (with the K2 simulator) instead.
await ctx.route('https://dpa.kku.ac.th/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture.replace('</body>', `<script>${sim}</script></body>`) }));
// Stand-in for the KKU GenAI gateway: a model list and a canned reading of signed.pdf.
const gatewayCalls = [];
await ctx.route('https://gen.ai.kku.ac.th/**', async (r) => {
  const url = r.request().url();
  if (url.endsWith('/models')) return r.fulfill({ json: { object: 'list', data: ['gemini-3.8-flash', 'gemma4-26b', 'deepseek-v4.1-flash-maas'].map((id) => ({ id, object: 'model' })) } });
  const body = r.request().postDataJSON();
  gatewayCalls.push({ auth: r.request().headers()['authorization'], model: body.model, images: body.messages[1].content.filter((c) => c.type === 'image_url').length, format: body.response_format?.type });
  const docs = [{ doc_type: 'hotel_receipt_and_folio', pages: [1], issuer_name: 'Test Hotel', issuer_tax_id: null, billed_to_name: 'มหาวิทยาลัยขอนแก่น', billed_to_tax_id: null, receipt_no: 'R1', receipt_date: '2026-11-13', currency: 'THB', total_amount: 4500, vat_amount: null, line_items: [], passenger_or_guest_name: null, flight: null, stay: { check_in: '2026-11-10', check_out: '2026-11-13', nights: 3, room_no: null }, handwritten_notes: null, evidence: [{ field: 'total_amount', page: 1, quote: '4,500.00' }], confidence: 'high', problems: [] }];
  return r.fulfill({ json: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ documents: docs }) } }] } });
});

let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const results = { extensionId: extId };

const trip = await ctx.newPage();
await trip.goto(TRIP_URL);
await trip.waitForTimeout(800);
const reply = await sw.evaluate(async (url) => {
  const [tab] = await chrome.tabs.query({ url: url + '*' });
  return chrome.tabs.sendMessage(tab.id, { type: 'read-context', target: 'content' });
}, 'https://dpa.kku.ac.th/');
results.contentScript = reply.ok ? { tripNo: reply.ctx.tripNo, traveller: reply.ctx.traveller, rows: reply.rows.length, selfTestFailures: reply.selfTest.filter((i) => !i.ok) } : reply;

const panel = await ctx.newPage();
results.errors = [];
results.gatewayCalls = gatewayCalls;
panel.on('pageerror', (e) => results.errors.push(e.message));
panel.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') results.errors.push(`console: ${m.text()}`); });
await panel.goto(`chrome-extension://${extId}/index.html`);
await panel.waitForTimeout(800);
results.opensOnSettingsWithoutKey = await panel.locator('h2').first().innerText();
results.modelOptions = await panel.locator('select').first().locator('option').allInnerTexts();
await panel.fill('input[type=password]', 'test-key');
await panel.locator('input[type=password]').dispatchEvent('change');
await panel.screenshot({ path: path.join(out, '0-settings.png'), fullPage: true });
await panel.click('button[data-tab=trip]');
await panel.screenshot({ path: path.join(out, '1-trip.png'), fullPage: true });
await panel.click('button[data-tab=files]');
await panel.setInputFiles('input[type=file]', path.join(root, 'tests/fixtures/pdf/signed.pdf'));
await panel.waitForSelector('.badge');
await panel.click('button.secondary:text-is("Read")');
await panel.waitForSelector('.doc', { timeout: 30000 }).catch(() => {});
results.filesTab = await panel.locator('.card').first().innerText();
await panel.screenshot({ path: path.join(out, '2-files.png'), fullPage: true });
await panel.click('button.link:text-is("view")');
results.previewRendered = await panel.waitForFunction(() => (document.querySelector('#preview-body canvas')?.width ?? 0) > 0, null, { timeout: 15000 }).then(() => true, () => false);
await panel.screenshot({ path: path.join(out, '2b-preview.png') });
await panel.keyboard.press('Escape');

console.log(JSON.stringify(results, null, 2));
await ctx.close();
