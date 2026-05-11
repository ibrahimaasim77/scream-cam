import Link from "next/link";
import { Leaderboard } from "./components/Leaderboard";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-16 gap-12">
      <header className="text-center max-w-md">
        <h1 className="text-5xl sm:text-7xl font-black text-white tracking-tight">
          scream<span className="text-red-500">.</span>cam
        </h1>
        <p className="text-zinc-400 mt-4 text-lg">
          The loudest person on the internet wins. Scream for 5 seconds, get a score 0–100.
        </p>
        <p className="text-zinc-500 mt-3 text-sm">
          90+ is rare. 100 is mythical.
        </p>
      </header>

      <section className="w-full max-w-md flex flex-col gap-4">
        <Link
          href="/solo"
          className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-8 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/0 via-red-500/0 to-red-500/20 opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-2xl font-black text-white">Check your score</div>
              <div className="text-sm text-zinc-400 mt-1">Solo scream. Daily leaderboard.</div>
            </div>
            <div className="text-3xl text-zinc-600 group-hover:text-white transition-colors">→</div>
          </div>
        </Link>

        <Link
          href="/versus"
          className="group relative overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-br from-red-500/20 to-orange-500/10 px-6 py-8 transition-all hover:border-red-500 hover:from-red-500/30"
        >
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-2xl font-black text-white">Verse someone else</div>
              <div className="text-sm text-zinc-300 mt-1">1v1 live webcam. Real opponent. Loudest wins.</div>
            </div>
            <div className="text-3xl text-red-300 group-hover:text-white transition-colors">⚔</div>
          </div>
        </Link>
      </section>

      <Leaderboard />

      <footer className="text-xs text-zinc-600 mt-4 max-w-sm text-center">
        we don&apos;t record audio. only the peak volume leaves your device.
      </footer>
    </main>
  );
}
