/**
 * Score the loudness of a 5-second window.
 *
 * `peak` is the maximum RMS observed (0..1, from getFloatTimeDomainData).
 *
 * The curve `peak^1.4 * 115` (clamped to 100) makes 90+ rare and 100 nearly
 * impossible. Most normal voices land 30–60, real screams 65–85, sustained
 * full-throated peak-clipping screams 85–95. 100 requires the mic to clip.
 */
export function computeScore(peak: number): number {
  const p = Math.max(0, Math.min(1, peak));
  const raw = Math.pow(p, 1.4) * 115;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
