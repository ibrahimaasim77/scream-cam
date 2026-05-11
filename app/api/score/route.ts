import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { redis, todayKey } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 16;
const MAX_SCORE = 100;

function clean(name: string) {
  return name.replace(/[^\p{L}\p{N}_\-. ]/gu, "").slice(0, MAX_NAME).trim() || "anon";
}

export async function GET() {
  const key = todayKey();
  const raw = await redis.zrange<string[]>(key, 0, 9, { rev: true, withScores: true });
  const entries: { name: string; score: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const member = String(raw[i]);
    const score = Number(raw[i + 1]);
    const name = member.split(":")[0] ?? "anon";
    entries.push({ name, score });
  }
  return NextResponse.json({ entries, day: key.replace("screams:", "") });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = clean(String(body.name ?? "anon"));
  const score = Math.max(0, Math.min(MAX_SCORE, Number(body.score) || 0));
  const key = todayKey();
  const member = `${name}:${nanoid(6)}`;
  await redis.zadd(key, { score, member });
  await redis.expire(key, 60 * 60 * 36);
  return NextResponse.json({ ok: true, name, score });
}
