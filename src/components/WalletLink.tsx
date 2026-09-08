"use client";

import { useState } from "react";
import { SITE_WALLET, SITE_WALLET_URL } from "@/lib/site";

// Footer wallet: Solscan link with the address truncated, plus click-to-copy the full address.
export default function WalletLink() {
  const [copied, setCopied] = useState(false);
  const short = `${SITE_WALLET.slice(0, 6)}…${SITE_WALLET.slice(-4)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SITE_WALLET);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (insecure context / permissions); the Solscan link still works
    }
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Tip jar:</span>
      <a
        href={SITE_WALLET_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={SITE_WALLET}
        className="num hover:text-primary underline underline-offset-2"
      >
        {short}
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy wallet address"
        className="label border border-border-strong rounded px-1 py-0.5 text-[10px] leading-none hover:text-primary"
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}
