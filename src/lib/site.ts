// Public-site constants. NEXT_PUBLIC_SITE_URL overrides the canonical origin (e.g. on a preview deploy).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://stonk.fyi";
export const SITE_NAME = "stonk.fyi";
export const SITE_TAGLINE = "$STONK metrics, scored live";
export const OG_SUBTITLE = "Supply, buybacks, pool depth and a bull-case scorecard. Live, source-linked, unofficial.";
export const SITE_DESCRIPTION =
  "Live, source-linked metrics for $STONK, the platform token of the StonkFun launchpad on Solana: supply and burns, revenue-funded buybacks, pool depth, demand, and a bull-case scorecard that shows caution states too. Unofficial.";

// Social card geometry and URL. The card is rendered live by /og; the version param is the
// 5-minute bucket so link scrapers, which cache by URL, pick up a fresh render each window.
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_VERSION_MS = 5 * 60 * 1000;
export const ogImageUrl = (nowMs: number): string => `/og?v=${Math.floor(nowMs / OG_VERSION_MS)}`;

// Footer social links. The wallet is the site's own Solana address (tips / donations), not STONK's.
export const X_HANDLE = "stonk_fyi";
export const X_URL = `https://x.com/${X_HANDLE}`;
export const SITE_WALLET = "stonkdfAK55oc91ho3iXztDqijsSqjPAgQyNGRWZz8F";
export const SITE_WALLET_URL = `https://solscan.io/account/${SITE_WALLET}`;
