"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioVisualizer } from "@/app/components/AudioVisualizer";
import { computeScore } from "@/lib/score";
import { useMatchRecorder } from "./useMatchRecorder";

type Role = "caller" | "callee";

type Peer = { name: string; gender: "male" | "female" | "other" };

type MatchState = {
  id: string;
  caller: { userId: string; name: string; gender: Peer["gender"] };
  callee: { userId: string; name: string; gender: Peer["gender"] };
  callerScore: number | null;
  calleeScore: number | null;
};

type Phase =
  | "joining"
  | "connecting"
  | "ready"
  | "countdown"
  | "scream"
  | "submitted"
  | "results"
  | "error";

const ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const DURATION_MS = 5000;
const COUNTDOWN_FROM = 3;

export function MatchArena({
  matchId,
  userId,
  role,
}: {
  matchId: string;
  userId: string;
  role: Role;
}) {
  const [phase, setPhase] = useState<Phase>("joining");
  const [match, setMatch] = useState<MatchState | null>(null);
  const [status, setStatus] = useState("Waking up…");
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [countdown, setCountdown] = useState(COUNTDOWN_FROM);
  const [peerConnected, setPeerConnected] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const recorder = useMatchRecorder();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const inboxPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const matchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const remoteSetRef = useRef(false);
  const scoreSubmittedRef = useRef(false);
  const peerId = match
    ? role === "caller"
      ? match.callee.userId
      : match.caller.userId
    : null;

  const stopAll = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (inboxPollRef.current) clearInterval(inboxPollRef.current);
    inboxPollRef.current = null;
    if (matchPollRef.current) clearInterval(matchPollRef.current);
    matchPollRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);

  // 1. Load match state
  const loadMatch = useCallback(async () => {
    try {
      const r = await fetch(`/api/match/${encodeURIComponent(matchId)}`, {
        cache: "no-store",
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (data.match) {
        setMatch(data.match);
        return data.match as MatchState;
      }
    } catch {
      /* keep retrying via interval */
    }
    return null;
  }, [matchId]);

  // 2. Send signal to peer
  const sendSignal = useCallback(
    async (payload: unknown) => {
      if (!peerId) return;
      await fetch("/api/signal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: peerId, from: userId, payload }),
      }).catch(() => {});
    },
    [peerId, userId],
  );

  // 3. Set up peer connection (called after media + match info are ready)
  const setupPeerConnection = useCallback(
    async (localStream: MediaStream) => {
      const pc = new RTCPeerConnection({ iceServers: ICE });
      pcRef.current = pc;

      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal({ kind: "candidate", candidate: e.candidate.toJSON() });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0];
        if (remoteVideoRef.current && stream) {
          remoteVideoRef.current.srcObject = stream;
        }
        if (stream) setRemoteStream(stream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setPeerConnected(true);
          setStatus("Connected. Get ready…");
          setPhase("ready");
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          setStatus("Connection lost");
        }
      };

      if (role === "caller") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ kind: "offer", sdp: offer });
      }

      return pc;
    },
    [role, sendSignal],
  );

  // 4. Handle incoming signals
  const handleSignal = useCallback(
    async (payload: { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const pc = pcRef.current;
      if (!pc) return;
      try {
        if (payload.kind === "offer" && payload.sdp) {
          await pc.setRemoteDescription(payload.sdp);
          remoteSetRef.current = true;
          // flush any candidates that arrived before the offer was set
          for (const c of pendingCandidates.current) {
            await pc.addIceCandidate(c).catch(() => {});
          }
          pendingCandidates.current = [];
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({ kind: "answer", sdp: answer });
        } else if (payload.kind === "answer" && payload.sdp) {
          await pc.setRemoteDescription(payload.sdp);
          remoteSetRef.current = true;
          for (const c of pendingCandidates.current) {
            await pc.addIceCandidate(c).catch(() => {});
          }
          pendingCandidates.current = [];
        } else if (payload.kind === "candidate" && payload.candidate) {
          if (remoteSetRef.current) {
            await pc.addIceCandidate(payload.candidate).catch(() => {});
          } else {
            pendingCandidates.current.push(payload.candidate);
          }
        }
      } catch (e) {
        console.error("signal handling failed", e);
      }
    },
    [sendSignal],
  );

  // 5. Poll inbox for signaling messages
  const pollInbox = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/inbox?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });
      const data = await r.json();
      for (const msg of (data.messages ?? []) as Array<{
        type: string;
        from?: string;
        payload?: { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      }>) {
        if (msg.type === "signal" && msg.payload) {
          await handleSignal(msg.payload);
        }
      }
    } catch {
      /* keep polling */
    }
  }, [userId, handleSignal]);

  // 6. Bootstrap: load match → get media → set up PC → start polling
  useEffect(() => {
    if (!userId) {
      setError("Missing userId — go back and join the queue again.");
      setPhase("error");
      return;
    }
    let cancelled = false;

    (async () => {
      setStatus("Loading match…");
      const m = await loadMatch();
      if (!m) {
        setError("Match not found or expired.");
        setPhase("error");
        return;
      }

      setStatus("Requesting camera + mic…");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch {
        setError("Camera or mic blocked. Reload and allow access.");
        setPhase("error");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // hook up analyser for the visualizer + level tracking
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.6;
      source.connect(analyserNode);
      setAnalyser(analyserNode);

      // ambient level meter (peak-tracking lives in the scream() routine)
      const levelBuf = new Float32Array(analyserNode.fftSize);
      const levelTick = () => {
        analyserNode.getFloatTimeDomainData(levelBuf);
        let s = 0;
        for (let i = 0; i < levelBuf.length; i++) s += levelBuf[i] * levelBuf[i];
        setLevel(Math.min(1, Math.sqrt(s / levelBuf.length) * 1.5));
        rafRef.current = requestAnimationFrame(levelTick);
      };
      rafRef.current = requestAnimationFrame(levelTick);

      setStatus("Connecting to opponent…");
      setPhase("connecting");
      await setupPeerConnection(stream);

      // poll inbox for signaling messages
      inboxPollRef.current = setInterval(pollInbox, 1000);
      // also poll match record so we see opponent's score post-submission
      matchPollRef.current = setInterval(loadMatch, 2000);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, loadMatch, setupPeerConnection, pollInbox]);

  // 7. Detect both sides being ready → start countdown (caller initiates)
  // We piggyback on the existing signaling channel for a simple "go" message.
  const [goReceived, setGoReceived] = useState(false);
  useEffect(() => {
    if (!goReceived) return;
    if (phase !== "ready") return;
    setPhase("countdown");
  }, [goReceived, phase]);

  // Listen for "go" via data channel? Simpler: piggyback on signaling.
  // We extend handleSignal — but to avoid a circular dep we use a window event.
  useEffect(() => {
    const onGo = () => setGoReceived(true);
    window.addEventListener("scream:go", onGo);
    return () => window.removeEventListener("scream:go", onGo);
  }, []);
  // patch: when caller hits START, send a "go" signal; when callee receives it, fire scream:go
  const originalHandleSignal = handleSignal;
  const handleSignalWithGo = useCallback(
    async (payload: { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      if ((payload as { kind: string }).kind === "go") {
        window.dispatchEvent(new CustomEvent("scream:go"));
        return;
      }
      await originalHandleSignal(payload);
    },
    [originalHandleSignal],
  );
  // override pollInbox to use handleSignalWithGo
  useEffect(() => {
    if (!inboxPollRef.current) return;
    clearInterval(inboxPollRef.current);
    inboxPollRef.current = setInterval(async () => {
      if (!userId) return;
      try {
        const r = await fetch(`/api/inbox?userId=${encodeURIComponent(userId)}`, {
          cache: "no-store",
        });
        const data = await r.json();
        for (const msg of (data.messages ?? []) as Array<{
          type: string;
          payload?: { kind: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
        }>) {
          if (msg.type === "signal" && msg.payload) {
            await handleSignalWithGo(msg.payload);
          }
        }
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => {
      if (inboxPollRef.current) clearInterval(inboxPollRef.current);
    };
  }, [userId, handleSignalWithGo, peerConnected]);

  // 8. Countdown → scream
  useEffect(() => {
    if (phase !== "countdown") return;
    setCountdown(COUNTDOWN_FROM);
    let n = COUNTDOWN_FROM;
    const id = setInterval(() => {
      n -= 1;
      setCountdown(n);
      if (n <= 0) {
        clearInterval(id);
        setPhase("scream");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // 9. Scream: track peak RMS for 5s, submit
  useEffect(() => {
    if (phase !== "scream") return;
    if (!analyser) return;
    if (scoreSubmittedRef.current) return;
    scoreSubmittedRef.current = true;

    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const startedAt = performance.now();
    let raf = 0;

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      if (rms > peak) peak = rms;
      const elapsed = performance.now() - startedAt;
      if (elapsed >= DURATION_MS) {
        const final = computeScore(peak);
        setScore(final);
        setPhase("submitted");
        // submit
        fetch(`/api/match/${encodeURIComponent(matchId)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId, score: final }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (data.match) setMatch(data.match);
          })
          .catch(() => {});
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, analyser, matchId, userId]);

  // 10. When both scores submitted → results
  useEffect(() => {
    if (!match) return;
    if (match.callerScore != null && match.calleeScore != null) {
      setPhase((p) => (p === "results" ? p : "results"));
    }
  }, [match]);

  const onStart = () => {
    // caller fires the "go" signal. callee also receives a copy fired locally.
    sendSignal({ kind: "go" });
    window.dispatchEvent(new CustomEvent("scream:go"));
  };

  // 11. Initialize recorder when both streams + video els are ready
  useEffect(() => {
    if (!localStream || !remoteStream) return;
    const lv = localVideoRef.current;
    const rv = remoteVideoRef.current;
    if (!lv || !rv) return;
    recorder.init({
      localStream,
      remoteStream,
      localVideo: lv,
      remoteVideo: rv,
    });
  }, [localStream, remoteStream, recorder]);

  // 12. Start recording at countdown, stop a beat after results
  useEffect(() => {
    if (phase === "countdown" && !recorder.isRecording) {
      recorder.start();
    }
    if (phase === "results") {
      const t = setTimeout(() => recorder.stop(), 2500);
      return () => clearTimeout(t);
    }
  }, [phase, recorder]);

  // 13. Push overlay state into the recorder so it draws current HUD each frame
  const myNameForOverlay = match
    ? role === "caller"
      ? match.caller.name
      : match.callee.name
    : "you";
  const theirNameForOverlay = match
    ? role === "caller"
      ? match.callee.name
      : match.caller.name
    : "opponent";
  const myScoreForOverlay = match
    ? role === "caller"
      ? match.callerScore
      : match.calleeScore
    : null;
  const theirScoreForOverlay = match
    ? role === "caller"
      ? match.calleeScore
      : match.callerScore
    : null;
  useEffect(() => {
    recorder.updateOverlay({
      phase:
        phase === "countdown"
          ? "countdown"
          : phase === "scream"
            ? "scream"
            : phase === "submitted"
              ? "submitted"
              : phase === "results"
                ? "results"
                : phase === "ready"
                  ? "ready"
                  : "idle",
      countdown,
      myName: myNameForOverlay,
      theirName: theirNameForOverlay,
      myScore: myScoreForOverlay,
      theirScore: theirScoreForOverlay,
    });
  }, [
    phase,
    countdown,
    myNameForOverlay,
    theirNameForOverlay,
    myScoreForOverlay,
    theirScoreForOverlay,
    recorder,
  ]);

  const me = match
    ? role === "caller"
      ? match.caller
      : match.callee
    : null;
  const them: Peer | null = match
    ? role === "caller"
      ? { name: match.callee.name, gender: match.callee.gender }
      : { name: match.caller.name, gender: match.caller.gender }
    : null;
  const myScore = match
    ? role === "caller"
      ? match.callerScore
      : match.calleeScore
    : null;
  const theirScore = match
    ? role === "caller"
      ? match.calleeScore
      : match.callerScore
    : null;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-6 gap-4">
      <Link
        href="/"
        className="self-start text-xs text-zinc-500 hover:text-white"
      >
        ← leave match
      </Link>

      {error && (
        <div className="rounded-lg bg-red-950/40 border border-red-900 px-4 py-3 text-red-300 text-sm w-full max-w-md text-center">
          {error}
        </div>
      )}

      {/* Webcam tiles */}
      <div className="w-full max-w-2xl grid grid-cols-2 gap-3">
        <Tile
          name={me?.name ?? "you"}
          gender={me?.gender}
          score={myScore}
          isYou
          isScreaming={phase === "scream"}
          videoRef={localVideoRef}
          muted
        />
        <Tile
          name={them?.name ?? "opponent"}
          gender={them?.gender}
          score={theirScore}
          isScreaming={phase === "scream"}
          videoRef={remoteVideoRef}
          waiting={!peerConnected}
        />
      </div>

      {/* Visualizer */}
      <div className="w-full max-w-2xl">
        <AudioVisualizer
          analyser={analyser}
          active={phase === "scream" || phase === "ready" || phase === "countdown"}
          height={100}
        />
      </div>

      {/* Phase UI */}
      <div className="w-full max-w-md text-center">
        {phase === "joining" && (
          <p className="text-zinc-400 text-sm">{status}</p>
        )}

        {phase === "connecting" && (
          <p className="text-zinc-400 text-sm">{status}</p>
        )}

        {phase === "ready" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-zinc-300">Both connected. {role === "caller" ? "Hit start when ready." : "Waiting for opponent to start…"}</p>
            {role === "caller" && (
              <button
                onClick={onStart}
                className="px-8 py-4 rounded-lg bg-red-500 hover:bg-red-400 text-white font-black text-lg"
              >
                START
              </button>
            )}
          </div>
        )}

        {phase === "countdown" && (
          <div className="text-9xl font-black text-white tabular-nums animate-pulse">
            {countdown > 0 ? countdown : "GO"}
          </div>
        )}

        {phase === "scream" && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-6xl font-black text-red-500 animate-pulse">SCREAM</div>
            <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-500 to-orange-400 transition-all"
                style={{ width: `${level * 100}%` }}
              />
            </div>
          </div>
        )}

        {phase === "submitted" && (
          <div className="text-center">
            <div className="text-zinc-300">Your score: {score}</div>
            <div className="text-zinc-500 text-sm mt-1">Waiting for opponent…</div>
          </div>
        )}

        {phase === "results" && match && (
          <ResultsPanel
            match={match}
            role={role}
            clipUrl={recorder.blobUrl}
            clipExt={recorder.fileExtension}
            recorderSupported={recorder.supported}
            isStillRecording={recorder.isRecording}
          />
        )}

        {phase === "error" && (
          <Link
            href="/versus"
            className="inline-block px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white"
          >
            try again
          </Link>
        )}
      </div>
    </main>
  );
}

function Tile({
  name,
  gender,
  score,
  isYou,
  isScreaming,
  videoRef,
  muted,
  waiting,
}: {
  name: string;
  gender?: Peer["gender"];
  score: number | null;
  isYou?: boolean;
  isScreaming: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted?: boolean;
  waiting?: boolean;
}) {
  return (
    <div
      className={`relative aspect-[3/4] rounded-xl overflow-hidden border ${
        isScreaming ? "border-red-500 shadow-[0_0_24px_rgba(239,68,68,0.6)]" : "border-zinc-800"
      } bg-zinc-950`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="w-full h-full object-cover bg-black"
        style={{ transform: isYou ? "scaleX(-1)" : undefined }}
      />
      {waiting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-zinc-400 text-sm">
          waiting…
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/90 to-transparent">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-white font-bold text-sm truncate">
              {isYou ? "you" : "@"}{!isYou && name}
            </span>
            {gender && (
              <span className="text-[10px] uppercase tracking-widest text-zinc-400">
                {gender}
              </span>
            )}
          </div>
          {score !== null && (
            <span className="text-white font-black text-lg tabular-nums">{score}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultsPanel({
  match,
  role,
  clipUrl,
  clipExt,
  recorderSupported,
  isStillRecording,
}: {
  match: MatchState;
  role: Role;
  clipUrl: string | null;
  clipExt: string;
  recorderSupported: boolean | null;
  isStillRecording: boolean;
}) {
  const myScore = role === "caller" ? match.callerScore : match.calleeScore;
  const theirScore = role === "caller" ? match.calleeScore : match.callerScore;
  if (myScore == null || theirScore == null) return null;
  const won = myScore > theirScore;
  const tied = myScore === theirScore;
  const filename = `screamcam-${myScore}vs${theirScore}.${clipExt}`;
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`text-4xl font-black ${
          tied ? "text-zinc-300" : won ? "text-red-500" : "text-zinc-500"
        }`}
      >
        {tied ? "TIE" : won ? "YOU WIN" : "YOU LOST"}
      </div>
      <div className="text-sm text-zinc-400">
        {myScore} vs {theirScore}
      </div>

      {recorderSupported === false ? (
        <div className="text-xs text-zinc-600 mt-1">
          (clip recording not supported in this browser)
        </div>
      ) : clipUrl ? (
        <a
          href={clipUrl}
          download={filename}
          className="mt-2 px-5 py-3 rounded-lg bg-white text-black font-black hover:bg-zinc-200"
        >
          ⬇ Download clip
        </a>
      ) : isStillRecording ? (
        <div className="text-xs text-zinc-500 mt-1 animate-pulse">
          rendering clip…
        </div>
      ) : null}

      <div className="flex gap-2 mt-2">
        <Link
          href="/versus"
          className="px-4 py-2 rounded-lg bg-red-500 hover:bg-red-400 text-white font-bold"
        >
          new opponent
        </Link>
        <Link
          href="/"
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white"
        >
          home
        </Link>
      </div>

      {clipUrl && (
        <p className="text-[10px] text-zinc-600 mt-1 max-w-xs text-center">
          Tip: post to TikTok or send to a friend. The clip auto-tags scream-cam.vercel.app so they know where to come.
        </p>
      )}
    </div>
  );
}
