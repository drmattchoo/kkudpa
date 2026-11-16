# KKU DPA Travel Claim Filler

A Chrome extension that reads a traveller's signed claim documents (boarding passes, airfare receipt or tax invoice, hotel receipt and folio), works out the claim lines, and fills the reimbursement stage of a trip in the KKU Business Travel system on dpa.kku.ac.th. **You review every line and you save and submit in DPA yourself.**

Built from `DPA_EXTENSION_SPEC.md`, milestones 1–4, plus proxy mode. Status: ready for the live dry run (milestone 5). Save draft and the audit log (milestone 6) are not in this build.

## What it does

1. **Trip.** Reads the open trip form: TRIP number, trip dates, location, the traveller's entitlement (อัตราค่าเบี้ยเลี้ยง, ประเภทห้องพัก, อัตราค่าห้องพัก), the approved estimate, the lines already in the claim table, and the finance officer's notes. It also checks that every label it needs is on the page.
2. **Files.** You drop the PDFs (or JPG/PNG). For each one it shows the SHA-256, whether it is signed and by whom, and the values the model read. Prepare for signing merges the scans for one line into one unsigned PDF for you to sign in Acrobat.
3. **Review.** It proposes the lines and shows where every number came from. Click a source to see the page. You confirm the four times and tick each line.
4. **Fill.** For each line it clicks the traveller row, chooses the category and item, types the times and amounts, attaches the evidence, reads DPA's computed amount and compares it with the plan. A dry run stops there. Add mode presses เพิ่มรายการขอเบิก, but only when DPA's figure matches the plan.

| Line | DPA category → item | What is entered | Evidence |
|---|---|---|---|
| Per diem | ค่าเบี้ยเลี้ยง → ค่าเบี้ยเลี้ยงเดินทางในประเทศ | the four times; DPA computes days × อัตราต่อวัน | none |
| Hotel | ค่าที่พัก → ค่าที่พักเดินทางในประเทศ | ที่พักจำนวน (nights), อัตราต่อคืน | receipt + folio, one signed PDF |
| Airfare | ค่ายานพาหนะ → ค่าบัตรโดยสารเครื่องบินในประเทศ | ระบุจำนวนเงิน = fare + airport tax | receipt/tax invoice + boarding passes, one signed PDF |

## Safety rules in the code

- **Never saves or submits.** The DOM driver may press only เพิ่มรายการขอเบิก and ล้างข้อมูล (`ALLOW_BUTTONS` in `src/config/labels.ts`). It also refuses everything on a deny list: ส่งเอกสารขออนุมัติเบิกจ่าย, ส่งอนุมัติ, ส่งเอกสารคำร้อง, ส่งให้ผู้ขอแก้ไขเอกสาร, บันทึกเอกสาร, and the other buttons found on the form, such as ยกเลิกการเดินทาง and ไม่เบิกจ่ายงบประมาณที่ขอ. Tests cover this.
- **Uploads the bytes you supplied.** Files are read and rendered, never rewritten. A DOM test checks that the uploaded bytes hash the same as the original.
- **No duplicates.** A line whose item and amount are already in the claim table is skipped.
- **Every number has a source:** a document page and quote, a DPA field, a rule, or your edit.
- **Documents go only to the model endpoint** you set (Anthropic, or the KKU proxy). Nothing is stored on a server; files live in the side panel's memory.

## Install (development)

```bash
npm install
npm run build
```

