import { nanoid } from "nanoid";
import { redis } from "./redis";

export type Gender = "male" | "female" | "other";

export type QueueUser = {
  userId: string;
  name: string;
  gender: Gender;
};

export type MatchRecord = {
  id: string;
  caller: { userId: string; name: string; gender: Gender };
  callee: { userId: string; name: string; gender: Gender };
  callerScore: number | null;
  calleeScore: number | null;
  createdAt: number;
};

export type InboxMessage =
  | { type: "matched"; matchId: string; role: "caller" | "callee"; peer: { name: string; gender: Gender } }
  | { type: "signal"; from: string; payload: unknown };

const QUEUE_KEY = "queue:matchmaking";
const QUEUE_TTL = 90;
const MATCH_TTL = 60 * 30;
const INBOX_TTL = 90;

export function newUserId() {
  return `u_${nanoid(10)}`;
}

export function newMatchId() {
  return `m_${nanoid(10)}`;
}

function queueUserKey(userId: string) {
  return `queue:user:${userId}`;
}

function inboxKey(userId: string) {
  return `inbox:${userId}`;
}

function matchKey(matchId: string) {
  return `match:${matchId}`;
}

export function cleanName(raw: unknown) {
  return String(raw ?? "")
    .replace(/[^\p{L}\p{N}_\-. ]/gu, "")
    .slice(0, 16)
    .trim() || "anon";
}

export function cleanGender(raw: unknown): Gender {
  const s = String(raw ?? "").toLowerCase();
  if (s === "male" || s === "female") return s;
  return "other";
}

export async function pushInbox(userId: string, msg: InboxMessage) {
  await redis.rpush(inboxKey(userId), JSON.stringify(msg));
  await redis.expire(inboxKey(userId), INBOX_TTL);
}

export async function drainInbox(userId: string): Promise<InboxMessage[]> {
  const key = inboxKey(userId);
  const raw = (await redis.lrange<string>(key, 0, -1)) ?? [];
  if (raw.length === 0) return [];
  await redis.del(key);
  return raw
    .map((s) => {
      if (typeof s === "string") {
        try {
          return JSON.parse(s) as InboxMessage;
        } catch {
          return null;
        }
      }
      // Upstash sometimes auto-parses JSON
      return s as unknown as InboxMessage;
    })
    .filter((m): m is InboxMessage => m !== null);
}

export async function getMatch(matchId: string): Promise<MatchRecord | null> {
  const data = await redis.get<MatchRecord | string>(matchKey(matchId));
  if (!data) return null;
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as MatchRecord;
    } catch {
      return null;
    }
  }
  return data;
}

export async function setMatch(match: MatchRecord) {
  await redis.set(matchKey(match.id), JSON.stringify(match), { ex: MATCH_TTL });
}

export async function submitScore(
  matchId: string,
  userId: string,
  score: number,
): Promise<MatchRecord | null> {
  const match = await getMatch(matchId);
  if (!match) return null;
  if (match.caller.userId === userId) match.callerScore = score;
  else if (match.callee.userId === userId) match.calleeScore = score;
  else return match;
  await setMatch(match);
  return match;
}

/**
 * Atomically: pop one waiting user from the queue. If found, pair them with the
 * new joiner and create a match record + notify the waiting user via inbox.
 * Otherwise push the new user to the queue and store their metadata.
 *
 * Returns either { status: "matched", matchId, role, peer } for an instant pairing,
 * or { status: "waiting", userId } when this user is now waiting.
 */
export async function joinQueue(
  user: QueueUser,
): Promise<
  | { status: "matched"; matchId: string; role: "caller" | "callee"; peer: { name: string; gender: Gender } }
  | { status: "waiting" }
> {
  const waitingId = await redis.lpop<string>(QUEUE_KEY);
  if (waitingId && waitingId !== user.userId) {
    const peerRaw = await redis.get<QueueUser | string>(queueUserKey(waitingId));
    let peer: QueueUser | null = null;
    if (peerRaw) {
      peer = typeof peerRaw === "string" ? (JSON.parse(peerRaw) as QueueUser) : peerRaw;
    }
    if (peer) {
      await redis.del(queueUserKey(waitingId));
      const matchId = newMatchId();
      // waiting user becomes caller (they were here first), new user becomes callee
      const match: MatchRecord = {
        id: matchId,
        caller: { userId: peer.userId, name: peer.name, gender: peer.gender },
        callee: { userId: user.userId, name: user.name, gender: user.gender },
        callerScore: null,
        calleeScore: null,
        createdAt: Date.now(),
      };
      await setMatch(match);
      await pushInbox(peer.userId, {
        type: "matched",
        matchId,
        role: "caller",
        peer: { name: user.name, gender: user.gender },
      });
      return {
        status: "matched",
        matchId,
        role: "callee",
        peer: { name: peer.name, gender: peer.gender },
      };
    }
    // stale entry — fall through and join queue ourselves
  }
  await redis.set(queueUserKey(user.userId), JSON.stringify(user), { ex: QUEUE_TTL });
  await redis.rpush(QUEUE_KEY, user.userId);
  await redis.expire(QUEUE_KEY, QUEUE_TTL);
  return { status: "waiting" };
}

export async function leaveQueue(userId: string) {
  await redis.lrem(QUEUE_KEY, 0, userId);
  await redis.del(queueUserKey(userId));
}
