// Types for the StonkFun public API (https://www.stonkfun.xyz/api/public/v1)
// These are hand-derived from live responses; the API has no guaranteed contract,
// so everything non-essential is optional and the client is defensive.

export type ApiEnvelope<T> = { data: T; meta: { generatedAt: string } };

export type Quote = {
  mint: string;
  symbol: string;
  name?: string;
  logoUrl?: string;
  category?: string; // xstock | prestock | tessera | backpack | currency | custom | solana | leverage
  categoryLabel?: string;
  decimals?: number;
};

export type Market = {
  priceUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  volume24hUsd?: number;
  priceChange24h?: number;
  liquidityUsd?: number;
  peakMarketCapUsd?: number;
};

export type TokenStatus = "bonding" | "graduated" | string;

export type Token = {
  mint: string;
  pool?: string;
  name: string;
  symbol: string;
  quote: Quote;
  creator?: string;
  launchpad?: "raydium" | "launchlab" | string;
  mode?: "standard" | "reward" | string;
  quoteOnlyFees?: boolean;
  transferFee?: { bps: number };
  flywheel?: { active: boolean };
  imageUrl?: string;
  metadataUri?: string;
  links?: { website?: string; twitter?: string; telegram?: string };
  market?: Market;
  status: TokenStatus;
  graduationProgress?: number;
  graduatedAt?: string | null;
  createdAt: string;
};

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export type TokensResponse = { tokens: Token[]; pagination: Pagination; network: string };

export type Stats = {
  network: string;
  tokens: {
    poolsAvailable: boolean;
    total: number;
    graduated: number;
    aboutToGraduate: number;
    rewardLaunches: number;
    totalMarketCapUsd: number;
    totalVolume24hUsd: number;
  };
  revenue: { totalRevenueUsd: number; totalBuybackUsd: number };
  burns: { totalValueUsdAtBurn: number; burnCount: number };
  config: Record<string, number | boolean>;
};

export type BurnSource = { amountTokens: number; valueUsd: number; count: number };

export type Buyback = {
  signature: string;
  quote: { mint: string; symbol: string };
  spentTokens: number;
  spentValueUsd: number;
  boughtTokens: number;
  boughtValueUsd: number;
  burnSignature?: string;
  boughtAt: string;
};

export type Revenue = {
  revenue: {
    totalRevenueUsd: number;
    platformPairExcludedUsd?: number;
    totalBuybackUsd: number;
    boughtBackTokens: number;
    boughtBackValueUsd: number;
    buybackCount: number;
    lastBuybackAt: string;
  };
  burns: {
    totalValueUsdAtBurn: number;
    burnCount: number;
    mintCount: number;
    bySource: Record<string, BurnSource>;
  };
  config: { buybacksEnabled: boolean; buybackBurnEnabled: boolean };
  recentBuybacks: Buyback[];
};

export type RevenueDay = {
  date: string;
  dailyRevenue: number;
  dailyHoldersRevenue: number;
  dailyProtocolRevenue: number;
};

export type RevenueHistory = {
  network: string;
  unit: string;
  start: string;
  source: string;
  coverage: Record<string, number>;
  days: RevenueDay[];
};

export type Launch = {
  mint: string;
  pool?: string;
  name: string;
  symbol: string;
  creator?: string;
  quote: { mint: string; symbol: string };
  launchpad?: string;
  mode?: string;
  transferFee?: { bps: number };
  logoUrl?: string;
  startMarketCapUsd?: number;
  targetMarketCapUsd?: number;
  createdAt: string;
};

export type LaunchesResponse = { launches: Launch[]; pagination: Pagination };

export type RewardLaunch = {
  mint: string;
  quote: { mint: string; symbol: string; decimals?: number };
  distributedRaw?: string;
  distributedTokens: number;
  payoutCount: number;
  holderCount: number;
  lastPayoutAt: string;
};

export type RewardDistribution = {
  signature: string;
  mint: string;
  quoteMint: string;
  amountRaw?: string;
  amountTokens: number;
  holderCount: number;
  distributedAt: string;
};

export type RewardsResponse = { launches: RewardLaunch[]; recentDistributions?: RewardDistribution[] };

export type Pair = {
  mint: string;
  symbol: string;
  name?: string;
  category?: string;
  categoryLabel?: string;
  logoUrl?: string;
  launchable?: boolean;
  launchLabReady?: boolean;
};

export type PairsResponse = { pairs: Pair[] } | Pair[];

export type BurnEvent = {
  signature: string;
  symbol: string;
  amountTokens: number;
  valueUsdAtBurn: number;
  source: string;
  burnedAt: string;
};

export type TokenBurns = {
  mint: string;
  totals: { symbol: string; amountRaw?: string; amountTokens: number; valueUsdAtBurn: number; burnCount: number; lastBurnAt: string };
  burns: BurnEvent[];
};

// /tokens/{mint}/rewards — reward-mode launches pay trading fees to holders. Standard launches
// return { mode:"standard", rewards:null, message }.
export type TokenRewards = {
  mint: string;
  mode?: string;
  message?: string;
  quote?: { mint: string; symbol: string; decimals?: number };
  rewards: {
    distributedRaw?: string;
    distributedTokens: number;
    undistributedTokens?: number;
    payoutCount: number;
    holderCount: number;
    lastPayoutAt?: string | null;
  } | null;
};

// /tokens/{mint}/fees — creator-claimable fees. Reward coins return claimable:null with a reason.
export type ClaimableSide = { mint: string; symbol: string; amountRaw?: string; amountTokens: number; decimals?: number };
export type TokenFees = {
  mint: string;
  creator: string | null;
  claimable: { base: ClaimableSide; quote: ClaimableSide } | null;
  reason?: string;
  claimUrl?: string;
  claimApi?: string;
};

export type PricePoint = { ts: number; price: number; marketCap?: number; volume?: number };

export type PoolInfo = {
  id: string;
  type: string; // "Concentrated" | "Standard" | ...
  programId: string;
  mintA: { address: string; symbol: string; name?: string; decimals?: number };
  mintB: { address: string; symbol: string; name?: string; decimals?: number };
  price: number; // mintB per mintA
  mintAmountA: number;
  mintAmountB: number;
  feeRate: number;
  tvl: number;
  day?: { volume?: number; volumeFee?: number };
};

export type PoolFlow = {
  from: string;
  to: string;
  stonkReserveStart: number;
  stonkReserveEnd: number;
  netStonkIntoPool: number; // positive = net selling into the pool
  netStonkUsd: number;
  samples: number;
};
