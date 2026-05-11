"use client";

import { useEffect, useRef } from "react";

type Props = {
  analyser: AnalyserNode | null;
  active: boolean;
  bars?: number;
  height?: number;
};

/**
 * Studio-style FFT bar visualizer. Hooks into an existing AnalyserNode so the
 * audio pipeline (mic → AudioContext) is owned by the parent.
 */
export function AudioVisualizer({ analyser, active, bars = 48, height = 120 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const peaksRef = useRef<Float32Array>(new Float32Array(bars));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const peaks = peaksRef.current;
    const freqBuf = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const gap = 2;
      const barW = (w - gap * (bars - 1)) / bars;

      if (analyser && freqBuf && active) {
        analyser.getByteFrequencyData(freqBuf);
        // sample across a useful slice of the spectrum (skip the very lowest bin)
        const lo = 2;
        const hi = Math.min(freqBuf.length, 512);
        const step = (hi - lo) / bars;
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          let count = 0;
          const a = Math.floor(lo + i * step);
          const b = Math.floor(lo + (i + 1) * step);
          for (let j = a; j < b; j++) {
            sum += freqBuf[j];
            count++;
          }
          const v = count > 0 ? sum / count / 255 : 0;
          peaks[i] = Math.max(v, peaks[i] * 0.88);
        }
      } else {
        // idle decay
        for (let i = 0; i < bars; i++) peaks[i] *= 0.9;
      }

      for (let i = 0; i < bars; i++) {
        const v = peaks[i];
        const bh = Math.max(2, v * h);
        const x = i * (barW + gap);
        const y = h - bh;
        const grad = ctx.createLinearGradient(0, y, 0, h);
        // hot at the top, cool at the bottom
        if (v > 0.85) {
          grad.addColorStop(0, "#fee2e2");
          grad.addColorStop(0.5, "#f97316");
          grad.addColorStop(1, "#7f1d1d");
        } else if (v > 0.5) {
          grad.addColorStop(0, "#f97316");
          grad.addColorStop(1, "#7f1d1d");
        } else {
          grad.addColorStop(0, "#ef4444");
          grad.addColorStop(1, "#450a0a");
        }
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barW, bh);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [analyser, active, bars]);

  return (
    <canvas
      ref={canvasRef}
      style={{ height, width: "100%" }}
      className="block rounded-lg bg-black/40 border border-zinc-800"
    />
  );
}
