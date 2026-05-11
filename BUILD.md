# Scream Cam — Build Handoff

A viral web app: user taps a button, screams into their mic for 5 seconds, gets a score 0–100, lands on a daily leaderboard, downloads a share image. Built to be spammable on TikTok/Reddit/Twitch.

This doc is the complete spec. A fresh Claude session should be able to read this file and finish the project without asking questions.

---

## Current state (already done — do not redo)

- Next.js 16 + React 19 + Tailwind v4 + TypeScript + App Router + Turbopack scaffolded at the repo root (this directory).
- Dependencies installed: `@upstash/redis`, `html-to-image`, `nanoid`.
- Files already written:
  - `lib/redis.ts` — Upstash client + `todayKey()` helper.
  - `app/api/score/route.ts` — `GET` returns top 10 today, `POST` submits a score.

## What's left (in order)

1. Write `app/components/ScreamCam.tsx` — client component, the whole mic-record-score-share flow.
2. Write `app/components/Leaderboard.tsx` — fetches `/api/score`, renders top 10.
3. Overwrite `app/page.tsx` — composes ScreamCam + Leaderboard, dark theme, hero copy.
4. Overwrite `app/layout.tsx` — metadata (title, OG image, description).
5. Overwrite `app/globals.css` — force dark, set background gradient.
6. Add `.env.local.example` with KV var names.
7. Run dev server and verify: mic permission prompt → record → score animates → leaderboard updates → share PNG downloads.
8. Init git, commit, deploy to Vercel, link Upstash via Marketplace.

---

## File contents

### `app/components/ScreamCam.tsx`

Client component. Uses `getUserMedia`, `AudioContext`, `AnalyserNode`. Tracks peak RMS over a 5-second window. Score = `Math.round(peakRms * 100)` clamped 0–100 (peakRms is already 0–1 from `getFloatTimeDomainData`). Steps the user through: idle → arming (mic prompt) → recording (live meter) → done (score animates up, share + retry buttons).

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";

type Phase = "idle" | "arming" | "recording" | "done" | "error";

const DURATION_MS = 5000;

