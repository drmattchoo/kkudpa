// Side panel: pick trip → drop files → review → fill. Nothing reaches DPA before the
// person confirms each line (spec §5.6). The person saves and submits in DPA.

import type { ClaimRow, Flag, IngestedFile, Plan, PlannedLine, PlannedTimes, Settings, TripContext } from '../shared/types';
import type { ContentEvent } from '../shared/messages';
import type { FillReport, FillStep } from '../content/driver';
import type { SelfTestItem } from '../content/reader';
import { buildPlan } from '../rules/planner';
import { applyOverrides, type LineOverride } from '../rules/overrides';
import { flightLegs, proposeTimes } from '../rules/perDiem';
import { formatMoney, parseBeDateTime } from '../shared/dates';
import { checkSignatures } from '../pdf/signature';
import { bytesToBase64, sha256Hex } from '../pdf/hash';
import { mergeForSigning } from '../pdf/merge';
import { DOC_TYPES } from '../extraction/schema';
import { HAIKU, SONNET } from '../extraction/client';
import { loadSettings, saveSettings, grantProxyAccess } from './settings';
import { toContent, toWorker } from './messaging';
import { renderPage, pageCount, forget } from './preview';

// ---------------- state ----------------

type Tab = 'trip' | 'files' | 'review' | 'fill' | 'settings';
interface FillState { running: boolean; steps: FillStep[]; report?: FillReport; manual?: string }

const S = {
  tab: 'trip' as Tab,
  settings: null as unknown as Settings,
  ctx: null as TripContext | null,
  rows: [] as ClaimRow[],
  selfTest: [] as SelfTestItem[],
  ctxError: '' as string,
  files: [] as IngestedFile[],
  bytes: new Map<string, Uint8Array>(),
  extracting: new Set<string>(),
  times: null as PlannedTimes | null,
  timesConfirmed: false,
  overrides: {} as Record<string, LineOverride>,
  fill: {} as Record<string, FillState>,
  addMode: false,
  mergeSel: new Set<string>(),
  busy: '' as string,
};

const MAX_BYTES = 30 * 1024 * 1024;

function plan(): Plan | null {
  if (!S.ctx) return null;
  const base = buildPlan({
    files: S.files.filter((f) => f.extracted),
    ctx: S.ctx,
    existing: S.rows,
    settings: S.settings,
    times: S.times ?? undefined,
    timesConfirmed: S.timesConfirmed,
  });
  return applyOverrides(base, S.overrides, S.files, S.rows, S.ctx, S.settings);
}

// ---------------- tiny DOM builder (no innerHTML: document text is untrusted) ----------------

type Child = Node | string | number | null | undefined | false | Child[];
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : String(c));
  };
  kids.forEach(add);
  return el;
}

const app = document.getElementById('app')!;
function render() {
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  const view = { trip: viewTrip, files: viewFiles, review: viewReview, fill: viewFill, settings: viewSettings }[S.tab]();
  // Keep focus on re-render only when nothing is being typed.
  const holder = h('div', {}, view);
  app.replaceChildren(...Array.from(holder.childNodes));
}
document.getElementById('tabs')!.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button')?.dataset.tab as Tab | undefined;
  if (t) {
    S.tab = t;
    render();
  }
});

const flagEl = (f: Flag) => h('div', { class: `flag ${f.level}` }, h('strong', {}, f.level === 'block' ? 'Must fix: ' : f.level === 'warn' ? 'Check: ' : 'Note: '), f.message);
const money = formatMoney;

// ---------------- 1. Trip ----------------

async function readTrip() {
  S.busy = 'Reading the trip form…';
  render();
  const r = await toContent({ type: 'read-context' });
  S.busy = '';
  if (r.ok && r.type === 'context') {
    S.ctx = r.ctx;
    S.rows = r.rows;
    S.selfTest = r.selfTest;
    S.ctxError = '';
  } else {
    S.ctxError = r.ok ? 'Unexpected reply' : r.error;
  }
  render();
}

