"use client";

import { useSyncExternalStore } from "react";
import { getMutedServer, isMuted, setMuted, subscribeMuted } from "@/lib/alerts";

// Footer control so a muted reader can turn buyback toasts back on.
export default function AlertsToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, getMutedServer);
  return (
    <button type="button" onClick={() => setMuted(!muted)} className="hover:text-primary underline underline-offset-2">
      Buyback alerts: {muted ? "off" : "on"}
    </button>
  );
}
