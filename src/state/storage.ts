/**
 * Saving, loading and autosave.
 *
 * Everything is client-side: a Blob download for save, a file input for load,
 * and localStorage for the "don't lose my work on refresh" case. No server is
 * involved, which is why the app can be opened from a file:// build too.
 */

import { parseDesign, serializeDesign, type Design } from './schema';

const AUTOSAVE_KEY = 'spiro.autosave.v1';

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: revoking synchronously can cancel the download in
  // some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilename = (name: string): string =>
  name.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'design';

export function saveDesignFile(design: Design): void {
  downloadText(`${safeFilename(design.name)}.json`, serializeDesign(design));
}

export function openDesignFile(): Promise<{ design?: Design; error?: string; name?: string }> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve({ error: 'No file chosen' });
      try {
        const text = await file.text();
        resolve({ ...parseDesign(text), name: file.name });
      } catch (e) {
        resolve({ error: `Could not read the file: ${(e as Error).message}` });
      }
    };
    input.click();
  });
}

let autosaveTimer: number | undefined;

/** Debounced so dragging a slider does not write to storage on every frame. */
export function scheduleAutosave(design: Design, delayMs = 600): void {
  if (autosaveTimer !== undefined) window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(AUTOSAVE_KEY, serializeDesign(design));
    } catch {
      // Private mode, or storage full. Autosave is a convenience, not a
      // guarantee, so this is not worth interrupting the user over.
    }
  }, delayMs);
}

export function loadAutosave(): Design | null {
  try {
    const text = window.localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return null;
    return parseDesign(text).design ?? null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    window.localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* see scheduleAutosave */
  }
}