function viewTrip(): Child[] {
  const c = S.ctx;
  const failed = S.selfTest.filter((i) => !i.ok);
  return [
    h('div', { class: 'row spread' }, h('h2', {}, 'Trip'), h('button', { class: 'primary', onclick: readTrip, disabled: !!S.busy }, c ? 'Read again' : 'Read trip from this page')),
    S.busy && h('p', { class: 'muted' }, S.busy),
    S.ctxError && h('div', { class: 'flag block' }, S.ctxError),
    !c && !S.ctxError && h('p', { class: 'muted' }, 'Open the trip with status รอเบิกจ่าย in DPA (Open Form from เอกสารรอดำเนินการ), then read it here.'),
    c && [
      S.selfTest.length > 0 &&
        (failed.length
          ? h('div', { class: 'flag block' }, `DPA page check failed: ${failed.map((f) => f.what).join(', ')}. DPA may have changed; filling is disabled.`)
          : h('div', { class: 'flag info' }, `Page check passed (${S.selfTest.length} items).`)),
      h('div', { class: 'card' },
        h('div', { class: 'row spread' }, h('h3', {}, c.tripNo ?? 'No TRIP number found'), h('span', { class: 'muted' }, c.province ?? '')),
        h('div', { class: 'small' }, c.workLocation, c.purpose && ` · ${c.purpose}`),
        h('table', {},
          h('tr', {}, h('th', {}, 'ออกเดินทาง'), h('td', {}, c.departDate), h('th', {}, 'เริ่ม'), h('td', {}, c.startDate)),
          h('tr', {}, h('th', {}, 'สิ้นสุด'), h('td', {}, c.endDate), h('th', {}, 'กลับ'), h('td', {}, c.returnDate)),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Entitlement'),
        c.traveller
          ? h('table', {},
              h('tr', {}, h('th', {}, 'ผู้เดินทาง'), h('td', {}, c.traveller.name)),
              h('tr', {}, h('th', {}, 'สิทธิของเบิก'), h('td', {}, c.traveller.entitlement)),
              h('tr', {}, h('th', {}, 'อัตราค่าเบี้ยเลี้ยง'), h('td', { class: 'num' }, money(c.traveller.perDiemRate))),
              h('tr', {}, h('th', {}, c.traveller.roomType ?? 'ห้องพัก'), h('td', { class: 'num' }, money(c.traveller.roomRate))),
            )
          : h('div', { class: 'flag block' }, 'Traveller row not found.'),
      ),
      h('div', { class: 'card' },
        h('h3', {}, 'Approved estimate'),
        h('table', {},
          ...([['1. ค่าเบี้ยเลี้ยง', c.estimate.perDiem], ['2. ค่าที่พัก', c.estimate.hotel], ['3. ค่าพาหนะ', c.estimate.vehicle], ['4. อื่นๆ', c.estimate.other], ['ขออนุมัติงบประมาณ', c.estimate.requested]] as const).map(([k, v]) =>
            h('tr', {}, h('th', {}, k), h('td', { class: 'num' }, money(v))),
          ),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', {}, `Already in DPA (${S.rows.length})`),
        S.rows.length
          ? h('table', {}, h('tr', {}, h('th', {}, 'รายการ'), h('th', {}, 'Signed by'), h('th', { class: 'num' }, 'จำนวน')),
              S.rows.map((r) => h('tr', {}, h('td', {}, r.item), h('td', {}, r.signedBy || '—'), h('td', { class: 'num' }, money(r.amount)))))
          : h('p', { class: 'empty' }, 'No claim lines yet.'),
      ),
      c.financeNotes.length > 0 &&
        h('div', { class: 'card' },
          h('h3', {}, 'Finance officer notes'),
          c.financeNotes.map((n) => h('details', { open: n === c.financeNotes[0] }, h('summary', {}, `${n.action} · ${n.when}`), h('p', { class: 'small' }, n.comment))),
        ),
    ],
  ];
}

// ---------------- 2. Files ----------------

const idOf = (sha: string, name: string) => `${sha.slice(0, 12)}-${name}`;

async function addFiles(list: FileList | File[]) {
  for (const f of Array.from(list)) {
    const mime = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.type === 'image/png' ? 'image/png' : f.type === 'image/jpeg' ? 'image/jpeg' : null;
    if (!mime) {
      alert(`${f.name}: only PDF, JPG and PNG are accepted.`);
      continue;
    }
    if (f.size > MAX_BYTES) {
      alert(`${f.name} is larger than 30 MB.`);
      continue;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const sha = await sha256Hex(bytes);
    const id = idOf(sha, f.name);
    if (S.files.some((x) => x.id === id)) continue;
    S.bytes.set(id, bytes);
    S.files.push({ id, name: f.name, mime, size: f.size, sha256: sha, signature: mime === 'application/pdf' ? checkSignatures(bytes) : null, extracted: null });
  }
  render();
}

async function extractOne(f: IngestedFile) {
  S.extracting.add(f.id);
  f.extractionError = undefined;
  render();
  const r = await toWorker({ type: 'extract', file: { name: f.name, mime: f.mime, base64: bytesToBase64(S.bytes.get(f.id)!) } });
  S.extracting.delete(f.id);
  if (r.ok) {
    f.extracted = r.doc;
    f.extractionModel = r.model;
  } else {
    f.extractionError = r.error;
  }
  render();
}

async function extractAll() {
  await Promise.all(S.files.filter((f) => !f.extracted && !S.extracting.has(f.id)).map(extractOne));
}

function removeFile(f: IngestedFile) {
  S.files = S.files.filter((x) => x.id !== f.id);
  S.bytes.delete(f.id);
  S.mergeSel.delete(f.id);
  forget(f.id);
  for (const o of Object.values(S.overrides)) if (o.evidenceFileId === f.id) delete o.evidenceFileId;
  render();
}

function sigBadge(f: IngestedFile) {
  if (f.mime !== 'application/pdf') return h('span', { class: 'badge warn' }, 'image');
  const s = f.signature;
  if (!s?.signed) return h('span', { class: 'badge bad', title: s?.error ?? '' }, 'unsigned');
  const last = s.signatures.at(-1)!;
  if (!last.coversWholeFile) return h('span', { class: 'badge bad' }, 'changed after signing');
  return h('span', { class: 'badge ok' }, `signed: ${last.signerName ?? 'unknown signer'}`);
}

function summary(f: IngestedFile): Child {
  const x = f.extracted;
  if (!x) return null;
  const bits: string[] = [];
  if (x.total_amount != null) bits.push(`total ${money(x.total_amount)} ${x.currency}`);
  if (x.stay) bits.push(`${x.stay.nights} nights ${x.stay.check_in} → ${x.stay.check_out}`);
  if (x.flight) bits.push(`${x.flight.carrier}${x.flight.flight_no} ${x.flight.from_iata}→${x.flight.to_iata} ${x.flight.date} boarding ${x.flight.boarding_time ?? '—'}`);
  if (x.billed_to_name) bits.push(`billed to ${x.billed_to_name}`);
  return [
    h('div', { class: 'small' }, bits.join(' · ')),
    x.handwritten_notes && h('div', { class: 'small' }, `Handwritten: ${x.handwritten_notes}`),
    x.problems.length > 0 && h('div', { class: 'flag warn' }, x.problems.join('; ')),
  ];
}

function viewFiles(): Child[] {
  const input = h('input', { type: 'file', multiple: true, accept: '.pdf,application/pdf,image/jpeg,image/png', hidden: true, onchange: (e: Event) => addFiles((e.target as HTMLInputElement).files!) });
  const drop = h('div', { class: 'drop', onclick: () => input.click() }, 'Drop the signed PDFs here (boarding passes, airfare receipt or tax invoice, hotel receipt and folio), or click to choose.');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer!.files); });
  const pending = S.files.filter((f) => !f.extracted).length;
  return [
    h('h2', {}, 'Files'),
    h('p', { class: 'small muted' }, 'Files stay in this browser tab’s memory. They are sent only to the model endpoint in Settings, and uploaded to DPA byte for byte.'),
    drop,
    input,
    S.files.length > 0 && h('div', { class: 'row' }, h('button', { class: 'primary', onclick: extractAll, disabled: pending === 0 || S.extracting.size > 0 }, S.extracting.size ? `Reading ${S.extracting.size}…` : `Read ${pending} file${pending === 1 ? '' : 's'}`)),
    S.files.map((f) =>
      h('div', { class: 'card' },
        h('div', { class: 'row spread' },
          h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: S.mergeSel.has(f.id), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? S.mergeSel.add(f.id) : S.mergeSel.delete(f.id); render(); } }), h('strong', {}, f.name)),
          h('button', { class: 'link', onclick: () => removeFile(f) }, 'remove'),
        ),
        h('div', { class: 'row small' }, sigBadge(f), h('span', { class: 'mono muted', title: f.sha256 }, `sha256 ${f.sha256.slice(0, 12)}…`), h('button', { class: 'link', onclick: () => openPreview(f.id, 1, f.name) }, 'view')),
        f.extracted
          ? h('div', { class: 'row small' },
              h('select', { onchange: (e: Event) => { f.extracted!.doc_type = (e.target as HTMLSelectElement).value as any; render(); } }, DOC_TYPES.map((t) => h('option', { value: t, selected: t === f.extracted!.doc_type }, t))),
              h('span', { class: `badge ${f.extracted.confidence === 'high' ? 'ok' : 'warn'}` }, `${f.extracted.confidence} · ${f.extractionModel ?? ''}`),
              h('button', { class: 'link', onclick: () => extractOne(f) }, 'read again'),
            )
          : S.extracting.has(f.id)
            ? h('div', { class: 'muted small' }, 'Reading…')
            : h('button', { class: 'secondary', onclick: () => extractOne(f) }, 'Read'),
        f.extractionError && h('div', { class: 'flag block' }, f.extractionError),
        summary(f),
      ),
    ),
    S.files.length > 0 &&
      h('div', { class: 'card' },
        h('h3', {}, 'Prepare for signing'),
        h('p', { class: 'small' }, 'DPA takes one PDF per claim line. Tick the scans for one line (e.g. hotel receipt + folio, or airfare receipt + boarding passes) and merge them into one UNSIGNED PDF. Sign that file in Acrobat with your KKU Digital ID, then drop the signed file here.'),
        h('button', { class: 'secondary', disabled: S.mergeSel.size < 1, onclick: mergeSelected }, `Merge ${S.mergeSel.size} file(s) and download`),
      ),
  ];
}

