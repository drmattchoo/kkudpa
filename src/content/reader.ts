// Reads trip context, entitlements and the claim table from the trip form.
import type { ClaimRow, TripContext } from '../shared/types';
import { LABELS, REQUIRED_PANEL_LABELS } from '../config/labels';
import { parseMoney, parseSlashDate } from '../shared/dates';
import { controlCells, findButton, findControl, findGrid, findLabel } from './k2';
import { isVisible, norm } from './dom';

function inputNear(label: string, exact = true): string | null {
  try {
    const lab = findLabel(label, { root: document, visibleOnly: false, exact });
    if (!lab) return null;
    for (const cell of controlCells(lab)) {
      const input = [...cell.querySelectorAll<HTMLInputElement>('input[type=text]')].find((i) => isVisible(i)) ?? null;
      if (input) return input.classList.contains('watermark') ? null : input.value;
      const text = norm(cell.textContent);
      if (text) return text;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function moneyNear(label: string, exact = true) {
  return parseMoney(inputNear(label, exact));
}

const stripHtml = (html: string) => {
  const d = new DOMParser().parseFromString(html, 'text/html');
  return norm(d.body.textContent);
};

export function readTripContext(): TripContext {
  const tripNo = inputNear(LABELS.tripNo)?.match(LABELS.tripNoPattern)?.[0] ?? document.body.innerText.match(LABELS.tripNoPattern)?.[0] ?? null;

  const act = findGrid(LABELS.activityGridHeaders);
  const dates = (h: string) => (act?.rows ?? []).map((r) => parseSlashDate(r.get(h)?.text)).filter((d): d is string => !!d).sort();
  const first = act?.rows[0];
  const col = (h: string) => first?.get(h)?.text || null;

  const trav = findGrid(LABELS.travellerGridHeaders);
  const trow = trav?.rows.find((r) => r.tr.classList.contains('selected')) ?? trav?.rows[0];
  const tv = (h: string) => trow?.get(h) ?? null;

  const hist = findGrid(LABELS.historyGridHeaders);
  const financeNotes = (hist?.rows ?? [])
    .map((r) => ({
      actor: r.get(LABELS.colHistoryActor)?.text ?? '',
      action: r.get(LABELS.colHistoryAction)?.text ?? '',
      comment: stripHtml(r.get(LABELS.colHistoryComment)?.value ?? ''),
      when: r.get(LABELS.colHistoryWhen)?.text ?? '',
    }))
    .filter((n) => n.comment);

  return {
    tripNo,
    departDate: dates(LABELS.colDepartDate)[0] ?? null,
    startDate: dates(LABELS.colStartDate)[0] ?? null,
    endDate: dates(LABELS.colEndDate).at(-1) ?? null,
    returnDate: dates(LABELS.colReturnDate).at(-1) ?? null,
    province: col(LABELS.colProvince),
    workLocation: col(LABELS.colWorkLocation),
    purpose: col(LABELS.colPurpose),
    estimate: {
      perDiem: moneyNear(LABELS.estPerDiem),
      hotel: moneyNear(LABELS.estHotel),
      vehicle: moneyNear(LABELS.estVehicle),
      other: moneyNear(LABELS.estOther),
      requested: moneyNear(LABELS.estRequested),
    },
    traveller: trow
      ? {
          name: tv(LABELS.colTravellerName)?.text ?? null,
          entitlement: tv(LABELS.colEntitlement)?.text ?? null,
          perDiemRate: parseMoney(tv(LABELS.colPerDiemRate)?.value || tv(LABELS.colPerDiemRate)?.text),
          roomType: tv(LABELS.colRoomType)?.text ?? null,
          roomRate: parseMoney(tv(LABELS.colRoomRate)?.value || tv(LABELS.colRoomRate)?.text),
        }
      : null,
    financeNotes,
    summaryClaimed: moneyNear(LABELS.summaryClaimed),
  };
}

export function readClaimTable(): ClaimRow[] {
  const g = findGrid(LABELS.claimGridHeaders);
  if (!g) return [];
  const num = (v: string | undefined) => (v ? parseMoney(v) : null);
  return g.rows.map((r) => ({
    name: r.get(LABELS.colClaimName)?.text ?? '',
    item: r.get(LABELS.colClaimItem)?.text ?? '',
    evidence: r.get(LABELS.colClaimEvidence)?.text ?? '',
    signedBy: r.get(LABELS.colClaimSignedBy)?.text ?? '',
    days: num(r.get(LABELS.colClaimDays)?.value),
    nights: num(r.get(LABELS.colClaimNights)?.value),
    amount: num(r.get(LABELS.colClaimAmount)?.value || r.get(LABELS.colClaimAmount)?.text),
    times: stripHtml(r.get(LABELS.colClaimTimes)?.value ?? ''),
  }));
}

export interface SelfTestItem {
  what: string;
  ok: boolean;
}

/** Checks every label and grid the driver needs exists before filling (spec §10). */
export function selfTest(): SelfTestItem[] {
  const items: SelfTestItem[] = [];
  for (const l of REQUIRED_PANEL_LABELS) {
    const ok = l === LABELS.btnAddLine || l === LABELS.btnClear ? !!findButton(l) : !!findLabel(l, { root: document, visibleOnly: false });
    items.push({ what: l, ok });
  }
  items.push({ what: 'Traveller grid', ok: !!findGrid(LABELS.travellerGridHeaders) });
  items.push({ what: 'Claim table', ok: !!findGrid(LABELS.claimGridHeaders) });
  items.push({ what: 'Activity dates grid', ok: !!findGrid(LABELS.activityGridHeaders) });
  let fileInput = false;
  try {
    const w = findControl<HTMLElement>(LABELS.evidence, '.file-wrapper', { root: document, visibleOnly: false, visibleControl: false });
    const id = w.querySelector('label.file-label')?.getAttribute('for');
    fileInput = !!(id && document.getElementById(id));
  } catch {
    /* not found */
  }
  items.push({ what: `${LABELS.evidence} file input`, ok: fileInput });
  return items;
}
