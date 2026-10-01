"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isWalletAddress } from "@/lib/wallet-rewards-math";

// The paste box for the wallet rewards check (§6o): a Solana address → /rewards/{address}. `big` is the hero version
// on /rewards; the small one sits on a result page to check another wallet.
export default function RewardsLookup({ big = false, initial = "" }: { big?: boolean; initial?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [bad, setBad] = useState(false);
  const go = (raw: string) => {
    const addr = raw.trim().replace(/^solana:/i, "").split(/[?\s]/)[0];
    if (!isWalletAddress(addr)) {
      setBad(true);
      return;
    }
    setBad(false);
    router.push(`/rewards/${addr}`);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
      className="flex flex-col gap-1.5 w-full"
      role="search"
    >
      <div className={`flex gap-2 ${big ? "flex-col sm:flex-row" : ""}`}>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setBad(false);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (isWalletAddress(t.trim())) {
              e.preventDefault();
              setValue(t.trim());
              go(t);
            }
          }}
          placeholder="Paste a Solana wallet address"
          aria-label="Solana wallet address"
          aria-invalid={bad}
          spellCheck={false}
          autoComplete="off"
          className={`num flex-1 min-w-0 rounded-md border bg-surface-1 px-3 text-primary placeholder:text-muted outline-none focus:border-accent ${bad ? "border-down" : "border-border-strong"} ${big ? "h-12 text-[15px]" : "h-9 text-[13px]"}`}
        />
        <button type="submit" className={`btn-check rounded-md font-medium whitespace-nowrap ${big ? "h-12 px-6 text-[15px]" : "h-9 px-4 text-[13px]"}`}>
          Check rewards
        </button>
      </div>
      {bad && <p className="num text-xs text-down">That isn&apos;t a Solana wallet address (32–44 characters, no 0, O, I or l).</p>}
    </form>
  );
}
