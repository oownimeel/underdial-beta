// Why a recording gave no result: too quiet, too noisy, knocked, a quartz watch,
// or beats without a steady rhythm. Rough sound statistics only; the real analysis
// lives in engine.js (which mirrors the Swift analyzer and stays untouched).
import { envelope, defaultConfiguration } from "./engine.js";

/** Loudness and shape of the sound, from a 1 ms peak envelope. */
export function soundStats(samples, sampleRate, band = false) {
  if (band) samples = envelope(samples, sampleRate, defaultConfiguration());
  const block = Math.max(1, Math.round(sampleRate / 1000));
  const count = Math.floor(samples.length / block);
  const env = new Float32Array(count);
  let sum = 0, clipped = 0;
  for (let b = 0; b < count; b++) {
    let peak = 0;
    for (let i = b * block, end = i + block; i < end; i++) {
      const v = Math.abs(samples[i]);
      sum += v * v;
      if (v > peak) peak = v;
      if (v >= 0.99) clipped++;
    }
    env[b] = peak;
  }
  const n = count * block || 1;
  const sorted = Float32Array.from(env).sort();
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] || 0;
  const floor = Math.max(at(0.5), 1e-7);
  return {
    env,
    rmsDB: 10 * Math.log10(Math.max(sum / n, 1e-14)),
    floorDB: 20 * Math.log10(floor),
    // How far the loudest clicks stand above the background.
    peakiness: at(0.995) / floor,
    // Ticks fill a few percent of the time, so this is how loud a tick usually is.
    tickLevel: at(0.98) / floor,
    // The single loudest moment: a knock or a scrape towers over any tick.
    burst: sorted[sorted.length - 1] / floor,
    clippedShare: clipped / n,
  };
}

/** One click a second, evenly spaced, is how a quartz movement sounds. */
function looksQuartz(env) {
  const sorted = Float32Array.from(env).sort();
  const floor = Math.max(sorted[Math.floor(sorted.length / 2)], 1e-7);
  const threshold = floor * 6;
  const peaks = [];
  for (let i = 0; i < env.length; i++) {
    if (env[i] < threshold) continue;
    const last = peaks[peaks.length - 1];
    if (last != null && i - last < 300) { if (env[i] > env[last]) peaks[peaks.length - 1] = i; continue; }
    peaks.push(i);
  }
  if (peaks.length < 5) return false;
  const gaps = peaks.slice(1).map((p, i) => p - peaks[i]);
  const steady = gaps.filter((g) => Math.abs(g - 1000) <= 40).length;
  // Mechanical ticks come 5–10 times a second, so few clicks a second rules them out.
  const perSecond = peaks.length / (env.length / 1000);
  return perSecond < 1.6 && steady / gaps.length >= 0.7;
}

/**
 * Returns "knocked" | "quartz" | "quiet" | "noisy" | "irregular".
 */
export function diagnose(samples, sampleRate) {
  if (!samples || samples.length < sampleRate) return "quiet";
  const raw = soundStats(samples, sampleRate);
  // A knock is far above the background and far above the ticks themselves,
  // so a watch that is simply loud is not mistaken for one.
  const knock = raw.burst > LIMITS.burst && raw.burst / raw.tickLevel > LIMITS.burstOverTicks;
  if (raw.clippedShare > 0.0005 || knock) return "knocked";
  if (looksQuartz(raw.env)) return "quartz";
  // A watch's tick lives above 8 kHz, where room noise is thin.
  const ticks = soundStats(samples, sampleRate, true);
  if (ticks.peakiness >= LIMITS.tickPeakiness) return "irregular";
  // No ticks stand out: either nothing reached the microphone or the room drowned them.
  // The background between ticks decides, so a phone that simply records louder isn't "noisy".
  return raw.floorDB > LIMITS.loudRoomDB ? "noisy" : "quiet";
}

// Set from four real iPhone recordings (watch pressed to the phone: background about -75 dBFS,
// ticks 6–80× above the background in the tick band, loudest tick 53×) and synthetic rooms and knocks.
export const LIMITS = { tickPeakiness: 4, loudRoomDB: -60, burst: 150, burstOverTicks: 8 };
