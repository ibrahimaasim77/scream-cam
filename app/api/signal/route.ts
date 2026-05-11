import { NextRequest, NextResponse } from "next/server";
import { pushInbox } from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const to = String(body.to ?? "");
  const from = String(body.from ?? "");
  const payload = body.payload;
  if (!to || !from || payload === undefined) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  await pushInbox(to, { type: "signal", from, payload });
  return NextResponse.json({ ok: true });
}