async function mergeSelected() {
  const chosen = S.files.filter((f) => S.mergeSel.has(f.id));
  const signed = chosen.filter((f) => f.signature?.signed);
  if (signed.length && !confirm(`${signed.map((f) => f.name).join(', ')} ${signed.length > 1 ? 'are' : 'is'} signed. Merging drops the signature, so the merged file must be signed again. Continue?`)) return;
  const bytes = await mergeForSigning(chosen.map((f) => ({ name: f.name, mime: f.mime, bytes: S.bytes.get(f.id)! })));
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = h('a', { href: url, download: `${S.ctx?.tripNo ?? 'claim'}-evidence-to-sign.pdf` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------- preview ----------------

const dlg = document.getElementById('preview') as HTMLDialogElement;
let pv = { id: '', page: 1, rot: 0, pages: 1 };
async function openPreview(fileId: string, page: number, title: string, quote = '') {
  const f = S.files.find((x) => x.id === fileId);
  const bytes = S.bytes.get(fileId);
  if (!f || !bytes) return;
  pv = { id: fileId, page, rot: 0, pages: f.mime === 'application/pdf' ? await pageCount(fileId, bytes) : 1 };
  document.getElementById('preview-title')!.textContent = `${title} · page ${page}`;
  const q = document.getElementById('preview-quote')!;
  q.textContent = quote ? `Printed: ${quote}` : '';
  q.hidden = !quote;
  await drawPreview();
  if (!dlg.open) dlg.showModal();
}
async function drawPreview() {
  const f = S.files.find((x) => x.id === pv.id)!;
  const bytes = S.bytes.get(pv.id)!;
  const body = document.getElementById('preview-body')!;
  document.getElementById('preview-title')!.textContent = `${f.name} · page ${pv.page}/${pv.pages}`;
  if (f.mime === 'application/pdf') {
    const c = h('canvas');
    body.replaceChildren(c);
    await renderPage(c, pv.id, bytes, pv.page, pv.rot, Math.min(window.innerWidth - 40, 520));
  } else {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: f.mime }));
    body.replaceChildren(h('img', { src: url, style: `transform: rotate(${pv.rot}deg)` }));
  }
}
document.getElementById('preview-prev')!.addEventListener('click', () => { if (pv.page > 1) { pv.page--; drawPreview(); } });
document.getElementById('preview-next')!.addEventListener('click', () => { if (pv.page < pv.pages) { pv.page++; drawPreview(); } });
document.getElementById('preview-rotate')!.addEventListener('click', () => { pv.rot = (pv.rot + 90) % 360; drawPreview(); });

