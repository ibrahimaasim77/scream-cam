import Link from "next/link";
import { Leaderboard } from "./components/Leaderboard";
import { redis, todayKey } from "@/lib/redis";

export const revalidate = 30;

async function getTopOfDay(): Promise<{ name: string; score: number } | null> {
  try {
    const raw = await redis.zrange<string[]>(todayKey(), 0, 0, {
      rev: true,
      withScores: true,
    });
    if (!raw || raw.length < 2) return null;
    const member = String(raw[0]);
    const score = Number(raw[1]);
    return { name: member.split(":")[0] ?? "anon", score };
  } catch {
    return null;
  }
}

export default async function Home() {
  const top = await getTopOfDay();

  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-10 gap-10">
      {/* FOMO banner */}
      {top ? (
        <div className="w-full max-w-md rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-center text-sm">
          <span className="text-zinc-400">today&apos;s loudest:</span>{" "}
          <span className="text-white font-bold">@{top.name}</span>{" "}
          <span className="text-red-400 font-black tabular-nums">{top.score}</span>{" "}
          <span className="text-zinc-500">— beat it ↓</span>
        </div>
      ) : (
        <div className="w-full max-w-md rounded-full border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-center text-sm text-zinc-500">
          board is empty. be the first.
        </div>
      )}

      <header className="text-center max-w-md">
        <h1 className="text-6xl sm:text-7xl font-black text-white tracking-tight leading-none">
          scream<span className="text-red-500">.</span>cam
        </h1>
        <p className="text-zinc-200 mt-5 text-xl font-bold leading-tight">
          Scream louder than a random stranger.
          <br />
          <span className="text-zinc-500 font-normal">Or lose.</span>
        </p>
        <p className="text-zinc-500 mt-3 text-xs">
          1v1 live webcam. 5 seconds. Loudest wins. Download the clip.
        </p>
      </header>

      <section className="w-full max-w-md flex flex-col gap-3">
        <Link
          href="/versus"
          className="group relative overflow-hidden rounded-2xl border-2 border-red-500 bg-gradient-to-br from-red-500 to-orange-500 px-6 py-7 transition-transform hover:scale-[1.02] shadow-[0_0_32px_rgba(239,68,68,0.35)]"
        >
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-3xl font-black text-white">⚔ 1V1 VERSUS</div>
              <div className="text-sm text-white/80 mt-1">Real stranger. Live cam. Loudest wins.</div>
            </div>
            <div className="text-4xl text-white">→</div>
          </div>
        </Link>

        <Link
          href="/solo"
          className="group rounded-2xl border border-zinc-800 bg-zinc-900/40 px-6 py-4 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-base font-bold text-zinc-300">Solo practice</div>
              <div className="text-xs text-zinc-500 mt-0.5">just check your score</div>
            </div>
            <div className="text-zinc-600 group-hover:text-white transition-colors">→</div>
          </div>
        </Link>
      </section>

      <Leaderboard />

      <footer className="text-xs text-zinc-600 mt-2 max-w-sm text-center">
        we don&apos;t keep your audio or video. clips are generated in your browser
        and never uploaded.
      </footer>
    </main>
  );
}
