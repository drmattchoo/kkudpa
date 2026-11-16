// Small DOM helpers for the K2 page. No IDs: K2 element IDs are GUIDs that change
// between releases (spec §3).

import { DENY_BUTTONS } from '../config/labels';

export const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').replace(/\s*[:：]\s*$/, '').replace(/(…|\.\.\.)$/, '').trim();

export function isVisible(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (!el.isConnected || el.getClientRects().length === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TimeoutError extends Error {}

/** Polls until predicate returns a truthy value (spec §5.7: K2 recalculates asynchronously). */
export async function waitFor<T>(predicate: () => T | null | undefined | false, timeout = 10_000, what = 'condition', interval = 100): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  for (;;) {
    try {
      const v = predicate();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new TimeoutError(`Timed out after ${timeout} ms waiting for ${what}${last ? `: ${(last as Error).message}` : ''}`);
    await sleep(interval);
  }
}

/** Waits until the value stops changing for `quiet` ms. */
export async function settle<T>(read: () => T, quiet = 400, timeout = 8_000): Promise<T> {
  const end = Date.now() + timeout;
  let v = read();
  let since = Date.now();
  while (Date.now() < end) {
    await sleep(100);
    const n = read();
    if (JSON.stringify(n) !== JSON.stringify(v)) {
      v = n;
      since = Date.now();
    } else if (Date.now() - since >= quiet) return v;
  }
  return v;
}

export class DeniedActionError extends Error {}

/** Throws if the element is, or is inside, a control whose text is on the deny list (spec §2 rule 1). */
export function assertNotDenied(el: Element) {
  const btn = el.closest('a, button, input[type=button], input[type=submit], [role=button]') ?? el;
  const texts = [btn.textContent, (btn as HTMLInputElement).value, btn.getAttribute('title'), btn.getAttribute('aria-label')].map(norm);
  for (const t of texts) {
    if (!t) continue;
    for (const deny of DENY_BUTTONS) {
      if (t.includes(deny)) throw new DeniedActionError(`Refusing to press "${deny}". The person submits and saves.`);
    }
  }
}

/** Clicks like a user: pointer and mouse events, then click. Checks the deny list first. */
export function userClick(el: Element) {
  assertNotDenied(el);
  const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  (el as HTMLElement).click();
}

/** Sets an input's value so framework listeners see it: focus, value, input, keyup, change, blur. */
export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  assertNotDenied(input);
  input.focus();
  input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, text);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', code: 'Tab', keyCode: 9 } as KeyboardEventInit));
  input.blur();
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

export function highlight(el: Element | null, on = true) {
  if (!(el instanceof HTMLElement)) return;
  if (on) {
    el.dataset.kkuOutline = el.style.outline;
    el.style.outline = '3px solid #e8590c';
    el.style.outlineOffset = '2px';
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } else {
    el.style.outline = el.dataset.kkuOutline ?? '';
    delete el.dataset.kkuOutline;
  }
}
