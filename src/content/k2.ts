// K2 SmartForms adapter (spec §5.7), written against saved copies of the trip form.
//
// K2 layout: a form area is a CSS grid (div.Grid-Layout) of span.editor-cell children,
// in row order. A field's label is a span.SourceCode-Forms-Controls-Web-Label in one
// cell; its control is in the next cell(s) of the same row. Some cells hold several
// labels or controls and K2 shows the ones that apply to the chosen category.

import { LABELS } from '../config/labels';
import { assertNotDenied, highlight, isVisible, norm, settle, sleep, typeInto, userClick, waitFor } from './dom';
import { parseMoney } from '../shared/dates';

const LABEL_SEL = '.SourceCode-Forms-Controls-Web-Label';
const DATALABEL_SEL = '.SourceCode-Forms-Controls-Web-DataLabel';
const BUTTON_SEL = 'a.SourceCode-Forms-Controls-Web-Button, button';

export class ControlNotFound extends Error {}

/** The claim entry panel: the grid holding หมวดรายการที่เบิก. */
export function panelRoot(doc: Document = document): HTMLElement | null {
  const lab = findLabel(LABELS.category, { root: doc.body, visibleOnly: false });
  return (lab?.closest('div.Grid-Layout') as HTMLElement) ?? null;
}

export interface FindOpts {
  root?: ParentNode;
  visibleOnly?: boolean;
  exact?: boolean;
}

export function findLabel(text: string, opts: FindOpts = {}): HTMLElement | null {
  const { root = document, visibleOnly = true, exact = true } = opts;
  const want = norm(text);
  const all = [...root.querySelectorAll<HTMLElement>(LABEL_SEL)];
  const hit = (el: HTMLElement) => {
    const t = norm(el.textContent);
    return exact ? t === want : t.startsWith(want);
  };
  return all.find((el) => hit(el) && (!visibleOnly || isVisible(el))) ?? null;
}

/** The control cells after the label's cell, up to the end of that grid row. */
export function controlCells(label: HTMLElement): HTMLElement[] {
  const cell = label.closest('span.editor-cell');
  if (!cell) throw new ControlNotFound(`Label "${norm(label.textContent)}" is not inside a K2 cell`);
  const out: HTMLElement[] = [];
  let c = cell.nextElementSibling;
  while (c && c.matches('span.editor-cell')) {
    // After the first control cell, a cell led by its own visible label is the next field.
    const lead = c.querySelector<HTMLElement>(`:scope > ${LABEL_SEL}`);
    if (out.length > 0 && lead && isVisible(lead) && norm(lead.textContent)) break;
    out.push(c as HTMLElement);
    if (c.classList.contains('lastcellinrow')) break;
    c = c.nextElementSibling;
  }
  return out;
}

export function findControl<T extends Element>(labelText: string, selector: string, opts: FindOpts & { visibleControl?: boolean } = {}): T {
  const root = opts.root ?? panelRoot() ?? document;
  const label = findLabel(labelText, { ...opts, root });
  if (!label) throw new ControlNotFound(`Label not found: ${labelText}`);
  for (const cell of controlCells(label)) {
    const els = [...cell.querySelectorAll<T>(selector)];
    const el = opts.visibleControl === false ? els[0] : els.find((e) => isVisible(e));
    if (el) return el;
  }
  throw new ControlNotFound(`No ${selector} next to "${labelText}"`);
}

// ---------- radio ----------

export async function selectRadio(groupLabel: string, optionText: string) {
  const option = findControl<HTMLElement>(groupLabel, `label.input-control.radio[title="${cssEscape(optionText)}"]`);
  if (!option.classList.contains('checked')) {
    userClick(option);
    const input = option.querySelector('input[type=radio]') as HTMLInputElement | null;
    await waitFor(() => option.classList.contains('checked') || input?.checked, 8000, `radio ${optionText}`);
  }
}

export function readRadio(groupLabel: string): string | null {
  const checked = findControl<HTMLElement>(groupLabel, 'label.input-control.radio.checked', { visibleControl: false });
  return checked?.getAttribute('title') ?? null;
}

// ---------- K2 dropdown ----------

function dropdownBox(label: string) {
  return findControl<HTMLElement>(label, '.dropdown-box');
}

export function readDropdown(label: string): string {
  const box = dropdownBox(label);
  return norm(box.querySelector('.input-control-m')?.textContent ?? box.textContent);
}