// ---------------- 3. Review ----------------

function currentTimes(): PlannedTimes {
  if (S.times) return S.times;
  const p = proposeTimes(flightLegs(S.files), S.ctx!, S.settings);
  return { depart: p.depart, start: p.start, end: p.end, return: p.return };
}

function timesCard(): Child {
  const t = currentTimes();
  const basis = proposeTimes(flightLegs(S.files), S.ctx!, S.settings).basis;
  const field = (k: keyof PlannedTimes, label: string, why: string) => {
    let bad = false;
    try { parseBeDateTime(t[k]); } catch { bad = true; }
    return h('label', { class: 'field' },
      h('span', {}, label),
      h('input', { type: 'text', value: t[k], class: 'mono', 'aria-invalid': String(bad), placeholder: 'dd-MM-yyyy HH:mm (พ.ศ.)',
        onchange: (e: Event) => { S.times = { ...currentTimes(), [k]: (e.target as HTMLInputElement).value.trim() }; S.timesConfirmed = false; render(); } }),
      h('span', { class: 'small muted' }, S.times ? 'edited' : why),
    );
  };
  return h('div', { class: 'card' },
    h('h3', {}, 'Times (shared by every line)'),
    h('p', { class: 'small muted' }, 'DPA format, Buddhist Era: 10-11-2569 15:30. Defaults come from the boarding passes; check them against when you actually left and got back.'),
    h('div', { class: 'grid2' },
      field('depart', 'วันเวลาเดินทางออกจากต้นทาง', basis.depart),
      field('start', 'วันเวลาเริ่มปฏิบัติงาน', basis.start),
      field('end', 'วันเวลาสิ้นสุดปฏิบัติงาน', basis.end),
      field('return', 'วันเวลาเดินทางกลับถึงที่ตั้ง', basis.return),
    ),
    h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: S.timesConfirmed, onchange: (e: Event) => { S.times = currentTimes(); S.timesConfirmed = (e.target as HTMLInputElement).checked; render(); } }), 'I confirm these four times'),
  );
}