Then in Chrome go to `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select `dist/`. Pin the extension and click it to open the side panel.

Settings (⚙): choose the KKU proxy (enter its URL, then Allow access) or your own API key. The key is kept in `chrome.storage.local` for this browser profile only.

## Tests

```bash
npm run test:unit   # rules, extraction request and validation, signatures, merge
npm run test:dom    # the content-script bundle against saved DPA pages
npm run smoke       # build, load dist/ in Chromium, check the content script and side panel
```

The DOM tests run the real content script in Chromium against three anonymised saves of the trip form (`tests/fixtures/dpa/`): the vehicle category with the item dropdown open, the hotel category, and the per diem category. A saved page has no K2 scripts, so `tests/dom/k2-sim.js` stands in for K2's behaviour (radio selection, the body-level dropdown list, watermark boxes, computed amounts, the file control, adding a row). Passing these tests means the driver finds and operates the real markup. It does not prove that live K2 accepts the synthetic events; the dry run on a real trip does that. The DOM tests need Playwright with Chromium (`npx playwright install chromium`).

To add a fixture from a new save, sanitise it first. The script removes names, emails, phone numbers, IDs, TRIP numbers and GUIDs, and fails if anything personal is left:

```bash
node scripts/sanitize-dpa-page.mjs private/saved-page.html tests/fixtures/dpa/new-state.html
```

Keep real saves and real receipts in `private/`, which git ignores. **This repository is public.**

## Milestone 5: live dry run

1. Open a trip with status รอเบิกจ่าย. Read it in tab 1; the page check must pass.
2. Drop the signed files and read them. Check every value against the page in Review.
3. Fill each line in **Dry run** mode. Compare DPA's computed amount and days with the plan. Watch whether the evidence file attaches by itself; if DPA ignores it, the panel asks you to click the highlighted box and choose the file.
4. Press ล้างข้อมูล in DPA between lines, or reload the trip without saving.
5. Report back what differed. The likely fixes are label strings in `src/config/labels.ts` and wait times in `src/content/k2.ts`.

## Where the spec and the build differ

| Spec | Build | Why |
|---|---|---|
| §5.4 forced tool call, temperature 0 | Structured outputs (`output_config.format`) with the same JSON schema | Current models reject forced `tool_choice` (Sonnet 5.5) and non-default `temperature` with a 400. Structured outputs still guarantee one schema-valid object per file. |
| — | Server-side refusal fallback on Sonnet (setting) | If Sonnet declines a document, the API retries on a fallback model instead of failing. |
| §2 rule 1 deny list | Deny list **and** an allow list | The form has more destructive buttons than the spec lists. An allow list also covers buttons DPA adds later. |
| §7 per diem evidence | No file for per diem | DPA hides หลักฐานค่าใช้จ่าย for per diem; only the four times are needed. |
| §7.3 times | Work start/end default to the DPA activity dates at 08:30 / 16:30 (settings) | The spec gives defaults for departure and return only. |
| §4 hotel | Below the cap, rate per night = receipt ÷ nights, rounded to satang | DPA computes nights × rate, so the claim can differ from the receipt by a few satang. The review screen says so when it happens. |
| §5 permissions | Adds `optional_host_permissions: https://*/*`, used only to ask for the proxy's own origin when you press Allow access | The proxy URL is not known at build time. Nothing is granted until you approve it. |
| §6 schema `flight`, `stay` | Nullable objects | A receipt has no stay; a folio has no flight. |

## Layout

```
src/config/labels.ts     every DPA label, item name, deny and allow list
src/rules/               pure rules engine (per diem, hotel, airfare, budget, checks, planner, review edits)
src/extraction/          schema, prompt, API client, validation
src/pdf/                 signature check, SHA-256, prepare-for-signing merge
src/content/             K2 adapter, page reader, fill driver (content script)
src/background/          service worker: extraction calls
src/sidepanel/           UI
proxy/                   reference proxy server
tests/                   unit and DOM tests, anonymised fixtures
scripts/                 fixture sanitiser, signed-PDF fixture generator
```

## Open questions (from the spec, still open)

- Faculty approval (PDPA) for sending receipts to an outside API. Proxy mode keeps usage logged under KKU control.
- Whether ODT can open K2 SmartObject REST services for the travel process. That would replace the DOM driver.
- Whether receipts must be in the unit's name, and whether the เบิกจ่ายเพียง note can go in หมายเหตุ for digital documents. The extension currently fills หมายเหตุ with the note and also asks you to write it on the receipt.
