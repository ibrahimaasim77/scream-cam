"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type OverlayState = {
  phase: "idle" | "ready" | "countdown" | "scream" | "submitted" | "results";
  countdown?: number;
  myName: string;
  theirName: string;
  myScore?: number | null;
  theirScore?: number | null;
};

type InitOpts = {
  localVideo: HTMLVideoElement;
  remoteVideo: HTMLVideoElement;
  localStream: MediaStream;
  remoteStream: MediaStream;
};

const W = 720;
const H = 1280;
const TOP_H = 600;
const BOT_Y = 640;
const BOT_H = 600;

export function useMatchRecorder() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  const overlayRef = useRef<OverlayState | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mimeTypeRef = useRef<string>("video/webm");
  const initializedRef = useRef(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof MediaRecorder === "undefined") {
      setSupported(false);
      return;
    }
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    const found = candidates.find((c) => MediaRecorder.isTypeSupported(c));
    if (!found) {
      setSupported(false);
      return;
    }
    mimeTypeRef.current = found;
    setSupported(true);
  }, []);

  const init = useCallback((opts: InitOpts) => {
    if (initializedRef.current) return;
    if (supported === false) return;
    initializedRef.current = true;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Audio mix (own AudioContext so we don't conflict with the visualizer)
    try {
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      // Browsers ship AudioContexts in "suspended" — must resume or no audio.
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
      const dest = audioCtx.createMediaStreamDestination();
      audioDestRef.current = dest;
      if (opts.localStream.getAudioTracks().length > 0) {
        try {
          audioCtx.createMediaStreamSource(opts.localStream).connect(dest);
        } catch {
          /* track may already be used; OK */
        }
      }
      if (opts.remoteStream.getAudioTracks().length > 0) {
        try {
          audioCtx.createMediaStreamSource(opts.remoteStream).connect(dest);
        } catch {
          /* OK */
        }
      }
    } catch (e) {
      console.warn("audio mix init failed", e);
    }

    const draw = () => {
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, W, H);

      // Top tile (you) — mirrored
      try {
        if (opts.localVideo.readyState >= 2) {
          ctx.save();
          ctx.translate(W, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(opts.localVideo, 0, 0, W, TOP_H);
          ctx.restore();
        }
      } catch {
        /* video not ready */
      }

      // Bottom tile (opponent)
      try {
        if (opts.remoteVideo.readyState >= 2) {
          ctx.drawImage(opts.remoteVideo, 0, BOT_Y, W, BOT_H);
        } else {
          ctx.fillStyle = "#18181b";
          ctx.fillRect(0, BOT_Y, W, BOT_H);
        }
      } catch {
        /* */
      }

      // Divider band with VS
      ctx.fillStyle = "#000";
      ctx.fillRect(0, TOP_H, W, BOT_Y - TOP_H);
      ctx.fillStyle = "#ef4444";
      ctx.font = "bold 28px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("VS", W / 2, (TOP_H + BOT_Y) / 2);

      const o = overlayRef.current;
      if (o) {
        // Name labels
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, 0, W, 50);
        ctx.fillRect(0, H - 90, W, 50);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 26px system-ui";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("@" + o.myName, 16, 25);
        ctx.textAlign = "right";
        ctx.fillText("@" + o.theirName, W - 16, H - 65);

        if (o.phase === "countdown" && o.countdown !== undefined) {
          ctx.fillStyle = "#fff";
          ctx.font = "bold 240px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            o.countdown > 0 ? String(o.countdown) : "GO",
            W / 2,
            H / 2,
          );
        } else if (o.phase === "scream") {
          ctx.fillStyle = "rgba(239,68,68,0.85)";
          ctx.fillRect(0, H / 2 - 50, W, 100);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 72px system-ui";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("SCREAM", W / 2, H / 2);
        } else if (o.phase === "results" || o.phase === "submitted") {
          // Big score corner on each tile
          if (o.myScore != null) {
            ctx.fillStyle = "rgba(0,0,0,0.65)";
            ctx.fillRect(W - 180, 60, 160, 100);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 72px system-ui";
            ctx.textAlign = "right";
            ctx.textBaseline = "middle";
            ctx.fillText(String(o.myScore), W - 30, 110);
          }
          if (o.theirScore != null) {
            ctx.fillStyle = "rgba(0,0,0,0.65)";
            ctx.fillRect(20, H - 200, 160, 100);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 72px system-ui";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(String(o.theirScore), 30, H - 150);
          }
          if (
            o.phase === "results" &&
            o.myScore != null &&
            o.theirScore != null
          ) {
            const won = o.myScore > o.theirScore;
            const tied = o.myScore === o.theirScore;
            ctx.fillStyle = tied
              ? "rgba(113,113,122,0.95)"
              : won
                ? "rgba(239,68,68,0.95)"
                : "rgba(24,24,27,0.95)";
            ctx.fillRect(0, H / 2 - 60, W, 120);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 64px system-ui";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
              tied ? "TIE" : won ? "YOU WIN" : "YOU LOST",
              W / 2,
              H / 2,
            );
          }
        }
      }

      // Watermark
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, H - 40, W, 40);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 22px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("scream-cam.vercel.app", W / 2, H - 20);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
  }, [supported]);

  const start = useCallback(() => {
    if (supported === false) return;
    const canvas = canvasRef.current;
    const dest = audioDestRef.current;
    if (!canvas || !dest) return;
    if (mediaRecorderRef.current?.state === "recording") return;

    // Belt-and-suspenders: countdown comes after a user gesture (the caller
    // hits START / the callee receives go) — perfect time to re-resume.
    if (audioCtxRef.current?.state === "suspended") {
      audioCtxRef.current.resume().catch(() => {});
    }

    const videoStream = canvas.captureStream(30);
    const tracks: MediaStreamTrack[] = [];
    const v = videoStream.getVideoTracks()[0];
    if (v) tracks.push(v);
    for (const a of dest.stream.getAudioTracks()) tracks.push(a);
    const combined = new MediaStream(tracks);

    chunksRef.current = [];
    try {
      const mr = new MediaRecorder(combined, {
        mimeType: mimeTypeRef.current,
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
      });
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current,
        });
        const url = URL.createObjectURL(blob);
        setBlobUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch (e) {
      console.warn("MediaRecorder start failed", e);
    }
  }, [supported]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  const updateOverlay = useCallback((o: OverlayState) => {
    overlayRef.current = o;
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (mediaRecorderRef.current?.state === "recording") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* */
        }
      }
      audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  const fileExtension =
    mimeTypeRef.current.includes("mp4") ? "mp4" : "webm";

  return {
    init,
    start,
    stop,
    updateOverlay,
    blobUrl,
    isRecording,
    supported,
    fileExtension,
  };
}
