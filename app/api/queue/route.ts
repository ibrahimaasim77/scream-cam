import { NextRequest, NextResponse } from "next/server";
import {
  cleanGender,
  cleanName,
  joinQueue,
  leaveQueue,
  newUserId,
} from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = cleanName(body.name);
  const gender = cleanGender(body.gender);
  const userId = newUserId();
  const result = await joinQueue({ userId, name, gender });
  return NextResponse.json({ userId, ...result });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return NextResponse.json({ ok: false }, { status: 400 });
  await leaveQueue(userId);
  return NextResponse.json({ ok: true });
}
