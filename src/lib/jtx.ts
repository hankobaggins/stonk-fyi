// JTX affiliate links (added 2026-09-10). Every trade link on the site goes through JTX with the
// site's referral code so a purchase started here is attributed to stonk.fyi. Keep the code in one
// place; the URL shape is JTX's: https://app.jtx.com/?mint=<mint>&ref=<code>.
// No server-only imports here: the Nav (a client component) renders the button too, so the STONK
// mint is repeated rather than pulled from lib/api.ts (kept in sync with STONK_MINT there).

export const JTX_REF = "stonk";
export const JTX_BASE = "https://app.jtx.com/";

export const jtxTradeUrl = (mint: string): string => `${JTX_BASE}?mint=${encodeURIComponent(mint)}&ref=${JTX_REF}`;
export const STONK_MINT_PUBLIC = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";
export const JTX_STONK_URL = jtxTradeUrl(STONK_MINT_PUBLIC);
