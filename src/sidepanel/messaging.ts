import type { ContentRequest, ContentResponse } from '../shared/messages';

const DPA = 'https://dpa.kku.ac.th/';

/** The DPA tab to work on: the active tab if it is DPA, else the most recently used DPA tab. */
export async function dpaTab(): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith(DPA)) return active;
  const tabs = await chrome.tabs.query({ url: `${DPA}*` });
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

export async function toContent(msg: ContentRequest): Promise<ContentResponse> {
  const tab = await dpaTab();
  if (!tab?.id) return { ok: false, error: 'Open the trip in DPA (dpa.kku.ac.th) first.' };
  try {
    return await chrome.tabs.sendMessage(tab.id, { ...msg, target: 'content' });
  } catch {
    // The content script is not there yet (tab opened before install): inject it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tab.id, { ...msg, target: 'content' });
  }
}