function lineCard(l: PlannedLine, p: Plan): Child {
  const flags = p.flags.filter((f) => f.lineId === l.id);
  const o = (S.overrides[l.id] ??= {});
  const pdfs = S.files.filter((f) => f.mime === 'application/pdf');
  const num = (label: string, value: number | undefined, set: (n: number) => void, step = '0.01') =>
    h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'number', step, value: value ?? '', onchange: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); render(); } }));
  return h('div', { class: 'card' },
    h('div', { class: 'row spread' }, h('h3', {}, `${l.category} · ${l.item}`), h('strong', { class: 'num' }, money(l.amount))),
    l.duplicate && h('div', { class: 'flag info' }, 'Already in DPA with this amount. It will be skipped.'),
    l.kind === 'per_diem' && h('div', { class: 'small' }, `${l.days} days × ${money(l.ratePerDay)}. No evidence file: DPA works it out from the times.`),
    l.kind === 'hotel' && h('div', { class: 'grid2' }, num('ที่พักจำนวน (คืน)', l.nights, (n) => (o.nights = n), '1'), num('อัตราต่อคืน', l.ratePerNight, (n) => (o.ratePerNight = n))),
    l.kind === 'airfare' && num('ระบุจำนวนเงิน', l.amount, (n) => (o.amount = n)),
    l.kind !== 'per_diem' && [
      h('label', { class: 'field' }, h('span', {}, 'หมายเหตุ'), h('input', { type: 'text', value: l.note, onchange: (e: Event) => { o.note = (e.target as HTMLInputElement).value; render(); } })),
      h('label', { class: 'field' },
        h('span', {}, 'Evidence PDF to upload (one signed file)'),
        h('select', { onchange: (e: Event) => { o.evidenceFileId = (e.target as HTMLSelectElement).value || undefined; render(); } },
          h('option', { value: '' }, l.evidenceFileIds.length > 1 ? `— ${l.evidenceFileIds.length} files: merge and sign first —` : '— as planned —'),
          pdfs.map((f) => h('option', { value: f.id, selected: o.evidenceFileId === f.id }, `${f.name}${f.signature?.signed ? ' (signed)' : ''}`)),
        ),
      ),
    ],
    h('details', {},
      h('summary', { class: 'small' }, `Where the numbers come from (${l.traces.length})`),
      h('table', { class: 'small' },
        l.traces.map((t) => h('tr', {},
          h('td', {}, t.label),
          h('td', { class: 'num' }, t.value),
          h('td', {}, t.source.kind === 'document'
            ? h('button', { class: 'link', onclick: () => { const s = t.source as Extract<typeof t.source, { kind: 'document' }>; openPreview(s.fileId, s.page, s.fileName, s.quote); } }, `${t.source.fileName} p.${t.source.page}`)
            : t.source.kind === 'dpa' ? `DPA: ${t.source.field}` : t.source.kind === 'rule' ? `rule: ${t.source.rule}` : t.source.note),
        )),
      ),
    ),
    flags.map(flagEl),
    !l.duplicate && h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: l.confirmed, onchange: (e: Event) => { o.confirmed = (e.target as HTMLInputElement).checked; render(); } }), 'I checked this line'),
  );
}

