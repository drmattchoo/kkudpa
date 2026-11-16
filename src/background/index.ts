// Service worker: opens the side panel and runs extraction calls. Documents go only to
// the configured model endpoint and nothing is stored (spec §2 rule 6).
import type { WorkerRequest, WorkerResponse } from '../shared/messages';
import { DEFAULT_SETTINGS, type Settings } from '../shared/types';
import { extract } from '../extraction/client';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function loadSettings(): Promise<Settings> {
  // Local storage only: the API key never goes to sync storage.
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

chrome.runtime.onMessage.addListener((msg: WorkerRequest & { target?: string }, _sender, sendResponse) => {
  if (msg?.target !== 'worker' || msg.type !== 'extract') return false;
  (async (): Promise<WorkerResponse> => {
    try {
      const s = await loadSettings();
      const r = await extract(msg.file, s);
      return { ok: true, doc: r.doc, model: r.model, attempts: r.attempts };
    } catch (e) {
      return { ok: false, error: describe(e) };
    }
  })().then(sendResponse);
  return true;
});

function describe(e: unknown): string {
  const err = e as { status?: number; message?: string };
  if (err.status === 401) return 'The API key was rejected (401). Check Settings.';
  if (err.status === 403) return 'Access denied (403). In proxy mode, sign in to KKU in this browser.';
  if (err.status === 429) return 'Rate limited (429). Wait a minute and retry.';
  if (err.status === 413) return 'The file is too large for one request.';
  return err.message ?? String(e);
}
