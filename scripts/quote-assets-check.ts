// Offline check of the quote-asset math (§6m): npx tsx --tsconfig tsconfig.json scripts/quote-assets-check.ts
import { buildChecks, countVenues, groupSameAsset, oracleFor, turnover, underlyingTicker, usMarketOpen, type PythFeedLists } from "../src/lib/quote-math";

const assert = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL ${msg}`); process.exit(1); } console.log(`ok   ${msg}`); };
const feeds: PythFeedLists = { us: ["SPY", "AAPL", "NVDA", "MCD", "BOT"], index: ["NVDA", "AAPL", "US500", "OPENAI"], crypto: ["TAO", "DOGE"] };

assert(underlyingTicker({ symbol: "APPLX", category: "xstock" }, "AAPLx") === "AAPL", "xStocks: Jupiter's symbol wins over StonkFun's typo");
assert(underlyingTicker({ symbol: "SPYX", category: "xstock" }, null) === "SPY", "xStocks: StonkFun symbol minus X when Jupiter is missing");
assert(underlyingTicker({ symbol: "ROBOSTRATEGY", category: "backpack" }, "BOT") === "ROBOSTRATEGY", "Backpack: StonkFun's symbol, not Jupiter's colliding one");
assert(oracleFor("NVDA", "xstock", feeds).state === "247", "NVDA has an always-on feed");
assert(oracleFor("SPY", "xstock", feeds).state === "proxy", "SPY: only the S&P 500 index is always-on");
assert(oracleFor("MCD", "xstock", feeds).state === "hours", "MCD: session feed only");
assert(oracleFor("OPENAI", "tessera", feeds).state === "247", "OPENAI: always-on index feed");
assert(oracleFor("KALSHI", "prestock", feeds).state === "none", "KALSHI: no feed");
assert(oracleFor("TAO", "backpack", feeds).state === "crypto", "Backpack TAO is crypto");
assert(oracleFor("TAO", "xstock", feeds).state === "none", "only Backpack assets are reclassified as crypto");
assert(countVenues({ raydium: 7.9e6, orca: 5.9e5, meteora: 38e3, pumpfun: 0 }).join() === "raydium,orca,meteora", "venues: DEXes with ≥$1K, deepest first");
assert(turnover(10, 0) === null && turnover(50, 10) === 5, "turnover");

const g = groupSameAsset([
  { mint: "a", symbol: "tOpenAI", name: "OPENAI", category: "tessera", priceUsd: 2158, liquidityUsd: 1.1e6, volume24hUsd: 2e7, ticker: "OPENAI" },
  { mint: "b", symbol: "OPENAI", name: "OPENAI", category: "prestock", priceUsd: 1431, liquidityUsd: 8.7e5, volume24hUsd: 3e6, ticker: "OPENAI" },
  { mint: "c", symbol: "SPYx", name: "SP500", category: "xstock", priceUsd: 765, liquidityUsd: 5e6, volume24hUsd: 1e7, ticker: "SPY" },
  { mint: "d", symbol: "OPENAI2", name: "OPENAI", category: "custom", priceUsd: 1, liquidityUsd: 1, volume24hUsd: 1, ticker: "OPENAI2" },
  { mint: "e", symbol: "NVDAx", name: "NVIDIA", category: "xstock", priceUsd: 228, liquidityUsd: 3e6, volume24hUsd: 3e7, ticker: "NVDA" },
  { mint: "f", symbol: "NVDAx2", name: "NVIDIA", category: "xstock", priceUsd: 229, liquidityUsd: 1e3, volume24hUsd: 1, ticker: "NVDA" },
], feeds);
assert(g.length === 1, "one cross-issuer group (same-issuer duplicates and non-stock categories are not groups)");
assert(g[0].members.map((m) => m.mint).join() === "a,b", "OPENAI: Tessera + PreStocks, deepest first");
assert(Math.abs((g[0].spreadPct ?? 0) - 50.8) < 0.1, "spread = (max − min) ÷ min");
assert(!g[0].anyPublicFeed, "OPENAI is private: no session feed");

assert(usMarketOpen(Date.parse("2026-09-29T15:00:00Z")) === true, "Tue 11:00 ET open");
assert(usMarketOpen(Date.parse("2026-09-29T20:30:00Z")) === false, "Tue 16:30 ET closed");
assert(usMarketOpen(Date.parse("2026-09-27T15:00:00Z")) === false, "Sunday closed");
assert(usMarketOpen(Date.parse("2026-09-30T04:10:00Z")) === false, "00:10 ET closed (hour12:false midnight)");

const checks = buildChecks({ symbol: "SPYx", ticker: "SPY", issuerLabel: "xStocks", verified: true, liquidityUsd: 5e6, holders: 77_000, venues: ["raydium", "orca", "meteora"], oracle: oracleFor("SPY", "xstock", feeds), mintAuthority: true, freezeAuthority: true, marketOpen: false });
assert(checks.map((c) => c.key).join() === "issuer,liquidity,oracle,venues,holders,authority", "check order");
assert(checks.find((c) => c.key === "oracle")!.state === "neutral", "SPYx oracle check is the proxy state");
assert(checks.every((c) => c.detail.length > 0 && c.detail.length < 400), "every check has a one-to-two sentence detail");
console.log("all quote-asset checks passed");
