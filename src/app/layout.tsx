import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import Nav from "@/components/Nav";
import Ticker from "@/components/Ticker";
import BuybackToasts from "@/components/BuybackToasts";
import AlertsToggle from "@/components/AlertsToggle";
import WalletLink from "@/components/WalletLink";
import { getStonkData } from "@/lib/stonk";
import { OG_SIZE, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL, ogImageUrl, X_HANDLE, X_URL } from "@/lib/site";
import { nowMs } from "@/lib/format";

// Metadata is generated per request so the social card URL carries the current 5-minute
// version bucket (see ogImageUrl). Scrapers cache the image by URL; a stable URL meant a
// stale price on every share.
export async function generateMetadata(): Promise<Metadata> {
  const title = `${SITE_NAME}: ${SITE_TAGLINE}`;
  const image = { url: ogImageUrl(nowMs()), ...OG_SIZE, alt: title, type: "image/png" };
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: SITE_NAME, title, description: SITE_DESCRIPTION, url: "/", images: [image] },
    twitter: { card: "summary_large_image", title, description: SITE_DESCRIPTION, images: [image] },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Nav mark + ticker need STONK's headline numbers on every page. Failure here must never
  // take the page down, so fall back to a ring at 0% and no ticker.
  const d = await getStonkData().catch(() => null);
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <head>
        {/* Umami (cloud.umami.is): cookieless page-view analytics. Auto-tracks App Router navigations. */}
        <Script defer src="https://cloud.umami.is/script.js" data-website-id="f14b334c-5d8e-4f06-be7e-ba8f41ca0d00" strategy="afterInteractive" />
      </head>
      <body className="min-h-full flex flex-col">
        <Nav burnedPct={d?.supply.burnedPct ?? 0} />
        {d && <Ticker d={d} />}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">{children}</main>
        <footer className="border-t border-border mt-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="text-secondary">stonk.fyi</span> is unofficial and not affiliated with StonkFun. Data: StonkFun public API, Raydium, CoinGecko.</span>
            <span>USD figures are StonkFun&apos;s own pricing; burn amounts and tx signatures are on-chain.</span>
            <span>Not financial advice.</span>
            <Link href="/about" className="hover:text-primary underline underline-offset-2">Methodology &amp; sources</Link>
            <a href={X_URL} target="_blank" rel="noopener noreferrer" className="hover:text-primary underline underline-offset-2">@{X_HANDLE} on X</a>
            <WalletLink />
            <AlertsToggle />
          </div>
        </footer>
        <BuybackToasts />
      </body>
    </html>
  );
}