function viewReview(): Child[] {
  if (!S.ctx) return [h('p', { class: 'empty' }, 'Read the trip first (tab 1).')];
  const p = plan()!;
  const global = p.flags.filter((f) => !f.lineId);
  const total = p.totals.existing + p.totals.planned;
  return [
    h('h2', {}, 'Review'),
    timesCard(),
    global.filter((f) => f.level !== 'info').map(flagEl),
    p.lines.length === 0 && h('p', { class: 'empty' }, 'No lines yet. Add and read files in tab 2.'),
    p.lines.map((l) => lineCard(l, p)),
    h('div', { class: 'card' },
      h('h3', {}, 'Budget'),
      h('table', {},
        h('tr', {}, h('th', {}, 'Already in DPA'), h('td', { class: 'num' }, money(p.totals.existing))),
        h('tr', {}, h('th', {}, 'New lines'), h('td', { class: 'num' }, money(p.totals.planned))),
        h('tr', {}, h('th', {}, 'Total claim'), h('td', { class: 'num' }, h('strong', {}, money(total)))),
        h('tr', {}, h('th', {}, 'ขออนุมัติงบประมาณ'), h('td', { class: 'num' }, money(p.totals.requested))),
      ),
    ),
    global.filter((f) => f.level === 'info').map(flagEl),
  ];
}

// ---------------- 4. Fill ----------------

function lineBlocked(l: PlannedLine, p: Plan): string | null {
  if (S.selfTest.some((i) => !i.ok)) return 'The DPA page check failed.';
  const b = p.flags.find((f) => f.level === 'block' && (!f.lineId || f.lineId === l.id));
  if (b) return b.message;
  if (!l.confirmed) return 'Tick “I checked this line” in Review.';
  if (l.kind !== 'per_diem' && l.evidenceFileIds.length !== 1) return 'Choose one evidence PDF.';
  return null;
}

