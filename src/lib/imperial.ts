// Imperial perps referral link (added 2026-09-16). The second trade CTA on the site, beside the JTX
// spot button: a perpetuals venue for $STONK, with the owner's referral code so sign-ups started here
// are attributed. Client-safe (the Nav renders it); one place for the URL.

export const IMPERIAL_REF = "HANKO";
// `to` sends the visitor straight to the STONK perps market after the referral is recorded.
export const IMPERIAL_URL = `https://www.imperial.space/refer/${IMPERIAL_REF}?to=/perps/stonk`;
