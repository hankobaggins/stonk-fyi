import Link from "next/link";
import { notFound } from "next/navigation";
import { isWalletAddress } from "@/lib/wallet-rewards-math";
import { loadWalletAgg, viewOf } from "@/lib/wallet-rewards";
import { fmtUsd, nowMs, shortAddr } from "@/lib/format";
import { OG_VERSION_MS, SITE_URL } from "@/lib/site";
import RewardsLookup from "@/components/RewardsLookup";
import WalletRewards from "@/components/WalletRewards";

// /rewards/{wallet} — the wallet rewards check (§6o). The server renders whatever is stored (never waits on a scan,
// rule 14); the client streams a fresh or incremental scan and shows the share cards. The link's preview image is the
// total card, versioned per 5 minutes so a re-share shows today's figure.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/rewards/[wallet]">) {
  const { wallet } = await params;
  if (!isWalletAddress(wallet)) return { title: "Wallet rewards" };
  const agg = await loadWalletAgg(wallet).catch(() => null);
  const who = shortAddr(wallet, 4);
  if (!agg || agg.payouts === 0) {
    return { title: `${who} · StonkFun rewards check`, description: "How much StonkFun's holder rewards have paid this wallet, read from the chain.", robots: { index: false } };
  }
  const v = await viewOf(agg).catch(() => null);
  const title = v ? `${who} has been paid ${fmtUsd(v.totalUsd)} in StonkFun holder rewards` : `${who} · StonkFun rewards`;
  const img = `/rewards-card/${wallet}?kind=total&v=${Math.floor(nowMs() / OG_VERSION_MS)}`;
  return {
    title,
    description: "Every payout is an on-chain transfer from StonkFun's reward wallets. Check yours at stonk.fyi/rewards.",
    robots: { index: false },
    openGraph: { title, images: [{ url: img, width: 1600, height: 900 }] },
    twitter: { card: "summary_large_image", title, images: [img] },
  };
}

export default async function WalletRewardsPage({ params }: PageProps<"/rewards/[wallet]">) {
  const { wallet } = await params;
  if (!isWalletAddress(wallet)) notFound();
  const agg = await loadWalletAgg(wallet).catch(() => null);
  const initial = agg ? await viewOf(agg).catch(() => null) : null;

  return (
    <div className="space-y-5">
      <nav className="num text-xs text-muted flex gap-2" aria-label="Breadcrumb">
        <Link href="/rewards" className="text-secondary hover:text-primary">Rewards</Link><span>/</span><span className="text-primary">{shortAddr(wallet, 4)}</span>
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-4 border-b border-border">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">StonkFun holder rewards</h1>
          <p className="text-[13px] text-muted">
            Paid to <a href={`https://solscan.io/account/${wallet}`} target="_blank" rel="noopener noreferrer" className="num text-secondary hover:text-accent break-all">{wallet} ↗</a>
          </p>
        </div>
        <div className="w-full sm:w-[440px]"><RewardsLookup /></div>
      </div>
      <WalletRewards wallet={wallet} initial={initial} siteUrl={SITE_URL} />
    </div>
  );
}
