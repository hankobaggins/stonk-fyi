import type { ReactNode } from "react";
import type { Token } from "@/lib/types";
import { getTokenHolders, TOKEN_HOLDERS_TTL_MIN } from "@/lib/token-holders";
import { fmtNum, timeAgo } from "@/lib/format";
import HolderBase from "./HolderBase";
import { Section } from "./ui";

// Token-page holder base (CLAUDE.md §6l): HolderScan's profile of the coin, streamed behind Suspense so the rest of the
// page never waits on it. Every state that is not a profile says why, in one line — absence is a state, not a gap.

const HOLDERSCAN_URL = "https://holderscan.com/token/";

function Empty({ mint, state, children }: { mint: string; state: string; children: ReactNode }) {
  return (
    <Section title="Holder base" action={<span className="num text-[11px] text-muted">HolderScan · <a href={`${HOLDERSCAN_URL}${mint}`} target="_blank" rel="noreferrer" className="hover:text-primary">HolderScan ↗</a></span>}>
      <div className="rounded-md border border-dashed border-border-strong px-4 py-5 flex flex-col items-center text-center gap-1.5">
        <span className="state collecting">{state}</span>
        <span className="text-[13px] text-secondary max-w-[60ch]">{children}</span>
      </div>
    </Section>
  );
}

export default async function TokenHolders({ token: t, now }: { token: Token; now: number }) {
  const r = await getTokenHolders(t);
  const m = t.market ?? {};
  switch (r.state) {
    case "ok":
      return (
        <HolderBase
          h={r.history}
          mint={t.mint}
          symbol={t.symbol}
          marketCapUsd={m.marketCapUsd ?? null}
          priceUsd={m.priceUsd ?? null}
          now={now}
          cadence={r.source === "stored" ? undefined : `live · ${TOKEN_HOLDERS_TTL_MIN} min cache`}
          notice={r.synthetic ? "Synthetic sample (fixture mode): scaled from the STONK sample, not data." : undefined}
        />
      );
    case "bonding":
      return (
        <Empty mint={t.mint} state="at graduation">
          HolderScan lists a StonkFun token within minutes of graduation. {t.symbol} is still on the bonding curve
          {t.graduationProgress !== undefined ? <span className="num"> ({fmtNum((t.graduationProgress ?? 0) * 100, 0)}%)</span> : null}.
        </Empty>
      );
    case "not-listed": {
      const minsSince = r.graduatedAt ? (now - Date.parse(r.graduatedAt)) / 60000 : null;
      return minsSince !== null && minsSince < 60 ? (
        <Empty mint={t.mint} state="listing">
          Graduated {timeAgo(r.graduatedAt, now)}; HolderScan usually lists a new graduate within minutes. This block checks again every few minutes.
        </Empty>
      ) : (
        <Empty mint={t.mint} state="not tracked">HolderScan does not track {t.symbol} yet, so there is no holder profile to show.</Empty>
      );
    }
    case "unavailable":
      if (r.reason === "disabled") return null;
      return r.reason === "budget" ? (
        <Empty mint={t.mint} state="rationed">HolderScan reads for token pages are capped per hour to protect the site&apos;s API budget. This profile loads on a later refresh.</Empty>
      ) : (
        <Empty mint={t.mint} state="unavailable">HolderScan didn&apos;t answer for {t.symbol}. It retries with the page.</Empty>
      );
  }
}

export function TokenHoldersSkeleton() {
  return (
    <section className="card p-4" aria-busy="true" aria-label="Loading holder base">
      <div className="skeleton h-3.5 w-28 mb-3" />
      <div className="kpis gap-x-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[74px]" />)}
      </div>
      <div className="skeleton h-40 w-full mt-4" />
    </section>
  );
}
