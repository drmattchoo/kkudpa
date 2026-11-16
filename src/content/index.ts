// Content script on dpa.kku.ac.th. Reads the trip form and drives the claim panel on
// request from the side panel. Never saves or submits.
import type { ContentEvent, ContentRequest, ContentResponse } from '../shared/messages';
import { readClaimTable, readTripContext, selfTest } from './reader';
import { clearPanel, fillLine } from './driver';
import { listDropdownOptions, selectRadio } from './k2';
import { LABELS } from '../config/labels';
import { base64ToBytes } from '../pdf/hash';
import * as k2 from './k2';
import * as dom from './dom';

declare const __TEST_HOOKS__: boolean;

const isTripForm = () => /KKU\.BusinessTrip\.Input\.Form/i.test(location.href) || !!k2.panelRoot();

function emit(ev: ContentEvent) {
  try {
    chrome.runtime?.sendMessage?.(ev)?.catch?.(() => {});
  } catch {
    /* side panel closed */
  }
}

let busy = false;

export async function handle(msg: ContentRequest): Promise<ContentResponse> {
  try {
    switch (msg.type) {
      case 'ping':
        return { ok: true, type: 'pong', url: location.href, isTripForm: isTripForm() };
      case 'read-context':
        return { ok: true, type: 'context', ctx: readTripContext(), rows: readClaimTable(), selfTest: selfTest() };
      case 'self-test':
        return { ok: true, type: 'self-test', items: selfTest() };
      case 'list-item-options':
        await selectRadio(LABELS.category, msg.category);
        return { ok: true, type: 'options', options: await listDropdownOptions(LABELS.item) };
      case 'clear-panel':
        clearPanel();
        return { ok: true, type: 'done' };
      case 'fill-line': {
        if (busy) return { ok: false, error: 'Already filling a line' };
        busy = true;
        try {
          const report = await fillLine(msg.line, {
            add: msg.add,
            evidence: msg.evidence ? { bytes: base64ToBytes(msg.evidence.base64), filename: msg.evidence.filename } : undefined,
            onStep: (step) => emit({ type: 'fill-step', lineId: msg.line.id, step }),
            onNeedManualAttach: () => emit({ type: 'manual-attach-needed', lineId: msg.line.id, filename: msg.evidence?.filename ?? '' }),
          });
          return { ok: true, type: 'fill-report', report };
        } finally {
          busy = false;
        }
      }
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg: ContentRequest & { target?: string }, _sender, sendResponse) => {
    if (msg?.target !== 'content') return false;
    handle(msg).then(sendResponse);
    return true;
  });
}

if (__TEST_HOOKS__) {
  (window as unknown as Record<string, unknown>).__kkuDpa = { handle, k2, dom, readTripContext, readClaimTable, selfTest, fillLine };
}
