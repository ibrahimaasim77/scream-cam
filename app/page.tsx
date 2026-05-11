import { ScreamCam } from "./components/ScreamCam";
import { Leaderboard } from "./components/Leaderboard";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-16 gap-16">
      <header className="text-center">
        <h1 className="text-5xl sm:text-6xl font-black text-white tracking-tight">
          scream<span className="text-red-500">.</span>cam
        </h1>
        <p className="text-zinc-400 mt-3 max-w-sm mx-auto">
          5 seconds. One scream. One score. Top the leaderboard.
        </p>
      </header>
      <ScreamCam />
      <Leaderboard />
      <footer className="text-xs text-zinc-600 mt-8">
        we don&apos;t record audio. only the peak volume leaves your device.
      </footer>
    </main>
  );
}
