import type { Metadata } from "next";
import { OG_SIZE, SITE_NAME } from "@/lib/site";

// Link previews for the static pages (2026-10-01). Each page gets a static title card from /og/{key}
// (lib/page-card.tsx draws it) plus its own og/twitter title, description, URL and canonical. Before this the
// pages inherited the layout's openGraph block wholesale: the home card, home's title and description, and a
// canonical of "/". The cards carry no live figures, so their URLs need no version param. The home page keeps
// the live /og card from layout.tsx.

export type PageKey = "platform" | "flywheel" | "tokens" | "pairs" | "launches" | "runners" | "rewards" | "holders" | "about";

export type PageSpec = {
  path: string;
  group?: string; // nav group (lib/nav.ts), shown on the card's masthead
  label: string; // nav label
  cardTitle: string; // the headline on the card
  description: string; // one sentence: on the card, and the og/meta description unless metaDescription is set
  metaDescription?: string;
};

export const PAGE_SPECS: Record<PageKey, PageSpec> = {
  platform: { path: "/platform", group: "Platform", label: "Overview", cardTitle: "Platform overview", description: "The StonkFun launchpad on Solana: fee revenue and its pace, burns by source, launch activity and the top tokens." },
  flywheel: { path: "/flywheel", group: "Platform", label: "Flywheel", cardTitle: "Flywheel", description: "Fee revenue → buybacks → burns, from StonkFun's ledger, with every transaction linked for verification." },
  tokens: { path: "/tokens", group: "Ecosystem", label: "Tokens & yield", cardTitle: "Tokens & yield", description: "Every StonkFun token, searchable and sortable, with what reward coins have paid their holders as an APR." },
  pairs: { path: "/pairs", group: "Ecosystem", label: "Pairs", cardTitle: "Pairs", description: "What StonkFun tokens are priced against, which stock tokens have a price after the close, and one company at two prices." },
  launches: { path: "/launches", group: "Ecosystem", label: "Launches", cardTitle: "Launches", description: "The launch ledger, newest first: launches per hour, the mode and launchpad split, and the graduation line." },
  runners: {
    path: "/runners", group: "Ecosystem", label: "Runners", cardTitle: "Runners",
    description: "Tokens crossing $1M to $100M market cap, counted once per token per line, from the moment they cross.",
    metaDescription: "StonkFun tokens crossing $1M, $5M, $10M, $25M, $50M and $100M market cap, counted once each, from the moment they cross.",
  },
  rewards: { path: "/rewards", group: "Ecosystem", label: "Rewards & wallet check", cardTitle: "Holder rewards", description: "Reward coins pay their trading fees to holders. See the payouts, and check what any wallet has been paid." },
  holders: { path: "/holders", group: "Ecosystem", label: "Holders", cardTitle: "Holders across the StonkFun ecosystem", description: "Every quote asset with a reward coin launched against it: its holders, the wallets StonkFun pays, and how both move." },
  about: {
    path: "/about", label: "About", cardTitle: "Methodology & data sources",
    description: "What is measured, where it comes from, how fresh it is, and what this site does not know.",
    metaDescription: "How stonk.fyi computes every number: data sources, the bull-case scorecard thresholds, the projection model, and what the site does not know.",
  },
};

export const PAGE_KEYS = Object.keys(PAGE_SPECS) as PageKey[];
export const isPageKey = (k: string): k is PageKey => k in PAGE_SPECS;
export const pageCardPath = (key: PageKey) => `/og/${key}`;

// `title` is the page's <title> (the layout template appends " · stonk.fyi"). openGraph and twitter are replaced,
// not merged, when a page sets them, so every field the layout sets is restated here.
export function pageMetadata(key: PageKey, title: string): Metadata {
  const p = PAGE_SPECS[key];
  const description = p.metaDescription ?? p.description;
  const ogTitle = `${title} · ${SITE_NAME}`;
  const image = { url: pageCardPath(key), ...OG_SIZE, alt: `${p.cardTitle}: ${p.description}`, type: "image/png" };
  return {
    title,
    description,
    alternates: { canonical: p.path },
    openGraph: { type: "website", siteName: SITE_NAME, title: ogTitle, description, url: p.path, images: [image] },
    twitter: { card: "summary_large_image", title: ogTitle, description, images: [image] },
  };
}
