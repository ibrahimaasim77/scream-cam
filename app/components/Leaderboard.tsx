"use client";

import { useCallback, useEffect, useState } from "react";

type Entry = { name: string; score: number };

export function Leaderboard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/score", { cache: "no-store" });
      const data = await res.json();
      setEntries(data.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const onSubmit = () => load();
    window.addEventListener("scream:submitted", onSubmit);
    const id = setInterval(load, 15000);
    return () => {
      window.removeEventListener("scream:submitted", onSubmit);
      clearInterval(id);
    };
  }, [load]);

  return (
    <div className="w-full max-w-md">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Today&apos;s loudest</h2>
        <span className="text-xs text-zinc-500">resets at 00:00 UTC</span>
      </div>
      <ol className="flex flex-col gap-1">
        {loading && <li className="text-sm text-zinc-500">Loading…</li>}
        {!loading && entries.length === 0 && (
          <li className="text-sm text-zinc-500">Be the first.</li>
        )}
        {entries.map((e, i) => (
          <li
            key={`${e.name}-${i}`}
            className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-900/60 border border-zinc-800"
          >
            <span className="flex items-center gap-3">
              <span className="w-6 text-zinc-500 font-mono text-sm">{i + 1}</span>
              <span className="text-white font-medium">@{e.name}</span>
            </span>
            <span className="text-white font-black tabular-nums">{e.score}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
