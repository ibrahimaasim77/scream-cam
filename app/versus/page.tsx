"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Gender = "male" | "female" | "other";
type Phase = "form" | "waiting" | "matched" | "error";

export default function VersusPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("male");
  const [error, setError] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (userIdRef.current) {
      fetch(`/api/queue?userId=${encodeURIComponent(userIdRef.current)}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onUnload = () => cleanup();
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      cancelledRef.current = true;
      cleanup();
    };
  }, [cleanup]);

  const goToMatch = useCallback(
    (matchId: string, role: "caller" | "callee") => {
      if (!userIdRef.current) return;
      const params = new URLSearchParams({
        userId: userIdRef.current,
        role,
      });
      router.push(`/match/${matchId}?${params.toString()}`);
    },
    [router],
  );

  const pollInbox = useCallback(async () => {
    if (!userIdRef.current || cancelledRef.current) return;
    try {
      const r = await fetch(
        `/api/inbox?userId=${encodeURIComponent(userIdRef.current)}`,
        { cache: "no-store" },
      );
      const data = await r.json();
      for (const msg of (data.messages ?? []) as Array<{
        type: string;
        matchId?: string;
        role?: "caller" | "callee";
      }>) {
        if (msg.type === "matched" && msg.matchId && msg.role) {
          setPhase("matched");
          if (pollRef.current) clearInterval(pollRef.current);
          goToMatch(msg.matchId, msg.role);
          return;
        }
      }
    } catch {
      // transient — keep polling
    }
  }, [goToMatch]);

  const onJoin = async () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Pick a name first");
      return;
    }
    setPhase("waiting");
    try {
      const r = await fetch("/api/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, gender }),
      });
      const data = await r.json();
      userIdRef.current = data.userId;
      if (data.status === "matched" && data.matchId) {
        setPhase("matched");
        goToMatch(data.matchId, data.role);
        return;
      }
      // wait — start polling for "matched" message
      pollRef.current = setInterval(pollInbox, 1500);
    } catch {
      setError("Could not reach matchmaking");
      setPhase("error");
    }
  };

  const onCancel = () => {
    cleanup();
    userIdRef.current = null;
    setPhase("form");
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-12 gap-8">
      <Link
        href="/"
        className="self-start text-sm text-zinc-500 hover:text-white transition-colors"
      >
        ← back
      </Link>

      <header className="text-center max-w-md">
        <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
          1v1 <span className="text-red-500">scream</span>
        </h1>
        <p className="text-zinc-400 mt-3 text-sm">
          Real opponent. Live webcam. Loudest wins.
        </p>
      </header>

      {phase === "form" && (
        <div className="w-full max-w-sm flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-zinc-500">name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="anon"
              maxLength={16}
              className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
            />
          </label>

          <fieldset className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-zinc-500">gender</span>
            <div className="grid grid-cols-3 gap-2">
              {(["male", "female", "other"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={`py-3 rounded-lg border text-sm font-bold capitalize transition-colors ${
                    gender === g
                      ? "bg-red-500 border-red-500 text-white"
                      : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={onJoin}
            className="w-full py-4 rounded-lg bg-red-500 hover:bg-red-400 text-white font-black text-lg"
          >
            Find opponent
          </button>

          <p className="text-xs text-zinc-600 text-center mt-2">
            You&apos;ll need to allow camera + microphone access.
          </p>
        </div>
      )}

      {phase === "waiting" && (
        <div className="w-full max-w-sm flex flex-col items-center gap-6 mt-4">
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 rounded-full border-4 border-red-500/30" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-red-500 animate-spin" />
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-white">Looking for opponent…</div>
            <div className="text-sm text-zinc-500 mt-2">
              Open this on another device to test, or wait for a random pairing.
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-sm text-zinc-400 hover:text-white py-2"
          >
            cancel
          </button>
        </div>
      )}

      {phase === "matched" && (
        <div className="text-center">
          <div className="text-2xl font-bold text-white">Match found! Loading arena…</div>
        </div>
      )}

      {phase === "error" && (
        <div className="w-full max-w-sm flex flex-col items-center gap-4">
          <p className="text-red-400">{error ?? "Something went wrong"}</p>
          <button
            onClick={() => {
              setError(null);
              setPhase("form");
            }}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white"
          >
            try again
          </button>
        </div>
      )}
    </main>
  );
}
