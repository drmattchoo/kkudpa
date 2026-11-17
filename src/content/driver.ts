// Fills one planned claim line into the DPA claim panel (spec §7.5).
// Order: traveller row, category, item, times, amounts, evidence, read back DPA's
// computed amount, compare with the plan, and press เพิ่มรายการขอเบิก only if they match
// and the caller asked for it. It never saves or submits.

import type { PlannedLine } from '../shared/types';
import { CATEGORY_LABELS, LABELS, LEAVE_NONE } from '../config/labels';
import { parseMoney } from '../shared/dates';
import {
  attachFile, clickButton, findGrid, findLabel, readDataLabels, readDropdown, readInput, readMoneyLabel,
  selectDropdown, selectGridRow, selectRadio, setNumber, setText, typeDateTime, panelRoot,
} from './k2';
import { isVisible, settle, waitFor } from './dom';
import { readClaimTable, selfTest, selfTestBlocks } from './reader';
import { findExisting } from '../rules/checks';

export interface FillStep {
  step: string;
  ok: boolean;
  detail?: string;
}

export interface FillReport {
  lineId: string;
  status: 'added' | 'filled' | 'skipped-duplicate' | 'mismatch' | 'error';
  steps: FillStep[];
  expected: number;
  computed: number | null;
  attachMode?: 'auto' | 'manual';
  signedBy?: string;
  error?: string;
}

export interface FillOptions {
  /** Press เพิ่มรายการขอเบิก after a match. false = dry run (milestone 5). */
  add: boolean;
  evidence?: { bytes: Uint8Array; filename: string };
  onStep?: (s: FillStep) => void;
  onNeedManualAttach?: () => void;
  attachAutoTimeout?: number;
  manualAttachTimeout?: number;
  signedByTimeout?: number;
}

const EPS = 0.005;

