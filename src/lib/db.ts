import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PoolFlow } from "./types";

// Returns null when Supabase isn't configured so the app runs fine as a pure API-poller.
export function getDb(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}


// Net STONK flow through the pool over a window, from recorded reserve snapshots.
// Positive netStonkIntoPool = more STONK sold into the pool than bought out (net selling).
export async function getPoolFlow(poolId: string, hours = 24, stonkPriceUsd?: number): Promise<PoolFlow | null> {
  const db = getDb();
  if (!db) return null;
  const since = new Date(Date.now() - hours * 3.6e6).toISOString();
  const { data, error } = await db
    .from("pool_snapshots")
    .select("ts, stonk_reserve")
    .eq("pool_id", poolId)
    .gte("ts", since)
    .order("ts", { ascending: true });
  if (error || !data || data.length < 2) return null;
  const first = data[0];
  const last = data[data.length - 1];
  const net = (last.stonk_reserve ?? 0) - (first.stonk_reserve ?? 0);
  return {
    from: first.ts,
    to: last.ts,
    stonkReserveStart: first.stonk_reserve,
    stonkReserveEnd: last.stonk_reserve,
    netStonkIntoPool: net,
    netStonkUsd: net * (stonkPriceUsd ?? 0),
    samples: data.length,
  };
}
