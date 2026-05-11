import { NextRequest, NextResponse } from "next/server";
import { drainInbox } from "@/lib/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ messages: [] }, { status: 400 });
  }
  const messages = await drainInbox(userId);
  return NextResponse.json({ messages });
}