export async function selectDropdown(label: string, optionText: string) {
  const box = dropdownBox(label);
  const want = norm(optionText);
  if (readDropdown(label) === want) return;
  if (box.classList.contains('read-only') || box.classList.contains('disabled')) {
    throw new ControlNotFound(`Dropdown "${label}" is read-only and shows "${readDropdown(label)}", not "${want}"`);
  }
  const opener = box.querySelector<HTMLElement>('a.input-control') ?? box.querySelector<HTMLElement>('.input-control-buttons a') ?? box;
  userClick(opener);
  // K2 renders the list at <body> level with id "<box id>_droplist".
  const item = await waitFor(() => {
    const menu = (box.id && document.getElementById(`${box.id}_droplist`)) || null;
    const scope: ParentNode = menu && isVisible(menu) ? menu : document;
    const lis = [...scope.querySelectorAll<HTMLElement>('ul.drop-menu > li')].filter(isVisible);
    return lis.find((li) => norm(li.getAttribute('title') ?? li.textContent) === want);
  }, 8000, `option "${want}" in ${label}`);
  userClick(item.querySelector('a') ?? item);
  await waitFor(() => readDropdown(label) === want, 8000, `${label} to show "${want}"`);
}

/** Options currently listed for a dropdown (opens and closes it). For discovery and self-test. */
export async function listDropdownOptions(label: string): Promise<string[]> {
  const box = dropdownBox(label);
  const opener = box.querySelector<HTMLElement>('a.input-control') ?? box;
  userClick(opener);
  const menu = await waitFor(() => {
    const m = document.getElementById(`${box.id}_droplist`);
    return m && isVisible(m) ? m : null;
  }, 5000, `${label} list`);
  const opts = [...menu.querySelectorAll('ul.drop-menu > li')].map((li) => norm(li.getAttribute('title') ?? li.textContent)).filter(Boolean);
  // Close it the way it was opened.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  if (isVisible(menu)) userClick(opener);
  return opts;
}

// ---------- text, numbers, dates ----------

export function readInput(label: string): string {
  const input = findControl<HTMLInputElement>(label, 'input[type=text], textarea');
  return input.classList.contains('watermark') ? '' : input.value;
}

export async function typeDateTime(label: string, beString: string) {
  const input = findControl<HTMLInputElement>(label, '.datetimepicker input[type=text], .calendar-control input[type=text]');
  typeInto(input, beString);
  await waitFor(() => norm(input.value) === norm(beString), 5000, `${label} to read ${beString}`);
  await sleep(150);
}

export function readDateTime(label: string): string {
  const input = findControl<HTMLInputElement>(label, '.datetimepicker input[type=text], .calendar-control input[type=text]');
  return norm(input.value);
}

/** Types a number into the text box next to the label. Integers stay integers. */
export async function setNumber(label: string, value: number) {
  const input = findControl<HTMLInputElement>(label, 'input[type=text]');
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
  // K2 text boxes show a watermark until focused.
  input.focus();
  input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await sleep(50);
  typeInto(input, text);
  await waitFor(() => parseMoney(input.value) === value, 5000, `${label} to read ${text}`);
}

export async function setText(label: string, text: string) {
  const el = findControl<HTMLTextAreaElement | HTMLInputElement>(label, 'textarea, input[type=text]');
  typeInto(el, text);
}

/** Reads the visible data labels next to a label, e.g. เป็นเงินจำนวน -> ["4,500.00"]. */
export function readDataLabels(label: string): string[] {
  const root = panelRoot() ?? document;
  const lab = findLabel(label, { root });
  if (!lab) throw new ControlNotFound(`Label not found: ${label}`);
  for (const cell of controlCells(lab)) {
    const vals = [...cell.querySelectorAll<HTMLElement>(DATALABEL_SEL)].filter(isVisible).map((e) => norm(e.textContent));
    if (vals.length) return vals;
  }
  return [];
}

export function readMoneyLabel(label: string): number | null {
  return parseMoney(readDataLabels(label)[0]);
}

// ---------- buttons ----------

export function findButton(text: string, root: ParentNode = document): HTMLElement | null {
  const want = norm(text);
  return [...root.querySelectorAll<HTMLElement>(BUTTON_SEL)].find((b) => norm(b.textContent) === want && isVisible(b)) ?? null;
}

export function clickButton(text: string) {
  const b = findButton(text);
  if (!b) throw new ControlNotFound(`Button not found: ${text}`);
  assertNotDenied(b);
  userClick(b);
}

// ---------- file attachment ----------

export type AttachResult = { mode: 'auto' | 'manual'; shownName: string };

function fileWrapper(label: string) {
  return findControl<HTMLElement>(label, '.file-wrapper');
}