export async function fillLine(line: PlannedLine, opts: FillOptions): Promise<FillReport> {
  const steps: FillStep[] = [];
  const report: FillReport = { lineId: line.id, status: 'error', steps, expected: line.amount, computed: null };
  const step = (s: string, ok = true, detail?: string) => {
    const st = { step: s, ok, ...(detail ? { detail } : {}) };
    steps.push(st);
    opts.onStep?.(st);
  };

  try {
    const missing = selfTestBlocks(selfTest());
    if (missing.length) throw new Error(`The page is missing: ${missing.map((m) => m.what).join(', ')}. Open the trip form itself (Open Form), or DPA may have changed.`);
    step('Self-test passed');

    const before = readClaimTable();
    const { duplicate } = findExisting(line, before);
    if (duplicate || line.duplicate) {
      step('Already in the claim table, skipped');
      report.status = 'skipped-duplicate';
      return report;
    }

    // 1. Traveller row fills ชื่อ - นามสกุล and Email.
    const trav = findGrid(LABELS.travellerGridHeaders);
    const row = trav?.rows.find((r) => r.tr.classList.contains('selected')) ?? trav?.rows[0];
    if (!row) throw new Error('No traveller row');
    await selectGridRow(row);
    await waitFor(() => readInput(LABELS.panelName), 8000, 'ชื่อ - นามสกุล to fill');
    step('Traveller selected', true, readInput(LABELS.panelName));

    // 2-3. Category and item.
    await selectRadio(LABELS.category, line.category);
    step(`หมวด: ${line.category}`);
    await waitFor(() => findLabel(LABELS.item, { root: panelRoot() ?? document }), 8000, 'รายการที่เบิก');
    await selectDropdown(LABELS.item, line.item);
    step(`รายการ: ${line.item}`);

    // DPA shows the amount fields and เป็นเงินจำนวน for the chosen category only now.
    for (const l of CATEGORY_LABELS[line.kind]) {
      await waitFor(() => findLabel(l, { root: panelRoot() ?? document }), 10_000, `the ${l} field to appear`);
    }

    // 4. Leave dropdown stays at ไม่มีการลา.
    const leave = readDropdown(LABELS.leave);
    step(`${LABELS.leave}: ${leave}`, leave === LEAVE_NONE, leave === LEAVE_NONE ? undefined : 'Not the default. Check it in DPA.');

    // 5. The four times.
    await typeDateTime(LABELS.tDepart, line.times.depart);
    await typeDateTime(LABELS.tStart, line.times.start);
    await typeDateTime(LABELS.tEnd, line.times.end);
    await typeDateTime(LABELS.tReturn, line.times.return);
    step('Times entered', true, `${line.times.depart} → ${line.times.return}`);

    // 6. Amounts per category.
    if (line.kind === 'per_diem') {
      const rate = parseMoney(readInput(LABELS.ratePerDay));
      if (line.ratePerDay != null && rate != null && Math.abs(rate - line.ratePerDay) > EPS) {
        step('Rate per day', false, `DPA ${rate}, plan ${line.ratePerDay}`);
        report.status = 'mismatch';
        return report;
      }
      const days = await settle(() => readDataLabels(LABELS.perDiemDays)[0] ?? '');
      step('DPA per diem days', Number(days) === line.days, `DPA ${days || '—'}, plan ${line.days}`);
    } else if (line.kind === 'hotel') {
      await setNumber(LABELS.nights, line.nights!);
      await setNumber(LABELS.ratePerNight, line.ratePerNight!);
      step('Nights and rate', true, `${line.nights} × ${line.ratePerNight}`);
    } else {
      await setNumber(LABELS.amount, line.amount);
      step('Amount', true, String(line.amount));
    }
    if (line.note) {
      await setText(LABELS.note, line.note);
      step('Note', true, line.note);
    }

    // 7. Evidence (not for per diem).
    if (line.evidenceFileIds.length) {
      if (!opts.evidence) throw new Error('Evidence file bytes were not provided');
      const r = await attachFile(LABELS.evidence, opts.evidence.bytes, opts.evidence.filename, {
        autoTimeout: opts.attachAutoTimeout,
        manualTimeout: opts.manualAttachTimeout,
        onManual: () => {
          step('Automatic attach was ignored by DPA. Click the highlighted box and choose the file.', false, opts.evidence!.filename);
          opts.onNeedManualAttach?.();
        },
      });
      report.attachMode = r.mode;
      step(`Evidence attached (${r.mode})`, true, r.shownName);
    }

    // 8. Read back DPA's computed amount.
    const computed = await settle(() => readMoneyLabel(LABELS.computedTotal));
    report.computed = computed;
    const match = computed != null && Math.abs(computed - line.amount) < EPS;
    step('DPA computed amount', match, `DPA ${computed ?? '—'}, plan ${line.amount}`);
    if (!match) {
      report.status = 'mismatch';
      return report;
    }

    if (!opts.add) {
      step('Dry run: line left in the panel, not added');
      report.status = 'filled';
      return report;
    }

    // 9. Add, then verify the new row.
    await clickButton(LABELS.btnAddLine);
    const added = await waitFor(() => {
      const rows = readClaimTable();
      return rows.length > before.length ? rows : null;
    }, 15_000, 'the new line in the claim table');
    const newRow = added.find((r) => r.item === line.item && r.amount != null && Math.abs(r.amount - line.amount) < EPS);
    step('Line added', !!newRow, newRow ? `${newRow.item} ${newRow.amount}` : 'New row does not match the plan');
    if (!newRow) {
      report.status = 'mismatch';
      return report;
    }
    if (line.evidenceFileIds.length) {
      try {
        const signed = await waitFor(() => readClaimTable().find((r) => r.item === line.item && r.amount === newRow.amount)?.signedBy, opts.signedByTimeout ?? 30_000, 'SIGNED BY');
        report.signedBy = signed;
        step('SIGNED BY', true, signed);
      } catch {
        step('SIGNED BY is empty. DPA did not read a signature from the upload.', false);
      }
    }
    report.status = 'added';
    return report;
  } catch (e) {
    report.error = (e as Error).message;
    step('Stopped', false, report.error);
    report.status = 'error';
    return report;
  }
}

export async function clearPanel() {
  await clickButton(LABELS.btnClear);
}

export function panelVisible() {
  return isVisible(panelRoot());
}
