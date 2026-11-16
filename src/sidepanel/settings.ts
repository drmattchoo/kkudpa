import { DEFAULT_SETTINGS, type Settings } from '../shared/types';

// chrome.storage.local only. Never sync storage: the API key must not leave this profile.
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  // Drop settings from the Anthropic build; reset a model id the gateway does not serve.
  for (const k of ['mode', 'proxyUrl', 'haikuFirst', 'effort', 'refusalFallback']) delete merged[k];
  if (typeof merged.model !== 'string' || merged.model.startsWith('claude-')) merged.model = DEFAULT_SETTINGS.model;
  return merged as unknown as Settings;
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}
