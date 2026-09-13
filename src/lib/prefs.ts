// Tiny per-browser preferences (localStorage) exposed as an external store, so client components read them with
// useSyncExternalStore and the server render never disagrees with the first client render.
const listeners = new Set<() => void>();

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private window, blocked) — the setting just doesn't persist */
  }
  for (const l of listeners) l();
}

export function subscribePrefs(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