async function fillOne(l: PlannedLine) {
  const st: FillState = (S.fill[l.id] = { running: true, steps: [] });
  render();
  const ev = l.evidenceFileIds[0] ? S.files.find((f) => f.id === l.evidenceFileIds[0]) : undefined;
  const r = await toContent({
    type: 'fill-line',
    line: l,
    add: S.addMode,
    evidence: ev ? { base64: bytesToBase64(S.bytes.get(ev.id)!), filename: ev.name.toLowerCase().endsWith('.pdf') ? ev.name : `${ev.name}.pdf` } : undefined,
  });
  st.running = false;
  st.manual = undefined;
  if (r.ok && r.type === 'fill-report') st.report = r.report;
  else st.steps.push({ step: 'Stopped', ok: false, detail: r.ok ? 'Unexpected reply' : r.error });
  // Refresh the claim table so de-duplication sees the new line.
  const c = await toContent({ type: 'read-context' });
  if (c.ok && c.type === 'context') S.rows = c.rows;
  render();
}

chrome.runtime.onMessage.addListener((ev: ContentEvent) => {
  if (ev?.type === 'fill-step') {
    const st = S.fill[ev.lineId];
    if (st) { st.steps.push(ev.step); if (S.tab === 'fill') render(); }
  } else if (ev?.type === 'manual-attach-needed') {
    const st = S.fill[ev.lineId];
    if (st) { st.manual = ev.filename; render(); }
  }
});

function viewFill(): Child[] {
  if (!S.ctx) return [h('p', { class: 'empty' }, 'Read the trip first (tab 1).')];
  const p = plan()!;
  const todo = p.lines.filter((l) => !l.duplicate);
  return [
    h('h2', {}, 'Fill'),
    h('div', { class: 'card' },
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'mode', checked: !S.addMode, onchange: () => { S.addMode = false; render(); } }), h('span', {}, h('strong', {}, 'Dry run'), ' – fill the panel and compare with DPA’s figure, do not add the line')),
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'mode', checked: S.addMode, onchange: () => { S.addMode = true; render(); } }), h('span', {}, h('strong', {}, 'Add lines'), ' – press เพิ่มรายการขอเบิก when DPA’s figure matches the plan')),
      h('p', { class: 'small muted' }, 'The extension never presses บันทึกเอกสาร or ส่งเอกสารขออนุมัติเบิกจ่าย.'),
    ),
    todo.length === 0 && h('p', { class: 'empty' }, 'Nothing to fill.'),
    todo.map((l) => {
      const blocked = lineBlocked(l, p);
      const st = S.fill[l.id];
      const running = Object.values(S.fill).some((x) => x.running);
      return h('div', { class: 'card' },
        h('div', { class: 'row spread' }, h('h3', {}, l.item), h('strong', {}, money(l.amount))),
        blocked && h('div', { class: 'flag block' }, blocked),
        h('button', { class: 'primary', disabled: !!blocked || running, onclick: () => fillOne(l) }, S.addMode ? 'Fill and add' : 'Fill (dry run)'),
        st?.manual && h('div', { class: 'notice' }, `DPA did not take the file automatically. In the DPA tab, click the highlighted หลักฐานค่าใช้จ่าย box and choose ${st.manual}. The extension waits for it.`),
        st && h('ol', { class: 'steps' }, (st.report?.steps ?? st.steps).map((s) => h('li', { class: s.ok ? '' : 'bad' }, s.step, s.detail && ` – ${s.detail}`))),
        st?.report && h('div', { class: `flag ${st.report.status === 'added' || st.report.status === 'filled' || st.report.status === 'skipped-duplicate' ? 'info' : 'block'}` },
          { added: 'Added to DPA.', filled: 'Filled. Check the panel in DPA; press ล้างข้อมูล there to clear it, or switch to Add lines.', 'skipped-duplicate': 'Already in DPA; skipped.', mismatch: `DPA shows ${money(st.report.computed)}, plan is ${money(st.report.expected)}. Not added.`, error: `Stopped: ${st.report.error}` }[st.report.status],
        ),
      );
    }),
    h('div', { class: 'card' },
      h('h3', {}, 'DPA claim table now'),
      h('table', {}, h('tr', {}, h('th', {}, 'รายการ'), h('th', {}, 'Signed by'), h('th', { class: 'num' }, 'จำนวน')),
        S.rows.map((r) => h('tr', {}, h('td', {}, r.item), h('td', {}, r.signedBy || '—'), h('td', { class: 'num' }, money(r.amount))))),
      h('p', { class: 'notice small' }, 'When the table is right: review it in DPA, press บันทึกเอกสาร, then ส่งเอกสารขออนุมัติเบิกจ่าย yourself.'),
    ),
  ];
}

