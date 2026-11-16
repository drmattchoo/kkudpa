# Build progress

Scope agreed with the owner: milestones 1–4 of the spec, plus proxy mode (extension side and a reference proxy server). Save draft and the audit log (milestone 6) are not in this build.

## Done
- [x] DPA discovery from three saved pages (vehicle with dropdown open, hotel, per diem). Anonymised fixtures in `tests/fixtures/dpa/`, sanitiser in `scripts/sanitize-dpa-page.mjs`.
- [x] Label config and deny list: `src/config/labels.ts`
- [x] Rules engine with unit tests: `src/rules/` (per diem days, default times, hotel cap, airfare items, budget, billed-to, evidence, de-dup, planner)
- [x] Extraction: schema, prompt, SDK client with structured outputs, Haiku-first retry, validation (`src/extraction/`)
- [x] PDF: signature check (pkijs), SHA-256, Prepare for signing merge (`src/pdf/`)
- [x] K2 DOM adapter, page reader, fill driver, content script entry (`src/content/`)
- [x] Service worker (`src/background/`)

## Next
- [ ] Typecheck and build
- [ ] DOM tests with Playwright against the fixtures plus a small K2 behaviour simulator
- [ ] Side panel UI: trip, files, review with PDF preview, fill (dry run / add)
- [ ] Settings: direct and proxy mode, optional host permission for the proxy
- [ ] Reference proxy server in `proxy/`
- [ ] README: install, use, what was found in DPA, deviations from the spec
