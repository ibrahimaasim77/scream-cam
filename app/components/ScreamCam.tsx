"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { AudioVisualizer } from "./AudioVisualizer";
import { computeScore } from "@/lib/score";

type Phase = "idle" | "arming" | "recording" | "done" | "error";

const DURATION_MS = 5000;

export function ScreamCam() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [score, setScore] = useState(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

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
    setAnalyser(null);
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
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.6;
      source.connect(analyserNode);
      setAnalyser(analyserNode);

      const buf = new Float32Array(analyserNode.fftSize);
      let peak = 0;
      const startedAt = performance.now();
      setPhase("recording");

      const tick = () => {
        analyserNode.getFloatTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
        const rms = Math.sqrt(sumSq / buf.length);
        if (rms > peak) peak = rms;
        setLevel(Math.min(1, rms * 1.5));

        const elapsed = performance.now() - startedAt;
        if (elapsed >= DURATION_MS) {
          const final = computeScore(peak);
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
    <div className="w-full max-w-md flex flex-col items-center gap-6">
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
              <span className="text-xs text-zinc-500 mt-3">90+ is rare. 100 is mythical.</span>
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

      <div className="w-full">
        <AudioVisualizer analyser={analyser} active={phase === "recording"} />
        <div className="flex justify-between text-[10px] text-zinc-600 mt-1 px-1 uppercase tracking-widest">
          <span>low</span>
          <span>pitch</span>
          <span>high</span>
        </div>
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
          <div className="text-3xl text-zinc-500 mt-24">beat me → scream-cam.vercel.app</div>
        </div>
      </div>
    </div>
  );
}