export function attachedFileName(label: string): string {
  const w = fileWrapper(label);
  const info = w.querySelector<HTMLElement>('.file-info');
  return info && isVisible(info) ? norm(info.textContent) : '';
}

/**
 * Attaches the exact bytes the user supplied (spec §2 rule 2): builds a File, assigns
 * it to K2's hidden input[type=file] through DataTransfer and dispatches input and
 * change. If K2 ignores the synthetic event, highlights the attach box and waits for
 * the person to attach the file themselves (spec §5.7 fallback).
 */
export async function attachFile(label: string, bytes: Uint8Array, filename: string, opts: { autoTimeout?: number; manualTimeout?: number; onManual?: () => void } = {}): Promise<AttachResult> {
  const wrapper = fileWrapper(label);
  const forId = wrapper.querySelector('label.file-label')?.getAttribute('for');
  const input = (forId && document.getElementById(forId)) as HTMLInputElement | null;
  if (!input || input.type !== 'file') throw new ControlNotFound(`No file input behind "${label}"`);
  const accept = input.accept;
  if (accept && !accept.split(',').some((a) => filename.toLowerCase().endsWith(a.trim().toLowerCase()))) {
    throw new Error(`DPA accepts ${accept} only; ${filename} does not match`);
  }
  const shown = () => attachedFileName(label);
  const before = shown();
  try {
    const dt = new DataTransfer();
    dt.items.add(new File([bytes as BlobPart], filename, { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    const name = await waitFor(() => {
      const s = shown();
      return s && s !== before && s.includes(baseName(filename)) ? s : null;
    }, opts.autoTimeout ?? 20_000, `K2 to show ${filename}`);
    return { mode: 'auto', shownName: name };
  } catch {
    highlight(wrapper, true);
    opts.onManual?.();
    try {
      const name = await waitFor(() => {
        const s = shown();
        return s && s !== before ? s : null;
      }, opts.manualTimeout ?? 180_000, `you to attach ${filename}`, 500);
      return { mode: 'manual', shownName: name };
    } finally {
      highlight(wrapper, false);
    }
  }
}

const baseName = (f: string) => f.replace(/\.[^.]+$/, '');

// ---------- grids (K2 list views) ----------

export interface GridRow {
  tr: HTMLTableRowElement;
  /** header text -> {value from data-options, visible text} */
  get(header: string): { value: string; text: string } | null;
}

export interface Grid {
  el: HTMLElement;
  headers: { text: string; hidden: boolean }[];
  rows: GridRow[];
}

/** Finds the K2 list view whose column headers include all `required` headers. */
export function findGrid(required: readonly string[], root: ParentNode = document): Grid | null {
  for (const el of root.querySelectorAll<HTMLElement>('div.grid')) {
    const ht = el.querySelector('table.grid-column-header-table');
    if (!ht) continue;
    const cols = [...ht.querySelectorAll('col')];
    const cells = [...(ht.querySelector('tr')?.children ?? [])];
    const headers = cells.map((c, i) => ({ text: norm(c.textContent), hidden: cols[i]?.classList.contains('hidden') ?? false }));
    if (!required.every((r) => headers.some((h) => h.text === norm(r)))) continue;
    const rows: GridRow[] = [];
    for (const tr of el.querySelectorAll<HTMLTableRowElement>('table.grid-content-table tr')) {
      if (tr.classList.contains('empty-grid')) continue;
      const tds = [...tr.children] as HTMLElement[];
      rows.push({
        tr,
        get(header: string) {
          const want = norm(header);
          // prefer the visible column when a header appears twice
          const idx = headers.findIndex((h) => h.text === want && !h.hidden);
          const i = idx >= 0 ? idx : headers.findIndex((h) => h.text === want);
          const td = tds[i];
          if (!td) return null;
          let value = '';
          try {
            value = String(JSON.parse(td.getAttribute('data-options') ?? '{}').value ?? '');
          } catch {
            /* ignore */
          }
          return { value, text: norm(td.textContent) };
        },
      });
    }
    return { el, headers, rows };
  }
  return null;
}

export async function selectGridRow(row: GridRow) {
  const target = [...row.tr.children].find((td) => isVisible(td)) ?? row.tr;
  assertNotDenied(target);
  userClick(target);
  await waitFor(() => row.tr.classList.contains('selected') || row.tr.classList.contains('highlighted'), 5000, 'row selection');
}

export function cssEscape(s: string) {
  return s.replace(/["\\]/g, '\\$&');
}

export { settle };
