"use client";

// Single-threaded ffmpeg.wasm: ~30MB lazy-loaded from CDN on first call.
// No COOP/COEP headers required (only the multi-threaded core needs SAB),
// so WebRTC is unaffected.

const FFMPEG_CORE_VERSION = "0.12.10";
const FFMPEG_BASE_URL = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;

type FFmpegInstance = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  on: (event: string, handler: (e: { progress?: number }) => void) => void;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<void>;
};

let ffmpegInstance: FFmpegInstance | null = null;
let loadingPromise: Promise<FFmpegInstance> | null = null;
let currentProgress: ((ratio: number) => void) | null = null;

async function getFFmpeg(): Promise<FFmpegInstance> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const ffmpegMod = await import("@ffmpeg/ffmpeg");
    const utilMod = await import("@ffmpeg/util");
    const ff = new ffmpegMod.FFmpeg() as unknown as FFmpegInstance;
    ff.on("progress", (ev) => {
      if (currentProgress && typeof ev?.progress === "number") {
        currentProgress(Math.min(1, Math.max(0, ev.progress)));
      }
    });
    const [coreURL, wasmURL] = await Promise.all([
      utilMod.toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
      utilMod.toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ff.load({ coreURL, wasmURL });
    ffmpegInstance = ff;
    return ff;
  })();
  return loadingPromise;
}

export async function convertWebmToMp4(
  webmBlob: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  currentProgress = onProgress ?? null;
  try {
    const buf = new Uint8Array(await webmBlob.arrayBuffer());
    await ff.writeFile("input.webm", buf);
    await ff.exec([
      "-i",
      "input.webm",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "output.mp4",
    ]);
    const data = (await ff.readFile("output.mp4")) as Uint8Array;
    // Copy into a fresh buffer so the blob owns it (readFile may reuse memory).
    const out = new Uint8Array(data.byteLength);
    out.set(data);
    // Clean up so a second match's conversion starts clean.
    try {
      await ff.deleteFile("input.webm");
    } catch {
      /* */
    }
    try {
      await ff.deleteFile("output.mp4");
    } catch {
      /* */
    }
    return new Blob([out], { type: "video/mp4" });
  } finally {
    currentProgress = null;
  }
}