// ---------------- settings ----------------

function viewSettings(): Child[] {
  const s = S.settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { S.settings = { ...S.settings, [k]: v }; saveSettings(S.settings); render(); };
  const txt = (k: keyof Settings, label: string, type = 'text', help?: string) =>
    h('label', { class: 'field' }, h('span', {}, label), h('input', { type, value: String(s[k] ?? ''), onchange: (e: Event) => set(k, (type === 'number' ? Number((e.target as HTMLInputElement).value) : (e.target as HTMLInputElement).value) as never) }), help && h('span', { class: 'small muted' }, help));
  return [
    h('h2', {}, 'Settings'),
    h('div', { class: 'card' },
      h('h3', {}, 'Model access'),
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'm', checked: s.mode === 'proxy', onchange: () => set('mode', 'proxy') }), 'KKU proxy (recommended when the department shares a key)'),
      h('label', { class: 'row' }, h('input', { type: 'radio', name: 'm', checked: s.mode === 'direct', onchange: () => set('mode', 'direct') }), 'My own Anthropic API key'),
      s.mode === 'proxy'
        ? [txt('proxyUrl', 'Proxy URL', 'url', 'e.g. https://claim-proxy.example.kku.ac.th'),
           h('button', { class: 'secondary', onclick: async () => { try { alert((await grantProxyAccess(s.proxyUrl)) ? 'Access granted.' : 'Access not granted.'); } catch (e) { alert((e as Error).message); } } }, 'Allow access to the proxy')]
        : [txt('apiKey', 'API key', 'password'), h('div', { class: 'flag warn' }, 'The key is stored in this browser profile (chrome.storage.local, not synced). Anyone with access to this profile can read it.')],
      h('p', { class: 'small muted' }, 'Receipts and boarding passes contain personal data. Check the faculty has approved sending them to an outside API (PDPA).'),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Reading'),
      h('label', { class: 'field' }, h('span', {}, 'Model'), h('select', { onchange: (e: Event) => set('model', (e.target as HTMLSelectElement).value) }, [SONNET, HAIKU].map((m) => h('option', { value: m, selected: s.model === m }, m)))),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: s.haikuFirst, onchange: (e: Event) => set('haikuFirst', (e.target as HTMLInputElement).checked) }), 'Try Haiku first for PDFs; retry on the model above if unsure'),
      h('label', { class: 'field' }, h('span', {}, 'Effort'), h('select', { onchange: (e: Event) => set('effort', (e.target as HTMLSelectElement).value as Settings['effort']) }, ['low', 'medium', 'high'].map((m) => h('option', { value: m, selected: s.effort === m }, m)))),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: s.refusalFallback, onchange: (e: Event) => set('refusalFallback', (e.target as HTMLInputElement).checked) }), 'If Sonnet declines a document, let the API retry on a fallback model'),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Default times'),
      h('div', { class: 'grid2' },
        txt('departOffsetMin', 'Departure vs outbound boarding (min)', 'number'),
        txt('returnOffsetMin', 'Return vs inbound arrival (min)', 'number'),
        txt('defaultFlightMin', 'Flight time if arrival not printed (min)', 'number'),
        h('span'),
        txt('workStartTime', 'Work starts (HH:mm)'),
        txt('workEndTime', 'Work ends (HH:mm)'),
      ),
    ),
    h('div', { class: 'card' },
      h('h3', {}, 'Receipts should be made out to'),
      txt('unitName', 'Unit name'),
      txt('unitTaxId', 'Unit tax ID (leave empty to skip the check)'),
    ),
  ];
}

// ---------------- start ----------------

(async () => {
  S.settings = await loadSettings();
  render();
  readTrip();
})();
