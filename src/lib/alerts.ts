// Mute state for the buyback toasts, kept in localStorage and exposed as an external store
// so components read it with useSyncExternalStore (no setState-in-effect).
export const MUTE_KEY = "stonk.fyi:buyback-toasts:muted";
const MUTE_EVENT = "stonk.fyi:buyback-toasts:mute-change";

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function setMuted(v: boolean) {
  try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); } catch { /* private mode */ }
  window.dispatchEvent(new Event(MUTE_EVENT));
}
export function subscribeMuted(cb: () => void) {
  window.addEventListener(MUTE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(MUTE_EVENT, cb); window.removeEventListener("storage", cb); };
}
export const getMutedServer = () => false;
