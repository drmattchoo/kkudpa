#!/usr/bin/env node
// Turns a "Save page as" copy of a DPA trip form into an anonymised test fixture.
// Usage: node scripts/sanitize-dpa-page.mjs <input.html> <output.html>
// Removes scripts, styles, chat widgets and iframes, and replaces personal data:
// person names (Thai titles), emails, phone numbers, 13-digit IDs, TRIP numbers,
// serial numbers and GUIDs in URLs. It then fails if anything that looks personal is left.
import fs from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: sanitize-dpa-page.mjs <input.html> <output.html>');
  process.exit(2);
}
let h = fs.readFileSync(inPath, 'utf8');

// 1. Strip active and bulky content.
h = h.replace(/<!-- saved from url=[^>]*-->/g, '<!-- saved from url=https://dpa.kku.ac.th/Runtime/Runtime/Form/KKU.BusinessTrip.Input.Form/ (sanitised fixture) -->');
h = h.replace(/<script\b[\s\S]*?<\/script>/gi, '');
h = h.replace(/<style\b[\s\S]*?<\/style>/gi, '');
h = h.replace(/<link\b[^>]*>/gi, '');
h = h.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
h = h.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
h = h.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
h = h.replace(/\ssrc="[^"]*"/gi, '');
h = h.replace(/\son[a-z]+="[^"]*"/gi, '');

// 2. Personal data.
const TITLES = '(?:นางสาว|นาง|นาย|ศาสตราจารย์|รองศาสตราจารย์|ผู้ช่วยศาสตราจารย์|อาจารย์|ดร\\.)';
const NAME = '[\\u0E00-\\u0E7F]+';
const people = new Map();
const alias = (full) => {
  if (!people.has(full)) people.set(full, `บุคคล${String.fromCharCode(0x0E01 + people.size)}`);
  return people.get(full);
};
// Titled names: "นายสมชาย ใจดี" -> "นายทดสอบ บุคคลก"
h = h.replace(new RegExp(`(${TITLES})(${NAME})(?:\\s|&nbsp;)+(${NAME})`, 'gu'), (_m, t, f, l) => `${t}ทดสอบ ${alias(f + ' ' + l)}`);
// The same people without a title (Signed By column, greetings).
for (const [full, a] of people) {
  const [first, last] = full.split(' ');
  h = h.split(full).join(`ทดสอบ ${a}`);
  h = h.split(`คุณ${first}`).join('คุณทดสอบ');
  if (first.length > 3) h = h.split(first).join('ทดสอบ');
  if (last.length > 3) h = h.split(last).join(a);
}
h = h.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'traveller@example.ac.th');
h = h.replace(/\b0\d{1,2}[- ]?\d{3}[- ]?\d{4}\b/g, '000-000-0000');
h = h.replace(/\b\d{13}\b/g, '0000000000000');
h = h.replace(/TRIP\d{11}/g, 'TRIP20260000001');
h = h.replace(/SerialNo=[^&"']+/g, 'SerialNo=0_0');
// GUIDs: replace each with a stable fake so element-id relationships survive
// (e.g. a dropdown box id and its "<id>_droplist" menu), but no real id remains.
const guids = new Map();
h = h.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (g) => {
  const k = g.toLowerCase();
  if (!guids.has(k)) {
    const n = (guids.size + 1).toString(16).padStart(12, '0');
    guids.set(k, `00000000-0000-4000-8000-${n}`);
  }
  return guids.get(k);
});

// 3. Chrome's "Save page as" turns K2 button hrefs into absolute links back to the form.
// Live, K2's script cancels those clicks; in a script-free copy they would navigate.
h = h.replace(/href="https:\/\/dpa\.kku\.ac\.th\/Runtime\/Runtime\/Form\/[^"]*#"/g, 'href="javascript:;"');

// 4. Make "hidden" behave as K2's stylesheet does, since the stylesheet is gone.
h = h.replace(/<head>/i, '<head><meta charset="utf-8"><style>.hidden{display:none!important}</style>');

// 5. Residual check.
const leftovers = [
  ...h.matchAll(new RegExp(`${TITLES}(?!ทดสอบ)${NAME}`, 'gu')),
].map((m) => m[0]).filter((s) => !s.includes('ทดสอบ'));
const emails = [...h.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map((m) => m[0]).filter((e) => e !== 'traveller@example.ac.th');
fs.writeFileSync(outPath, h);
console.log(`wrote ${outPath} (${(h.length / 1024).toFixed(0)} KB), people replaced: ${people.size}`);
if (leftovers.length || emails.length) {
  console.error('Possible personal data left:', [...new Set([...leftovers, ...emails])].slice(0, 30));
  process.exit(1);
}
