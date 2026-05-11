import Link from "next/link";
import { ScreamCam } from "../components/ScreamCam";
import { Leaderboard } from "../components/Leaderboard";

export default function SoloPage() {
  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-12 gap-10">
      <Link
        href="/"
        className="self-start text-sm text-zinc-500 hover:text-white transition-colors"
      >
        ← back
      </Link>
      <header className="text-center">
        <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
          solo<span className="text-red-500">.</span>scream
        </h1>
        <p className="text-zinc-400 mt-2 max-w-sm mx-auto text-sm">
          5 seconds. One scream. Land on the daily board.
        </p>
      </header>
      <ScreamCam />
      <Leaderboard />
    </main>
  );
}
