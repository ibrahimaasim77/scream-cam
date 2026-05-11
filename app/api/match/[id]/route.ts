import { NextRequest, NextResponse } from "next/server";
import { getMatch, submitScore } from "@/lib/match";
import { redis, todayKey } from "@/lib/redis";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const match = await getMatch(id);
  if (!match) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, match });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  const score = Math.max(0, Math.min(100, Math.round(Number(body.score) || 0)));
  if (!userId) return NextResponse.json({ ok: false }, { status: 400 });
  const match = await submitScore(id, userId, score);
  if (!match) return NextResponse.json({ ok: false }, { status: 404 });

  // also write to the daily solo leaderboard so versus screams still count
  const name = match.caller.userId === userId ? match.caller.name : match.callee.name;
  const member = `${name}:${nanoid(6)}`;
  await redis.zadd(todayKey(), { score, member });
  await redis.expire(todayKey(), 60 * 60 * 36);

  return NextResponse.json({ ok: true, match });
}
