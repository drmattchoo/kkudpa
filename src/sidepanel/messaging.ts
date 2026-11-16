import type { ContentRequest, ContentResponse } from '../shared/messages';

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function toContent(msg: ContentRequest): Promise<ContentResponse> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url?.startsWith('https://dpa.kku.ac.th/')) {
    return { ok: false, error: 'Open the trip in DPA (dpa.kku.ac.th) in this tab first.' };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { ...msg, target: 'content' });
  } catch {
    // The content script is not there yet (tab opened before install): inject it.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tab.id, { ...msg, target: 'content' });
  }
}