export function ScreamCam() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0); // 0..1 live meter
  const [score, setScore] = useState(0); // final
  const [animatedScore, setAnimatedScore] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const shareCardRef = useRef<HTMLDivElement>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = async () => {
    setError(null);
    setSubmitted(false);
    setScore(0);
    setAnimatedScore(0);
    setPhase("arming");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const buf = new Float32Array(analyser.fftSize);
      let peak = 0;
      const startedAt = performance.now();
      setPhase("recording");

      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
        const rms = Math.sqrt(sumSq / buf.length);
        if (rms > peak) peak = rms;
        setLevel(Math.min(1, rms * 1.5));

        const elapsed = performance.now() - startedAt;
        if (elapsed >= DURATION_MS) {
          // Boost slightly so realistic peaks land in upper range
          const final = Math.max(0, Math.min(100, Math.round(peak * 130)));
          setScore(final);
          setPhase("done");
          animateTo(final);
          cleanup();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Mic blocked";
      setError(msg);
      setPhase("error");
      cleanup();
    }
  };

  const animateTo = (target: number) => {
    const startAt = performance.now();
    const dur = 1200;
    const step = () => {
      const t = Math.min(1, (performance.now() - startAt) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimatedScore(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const submit = async () => {
    if (submitted) return;
    const cleanName = name.trim() || "anon";
    try {
      await fetch("/api/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: cleanName, score }),
      });
      setSubmitted(true);
      window.dispatchEvent(new CustomEvent("scream:submitted"));
    } catch {
      setError("Could not submit score");
    }
  };

  const share = async () => {
    if (!shareCardRef.current) return;
    try {
      const dataUrl = await toPng(shareCardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#09090b",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `scream-${score}.png`;
      a.click();
    } catch {
      setError("Could not generate share image");
    }
  };

  return (
    <div className="w-full max-w-md flex flex-col items-center gap-8">
      {/* Big circular meter / button */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72">
        <div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-red-500 to-orange-500 blur-2xl transition-opacity duration-100"
          style={{ opacity: phase === "recording" ? 0.4 + level * 0.6 : 0.15 }}
        />
        <div
          className="absolute inset-0 rounded-full border-4 border-red-500/80 transition-transform duration-75"
          style={{
            transform: `scale(${phase === "recording" ? 1 + level * 0.15 : 1})`,
          }}
        />
        <button
          onClick={start}
          disabled={phase === "arming" || phase === "recording"}
          className="absolute inset-4 rounded-full bg-zinc-900 border border-zinc-700 flex flex-col items-center justify-center text-center px-6 disabled:cursor-not-allowed hover:bg-zinc-800 transition-colors"
        >
          {phase === "idle" && (
            <>
              <span className="text-2xl font-bold text-white">TAP TO SCREAM</span>
              <span className="text-sm text-zinc-400 mt-2">5 second window</span>
            </>
          )}
          {phase === "arming" && (
            <span className="text-xl font-bold text-white">Allow mic…</span>
          )}
          {phase === "recording" && (
            <>
              <span className="text-5xl font-black text-red-500 animate-pulse">SCREAM</span>
              <span className="text-xs text-zinc-400 mt-2">recording</span>
            </>
          )}
          {phase === "done" && (
            <>
              <span className="text-7xl font-black text-white tabular-nums">{animatedScore}</span>
              <span className="text-xs text-zinc-400 mt-1">/ 100</span>
            </>
          )}
          {phase === "error" && (
            <>
              <span className="text-lg font-bold text-red-400">Mic blocked</span>
              <span className="text-xs text-zinc-400 mt-2">tap to retry</span>
            </>
          )}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {phase === "done" && (
        <div className="w-full flex flex-col gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your @ (optional)"
            maxLength={16}
            className="w-full px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={submitted}
              className="flex-1 py-3 rounded-lg bg-red-500 hover:bg-red-400 text-white font-bold disabled:bg-zinc-700 disabled:cursor-not-allowed"
            >
              {submitted ? "Submitted ✓" : "Submit"}
            </button>
            <button
              onClick={share}
              className="flex-1 py-3 rounded-lg bg-white text-black font-bold hover:bg-zinc-200"
            >
              Share PNG
            </button>
          </div>
          <button
            onClick={() => {
              setPhase("idle");
              setScore(0);
              setAnimatedScore(0);
              setSubmitted(false);
            }}
            className="text-sm text-zinc-400 hover:text-white py-2"
          >
            Try again →
          </button>
        </div>
      )}

      {/* Off-screen share card */}
      <div className="fixed -left-[9999px] top-0 pointer-events-none">
        <div
          ref={shareCardRef}
          className="w-[1080px] h-[1920px] bg-zinc-950 flex flex-col items-center justify-center p-24 text-white"
        >
          <div className="text-3xl text-zinc-400 mb-12">scream cam</div>
          <div className="text-[24rem] font-black leading-none tabular-nums bg-gradient-to-br from-red-500 to-orange-400 bg-clip-text text-transparent">
            {score}
          </div>
          <div className="text-5xl text-zinc-400 mt-8">/ 100</div>
          <div className="text-4xl mt-24 text-white font-bold">@{name.trim() || "anon"}</div>
          <div className="text-3xl text-zinc-500 mt-24">beat me → screamcam.app</div>
        </div>
      </div>
    </div>
  );
}
```

### `app/components/Leaderboard.tsx`

Polls `/api/score` on mount and whenever a `scream:submitted` event fires.

```tsx
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
        <h2 className="text-xl font-bold text-white">Today's loudest</h2>
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
```

### `app/page.tsx` (overwrite)

```tsx
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
        we don't record audio. only the peak volume leaves your device.
      </footer>
    </main>
  );
}
```

### `app/layout.tsx` (overwrite)

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "scream.cam — how loud can you scream?",
  description: "5 seconds. One scream. Score 0–100. Top the daily leaderboard.",
  openGraph: {
    title: "scream.cam",
    description: "Scream into your mic. Get a score. Beat the leaderboard.",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "scream.cam" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-zinc-950">{children}</body>
    </html>
  );
}
```

### `app/globals.css` (overwrite)

```css
@import "tailwindcss";

:root {
  --background: #09090b;
  --foreground: #fafafa;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

html, body {
  background: radial-gradient(ellipse at top, #1a0505 0%, #09090b 60%);
  color: var(--foreground);
  font-family: var(--font-sans), system-ui, sans-serif;
}
```

### `.env.local.example`

```
# Filled automatically when you link Upstash Redis via Vercel Marketplace
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

---

## Commands to run (in order)

```bash
# 1. Dev — verify mic works in browser
npm run dev
# Open http://localhost:3000, allow mic, scream, confirm:
#   - meter pulses while recording
#   - score animates 0 → final after 5s
#   - submit adds you to leaderboard
#   - share button downloads a PNG

# 2. Build check
npm run build

# 3. Git
git init
git add -A
git commit -m "scream cam mvp"

# 4. Deploy (interactive — Claude should pause here for the user)
# Either:
#   a) Push to GitHub, then import in vercel.com dashboard, OR
#   b) Run `vercel` and follow prompts
```

## Upstash setup (must be done by user, not Claude)

1. After first deploy, go to Vercel dashboard → Project → Storage → Create → Upstash Redis (Marketplace).
2. Link to project. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` env vars.
3. Redeploy so vars are picked up. The code already reads both `KV_*` and `UPSTASH_*` names.

For local dev: copy the two vars from Vercel dashboard into a `.env.local` file. Without these, the leaderboard returns empty and POST throws — that's fine for testing the UI but you need them for the full flow.

---

## Acceptance criteria

- [ ] Mic permission prompt appears on first "TAP TO SCREAM" tap.
- [ ] During recording, the red glow scales with input volume.
- [ ] After 5s, score animates from 0 to final value, range roughly 30–95 for normal voices.
- [ ] Submit button writes to the leaderboard; leaderboard refreshes within a couple seconds.
- [ ] Share button downloads a 1080×1920 PNG with the score and username.
- [ ] Works on mobile Safari and Chrome.
- [ ] No console errors.
- [ ] `npm run build` succeeds.

## Known limitations (ship anyway, fix later)

- No anti-cheat: blowing on the mic or tapping it scores high. Fine for launch.
- No MP4 share (PNG only). MP4 with waveform is a v2 feature — needs `ffmpeg.wasm`, 2+ hours.
- No auth: usernames are unverified strings. Fine for a meme app.
- Leaderboard is UTC-day based; people in negative timezones will see resets early.
