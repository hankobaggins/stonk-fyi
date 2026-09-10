import { jtxTradeUrl } from "@/lib/jtx";

/*
 * The one call-to-action on the site: a trade link to JTX carrying the stonk.fyi referral code.
 * Server-safe (plain anchor). `size` picks the hero treatment (filled, large) or the compact nav
 * pill; both use the teal accent fill, which nothing else on the site uses as a background, so the
 * button reads as the single actionable element without borrowing a status color.
 */
export default function BuyButton({
  mint,
  symbol = "$STONK",
  size = "md",
  className = "",
}: {
  mint: string;
  symbol?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "h-8 px-3 text-[12px] gap-1.5 rounded-md",
    md: "h-10 px-4 text-[13px] gap-2 rounded-md",
    lg: "h-12 px-6 text-[15px] gap-2.5 rounded-lg",
  }[size];
  return (
    <a
      href={jtxTradeUrl(mint)}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className={`btn-buy inline-flex items-center justify-center font-semibold whitespace-nowrap ${sizes} ${className}`}
    >
      Buy {symbol}
      <span className="opacity-80 font-medium">on JTX ↗</span>
    </a>
  );
}

/* Table-cell variant: a small accent link so every token listed on the site has a JTX trade link. */
export function TradeLink({ mint, label = "Buy ↗" }: { mint: string; label?: string }) {
  return (
    <a
      href={jtxTradeUrl(mint)}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="btn-buy inline-flex items-center h-6 px-2 rounded text-[11px] font-semibold whitespace-nowrap"
    >
      {label}
    </a>
  );
}
