import { communityCardResponse } from "@/lib/community-card-response";

// GET /community-card → 1600×900 PNG: what StonkFun Community Mode coins have sent to holders of their quote tokens,
// all quote assets (§6p, hand-posted). /community-card/{quoteMint} is one quote asset. `?format=json` returns the data.
// 503 when the DB is unset or nothing is recorded yet.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return communityCardResponse(req, null);
}
