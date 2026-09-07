-- GMGN-derived STONK snapshots (holder count, concentration, wallet-tag counts, buy/sell volume).
-- One row per worker tick; drives the holder-growth indicator once 24h of history exists.
create table if not exists gmgn_snapshots (
  ts                 timestamptz primary key,
  price_usd          double precision,
  holder_count       integer,
  top10_holder_rate  double precision,
  smart_wallets      integer,
  kol_wallets        integer,
  whale_wallets      integer,
  buy_volume_24h_usd double precision,
  sell_volume_24h_usd double precision,
  buys_24h           integer,
  sells_24h          integer,
  liquidity_usd      double precision
);
alter table gmgn_snapshots enable row level security;
