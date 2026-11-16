# Build progress

Scope agreed with the owner: milestones 1–4 of the spec, plus proxy mode (extension side and a reference proxy server). Save draft and the audit log (milestone 6) are not in this build.

## Done
- [x] DPA discovery from three saved pages (vehicle with dropdown open, hotel, per diem). Anonymised fixtures in `tests/fixtures/dpa/`, sanitiser in `scripts/sanitize-dpa-page.mjs`.
- [x] Label config, deny list and allow list: `src/config/labels.ts`
- [x] Rules engine with unit tests: `src/rules/` (per diem days, default times, hotel cap, airfare items, budget, billed-to, evidence, de-dup, planner, review edits)
- [x] Extraction: schema, prompt, SDK client with structured outputs, Haiku-first retry, validation (`src/extraction/`)
- [x] PDF: signature check (pkijs), SHA-256, Prepare for signing merge (`src/pdf/`)
- [x] K2 DOM adapter, page reader, fill driver, content script entry (`src/content/`)
- [x] Service worker (`src/background/`)
- [x] DOM tests with Playwright against the fixtures plus a small K2 behaviour simulator (21 tests passing)
- [x] Side panel UI written: `src/sidepanel/` (trip, files, review with PDF preview, fill, settings)
- [x] Reference proxy server: `proxy/server.mjs`, `proxy/README.md`
- [x] README

## Next
- [ ] `npx tsc --noEmit` on the side panel and `src/rules/overrides.ts` (written but not yet typechecked), fix errors
- [ ] `npm run test:unit` (includes new `tests/unit/overrides.test.ts`) and `npm run test:dom`
- [ ] `npm run build`, check `dist/` has manifest.json, index.html, content.js, background.js, pdf.worker.min.mjs
- [ ] Load `dist/` in Chromium with Playwright as an unpacked extension and screenshot the side panel (smoke test)
- [ ] Commit and push to `claude/dpa-extension`
- [ ] Cancel the scheduled resume (trigger trig_01YaKFbAzGzQ4eKdMGksckv2) when finished
