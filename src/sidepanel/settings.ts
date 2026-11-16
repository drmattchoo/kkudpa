import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

// chrome.storage.local only. Never sync storage: the API key must not leave this profile.
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}

/** Proxy mode: ask for host access to the proxy origin only (optional permission). */
export async function grantProxyAccess(proxyUrl: string): Promise<boolean> {
  const u = new URL(proxyUrl);
  if (u.protocol !== 'https:') throw new Error('The proxy URL must use https.');
  return chrome.permissions.request({ origins: [`${u.origin}/*`] });
}
