// Underdial analysis engine: a line-by-line port of UnderdialCore (Swift).
// Keep the two in step; the WAV tests in Web/tests compare their results.

export const STANDARD_BPH = [12000, 14400, 17280, 18000, 19800, 21600, 25200, 28800, 36000, 43200, 72000];
export const DEFAULT_LIFT_ANGLE = 52;

export const Level = { poor: 0, fair: 1, good: 2 };
export const LEVEL_NAMES = ["poor", "fair", "good"];

export function defaultConfiguration() {
  return {
    liftAngle: DEFAULT_LIFT_ANGLE,
    manualBPH: null,
    bandHighpassHz: 8000,
    bandLowpassHz: 20000,
    envelopeCutoffHz: 1200,
    bphAnalysisSeconds: 4,
    leadInSeconds: 1.5,
    edgeTrimSeconds: 0.05,
    minimumBeats: 8,
    goodQuality: { residualSigmaMs: 0.3, snrDB: 20, detectionRatio: 0.9, rateUncertainty: 0.5 },
    fairQuality: { residualSigmaMs: 0.5, snrDB: 12, detectionRatio: 0.7, rateUncertainty: 1.5 },
  };
}

/** The rate interval only narrows over a full measurement; live checks leave it out. */
export function ignoringRateUncertainty(configuration) {
  return {
    ...configuration,
    goodQuality: { ...configuration.goodQuality, rateUncertainty: Infinity },
    fairQuality: { ...configuration.fairQuality, rateUncertainty: Infinity },
  };
}

export class AnalysisError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** A = LA / (2 sin(π · BPH / 7200 · t)). */
export function amplitude(liftAngle, bph, pulseSpanSeconds) {
  const sine = Math.sin(Math.PI * bph / 7200 * pulseSpanSeconds);
  if (!(pulseSpanSeconds > 0) || !(sine > 0)) return null;
  return liftAngle / (2 * sine);
}

/** Rate = 86400 × (P₀ / P − 1), where P₀ = 3600 / BPH. */
export function rate(period, bph) {
  return 86400 * (3600 / bph / period - 1);
}

// MARK: Signal processing

const BUTTERWORTH_Q = 0.7071067811865476;

/** k-th smallest value (0-based), rearranging `a` in place. Same answer as sorting, in linear time. */
function select(a, k) {
  let left = 0, right = a.length - 1;
  while (right > left) {
    // Median-of-three pivot keeps sorted or flat runs from going quadratic.
    const mid = (left + right) >> 1;
    let x = a[left], y = a[mid], z = a[right];
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : (x < z ? x : y < z ? z : y);
    let i = left, j = right;
    while (i <= j) {
      while (a[i] < pivot) i++;
      while (a[j] > pivot) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) right = j;
    else if (k >= i) left = i;
    else return a[k];
  }
  return a[k];
}

/** Upper median, as the Swift Float version. */
function medianF(values) {
  if (values.length === 0) return 0;
  return select(Float64Array.from(values), values.length >> 1);
}

/** Mean of the middle two for even counts, as the Swift Double version. */
function medianD(values) {
  if (values.length === 0) return 0;
  const copy = Float64Array.from(values);
  const middle = copy.length >> 1;
  const upper = select(copy, middle);
  if (copy.length % 2 !== 0) return upper;
  // After selection everything left of `middle` is ≤ upper; its maximum is the lower middle.
  let lower = -Infinity;
  for (let i = 0; i < middle; i++) if (copy[i] > lower) lower = copy[i];
  return (lower + upper) / 2;
}

function maxOf(a, from = 0, to = a.length) {
  let m = -Infinity;
  for (let i = from; i < to; i++) if (a[i] > m) m = a[i];
  return m;
}

function minOf(a, from = 0, to = a.length) {
  let m = Infinity;
  for (let i = from; i < to; i++) if (a[i] < m) m = a[i];
  return m;
}

function warp(cutoff, sampleRate) {
  const omega = 2 * Math.PI * cutoff / sampleRate;
  return { cosine: Math.cos(omega), alpha: Math.sin(omega) / (2 * BUTTERWORTH_Q) };
}

function lowpass(cutoff, sampleRate) {
  const { cosine, alpha } = warp(cutoff, sampleRate);
  const a0 = 1 + alpha;
  return [(1 - cosine) / 2 / a0, (1 - cosine) / a0, (1 - cosine) / 2 / a0, -2 * cosine / a0, (1 - alpha) / a0];
}

function highpass(cutoff, sampleRate) {
  const { cosine, alpha } = warp(cutoff, sampleRate);
  const a0 = 1 + alpha;
  return [(1 + cosine) / 2 / a0, -(1 + cosine) / a0, (1 + cosine) / 2 / a0, -2 * cosine / a0, (1 - alpha) / a0];
}

/** Cascaded biquad sections, each [b0, b1, b2, a1, a2], in place. */
function biquadInPlace(x, coefficients) {
  for (let s = 0; s < coefficients.length; s += 5) {
    const b0 = coefficients[s], b1 = coefficients[s + 1], b2 = coefficients[s + 2];
    const a1 = coefficients[s + 3], a2 = coefficients[s + 4];
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = xi; y2 = y1; y1 = y;
      x[i] = y;
    }
  }
}

/** Forward, reverse, backward, reverse: pulses keep their position in time. */
function zeroPhaseInPlace(x, coefficients) {
  biquadInPlace(x, coefficients);
  x.reverse();
  biquadInPlace(x, coefficients);
  x.reverse();
}

/** Band-passed, rectified and smoothed signal. */
export function envelope(samples, sampleRate, configuration) {
  const n = samples.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n || 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = samples[i] - mean;
  const nyquistLimit = sampleRate * 0.45;
  const band = lowpass(Math.min(configuration.bandLowpassHz, nyquistLimit), sampleRate)
    .concat(highpass(configuration.bandHighpassHz, sampleRate));
  zeroPhaseInPlace(x, band);
  for (let i = 0; i < n; i++) x[i] = Math.abs(x[i]);
  zeroPhaseInPlace(x, lowpass(configuration.envelopeCutoffHz, sampleRate));
  for (let i = 0; i < n; i++) if (x[i] < 0) x[i] = 0;
  return x;
}

function decimate(signal, factor) {
  const out = [];
  for (let start = 0; start < signal.length - factor + 1; start += factor) {
    let sum = 0;
    for (let i = start; i < start + factor; i++) sum += signal[i];
    out.push(sum / factor);
  }
  return Float64Array.from(out);
}

function autocorrelation(signal, maxLag) {
  const n = signal.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;
  const c = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) { c[i] = signal[i] - mean; energy += c[i] * c[i]; }
  energy /= n;
  const out = new Float64Array(maxLag + 1);
  if (!(energy > 0)) return out;
  for (let lag = 0; lag <= maxLag; lag++) {
    const length = n - lag;
    if (length <= 0) continue;
    let product = 0;
    for (let i = 0; i < length; i++) product += c[i] * c[i + lag];
    out[lag] = product / length / energy;
  }
  return out;
}

// MARK: BPH detection

const BPH = { workingRate: 4000, lagTolerance: 0.015, minimumScore: 0.2, competitiveShare: 0.5, beatLagShare: 0.25 };

/** Tick-to-tick spacing (2P) is immune to beat error; the fastest match with energy near one beat lag wins. */
function detectBPH(env, sampleRate, configuration) {
  const factor = Math.max(1, Math.trunc(sampleRate / BPH.workingRate));
  const workRate = sampleRate / factor;
  const start = Math.trunc(configuration.leadInSeconds * sampleRate);
  const end = Math.min(env.length - Math.trunc(configuration.edgeTrimSeconds * sampleRate),
    start + Math.trunc(configuration.bphAnalysisSeconds * sampleRate));
  if (!(end > start)) return null;
  const signal = decimate(env.subarray(start, end), factor);

  const longestLag = 2 * 3600 / Math.min(...STANDARD_BPH) * (1 + BPH.lagTolerance);
  const maxLag = Math.trunc(longestLag * workRate) + 2;
  if (!(signal.length > maxLag * 2)) return null;
  const correlation = autocorrelation(signal, maxLag);

  const peak = (lag, halfWidth) => {
    const low = Math.max(1, Math.trunc((lag - halfWidth) * workRate));
    const high = Math.min(maxLag, Math.trunc(Math.ceil((lag + halfWidth) * workRate)));
    let best = low;
    for (let i = low + 1; i <= high; i++) if (correlation[i] > correlation[best]) best = i;
    return { lag: best, value: correlation[best] };
  };

  const candidates = STANDARD_BPH.map((bph) => {
    const twoBeats = 7200 / bph;
    const match = peak(twoBeats, twoBeats * BPH.lagTolerance);
    return { bph, lag: match.lag, score: match.value };
  });
  const bestScore = Math.max(...candidates.map((c) => c.score));
  if (!(bestScore >= BPH.minimumScore)) return null;

  for (const candidate of [...candidates].reverse()) {
    if (!(candidate.score >= bestScore * BPH.competitiveShare)) continue;
    const beat = 3600 / candidate.bph;
    const beatPeak = peak(beat, Math.min(0.010, beat * 0.12));
    if (beatPeak.value >= candidate.score * BPH.beatLagShare) {
      return { bph: candidate.bph, period: candidate.lag / workRate / 2 };
    }
  }
  return null;
}

// MARK: Beat detection

const BEAT = {
  thresholdShare: 0.2, noiseMargin: 5, pulseFloorShare: 0.1, pulseProminence: 0.3, onsetShare: 0.3,
  minimumPulseSeparation: 0.001, refractoryShare: 0.6, lookBackShare: 0.1, pulseGateShare: 0.3,
};

function makeBlock(values, chunkLength) {
  const floor = medianF(values);
  const deviations = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs(values[i] - floor);
  const noise = 1.4826 * medianF(deviations);
  const maxima = [];
  for (let start = 0; start < values.length; start += chunkLength) {
    maxima.push(maxOf(values, start, Math.min(start + chunkLength, values.length)));
  }
  const peak = medianF(maxima);
  const threshold = Math.max(floor + BEAT.thresholdShare * (peak - floor), floor + BEAT.noiseMargin * noise);
  return { floor, threshold, noise };
}

function findPulses(env, lower, upper, block, minimumSeparation, floorShare = BEAT.pulseFloorShare) {
  const beatMax = maxOf(env, lower, upper);
  const cutoff = Math.max(block.floor + floorShare * (beatMax - block.floor), block.floor + BEAT.noiseMargin * block.noise);
  const pulses = [];
  for (let index = lower + 1; index < upper - 1; index++) {
    const height = env[index];
    if (!(height >= cutoff && height > env[index - 1] && height >= env[index + 1])) continue;
    const last = pulses[pulses.length - 1];
    if (!last) {
      pulses.push({ index, height, base: block.floor });
      continue;
    }
    const valley = minOf(env, last.index, index + 1);
    const lesser = Math.min(last.height, height) - block.floor;
    const isSeparate = index - last.index >= minimumSeparation
      && lesser - (valley - block.floor) >= BEAT.pulseProminence * lesser;
    if (isSeparate) {
      pulses.push({ index, height, base: valley });
    } else if (height > last.height) {
      last.index = index;
      last.height = height;
    }
  }
  return pulses;
}

function thirdPulse(pulses) {
  if (pulses.length < 3) return null;
  let best = pulses[2];
  for (let i = 3; i < pulses.length; i++) if (pulses[i].height > best.height) best = pulses[i];
  return best;
}

/** Time the rising edge passes a fixed share of the pulse's own height. */
function onsetTime(pulse, env, sampleRate) {
  const level = pulse.base + BEAT.onsetShare * (pulse.height - pulse.base);
  let index = pulse.index;
  while (index > 0 && env[index - 1] > level) index--;
  if (!(index > 0)) return 0;
  const below = env[index - 1], above = env[index];
  const fraction = above > below ? (level - below) / (above - below) : 0;
  return (index - 1 + fraction) / sampleRate;
}

function detectBeats(env, sampleRate, period, configuration) {
  const blockLength = Math.max(Math.trunc(sampleRate), Math.trunc(3 * period * sampleRate));
  const chunkLength = Math.max(1, Math.trunc(period * sampleRate));
  const blocks = [];
  for (let start = 0; start < env.length; start += blockLength) {
    blocks.push(makeBlock(env.subarray(start, Math.min(start + blockLength, env.length)), chunkLength));
  }
  const trim = Math.trunc(configuration.edgeTrimSeconds * sampleRate);
  const refractory = Math.trunc(BEAT.refractoryShare * period * sampleRate);
  const lookBack = Math.trunc(BEAT.lookBackShare * period * sampleRate);
  const gate = Math.trunc(BEAT.pulseGateShare * period * sampleRate);
  const separation = Math.trunc(BEAT.minimumPulseSeparation * sampleRate);

  const beats = [];
  let index = Math.trunc(configuration.leadInSeconds * sampleRate) + lookBack;
  const end = env.length - trim - gate;
  while (index < end) {
    const block = blocks[Math.trunc(index / blockLength)];
    if (!(env[index] >= block.threshold)) { index++; continue; }
    const pulses = findPulses(env, index - lookBack, index + gate, block, separation);
    if (pulses.length > 0) {
      let loudest = pulses[0];
      for (const p of pulses) if (p.height > loudest.height) loudest = p;
      beats.push({ anchor: onsetTime(loudest, env, sampleRate), peak: loudest.height });
    }
    index += refractory;
  }
  return beats;
}

// MARK: FFT

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

const fftTables = new Map();

function fftTable(n) {
  let table = fftTables.get(n);
  if (!table) {
    const bits = Math.log2(n);
    const reverse = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      reverse[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
    table = { reverse, cos, sin };
    fftTables.set(n, table);
  }
  return table;
}

/** Iterative radix-2 forward FFT. */
function fftInPlace(re, im) {
  const n = re.length, { reverse, cos, sin } = fftTable(n);
  for (let i = 0; i < n; i++) {
    const j = reverse[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sin[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

function fftReal(values, n) {
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(values);
  fftInPlace(re, im);
  return { re, im };
}

// MARK: Templates

const TEMPLATE = {
  halfWidthShare: 0.25, minimumPulseSeparation: 0.001, pulseFloorShare: 0.03, sideSearchReach: 0.001,
  sideMinimumShare: 0.02, sideNoiseMultiple: 2, alignmentReach: 0.005,
};

function medianShape(env, sampleRate, period, anchors) {
  const halfWidth = Math.trunc(TEMPLATE.halfWidthShare * period * sampleRate);
  const starts = [];
  for (const anchor of anchors) {
    const center = Math.round(anchor * sampleRate);
    if (center >= halfWidth && center + halfWidth < env.length) starts.push(center - halfWidth);
  }
  if (starts.length === 0) return null;
  const length = 2 * halfWidth + 1;
  const shape = new Float64Array(length);
  const column = new Float64Array(starts.length);
  for (let offset = 0; offset < length; offset++) {
    for (let w = 0; w < starts.length; w++) column[w] = env[starts[w] + offset];
    column.sort();
    shape[offset] = column[column.length >> 1];
  }
  return shape;
}

class BeatTemplate {
  constructor(shape, sampleRate, unlockIndex, thirdIndex) {
    const block = makeBlock(shape, shape.length);
    const peak = maxOf(shape);
    const center = shape.length >> 1;
    const reach = Math.trunc(TEMPLATE.sideSearchReach * sampleRate);

    const locate = (index) => {
      const low = Math.max(1, index - reach), high = Math.min(shape.length - 2, index + reach);
      let peakIndex = low;
      for (let i = low + 1; i <= high; i++) if (shape[i] > shape[peakIndex]) peakIndex = i;
      const before = Math.max(0, peakIndex - 2 * reach);
      const pulse = { index: peakIndex, height: shape[peakIndex], base: minOf(shape, before, peakIndex + 1) };
      const onset = onsetTime(pulse, shape, sampleRate);
      const required = Math.max(TEMPLATE.sideMinimumShare * (peak - block.floor), TEMPLATE.sideNoiseMultiple * block.noise);
      return { offset: onset - center / sampleRate, isClear: shape[peakIndex] - block.floor >= required };
    };

    const unlock = locate(unlockIndex);
    this.unlockOffset = unlock.offset;
    this.isUnlockResolved = unlock.isClear;
    this.thirdOffset = thirdIndex == null ? null : locate(thirdIndex).offset;
    this.ceiling = peak;
    this.shape = shape.map((v) => v - block.floor);
    this.sampleRate = sampleRate;
    this.halfWidth = shape.length >> 1;
  }

  /** Slides the whole shape over the beat and returns where it fits best. */
  align(anchor, env) {
    const center = Math.round(anchor * this.sampleRate);
    const reach = Math.trunc(TEMPLATE.alignmentReach * this.sampleRate);
    const hw = this.halfWidth, shape = this.shape, ceiling = this.ceiling, len = shape.length;
    if (!(center - hw - reach >= 0 && center + hw + reach < env.length)) return anchor;
    // Clip once over the whole reach; every lag reads from it.
    const base = center - hw - reach;
    const clipped = new Float64Array(len + 2 * reach);
    for (let i = 0; i < clipped.length; i++) {
      const v = env[base + i];
      clipped[i] = v < 0 ? 0 : v > ceiling ? ceiling : v;
    }
    // scores[k] = Σ shape[i]·clipped[k+i], done as an FFT cross-correlation.
    // clipped is never longer than the transform, so nothing wraps around.
    const n = nextPowerOfTwo(clipped.length);
    if (!this.spectrum || this.spectrum.n !== n) this.spectrum = { n, ...fftReal(shape, n) };
    const { re: xr, im: xi } = fftReal(clipped, n);
    const sr = this.spectrum.re, si = this.spectrum.im;
    for (let i = 0; i < n; i++) {
      // conj(S) · X
      const r = sr[i] * xr[i] + si[i] * xi[i];
      const im = sr[i] * xi[i] - si[i] * xr[i];
      xr[i] = r; xi[i] = -im; // conjugate, so a forward FFT inverts it
    }
    fftInPlace(xr, xi);
    const scores = new Float64Array(2 * reach + 1);
    for (let k = 0; k <= 2 * reach; k++) scores[k] = xr[k] / n;
    let best = 0;
    for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k;
    let refinement = 0;
    if (best > 0 && best < scores.length - 1) {
      const left = scores[best - 1], middle = scores[best], right = scores[best + 1];
      const curvature = left - 2 * middle + right;
      if (curvature < 0) refinement = 0.5 * (left - right) / curvature;
    }
    return (center + best - reach + refinement) / this.sampleRate;
  }
}

function makeTemplatePair(env, sampleRate, period, evenAnchors, oddAnchors) {
  const even = medianShape(env, sampleRate, period, evenAnchors);
  const odd = medianShape(env, sampleRate, period, oddAnchors);
  if (!even || !odd) return null;
  const combined = new Float64Array(even.length);
  for (let i = 0; i < even.length; i++) combined[i] = (even[i] + odd[i]) / 2;
  const pulses = findPulses(combined, 0, combined.length, makeBlock(combined, combined.length),
    Math.trunc(TEMPLATE.minimumPulseSeparation * sampleRate), TEMPLATE.pulseFloorShare);
  const unlock = pulses[0];
  if (!unlock) return null;
  const third = thirdPulse(pulses);
  return {
    even: new BeatTemplate(even, sampleRate, unlock.index, third ? third.index : null),
    odd: new BeatTemplate(odd, sampleRate, unlock.index, third ? third.index : null),
  };
}

// MARK: Regression

const REGRESSION = { gridTolerance: 0.25, anchorCandidates: 8, clipSigmas: 4, clipIterations: 3 };

const alternating = (index) => (index % 2 === 0 ? 1 : -1);

function refinePeriod(beats, period) {
  if (beats.length <= 2) return period;
  const tickToTick = [];
  for (let i = 0; i + 2 < beats.length; i++) {
    const d = beats[i + 2].anchor - beats[i].anchor;
    if (Math.abs(d - 2 * period) <= 0.1 * period) tickToTick.push(d);
  }
  return tickToTick.length === 0 ? period : medianD(tickToTick) / 2;
}

/** Assigns each beat an integer grid position; the longest chain from several starts wins. */
function assignGrid(beats, period) {
  const refined = refinePeriod(beats, period);
  let best = [];
  for (let anchor = 0; anchor < Math.min(REGRESSION.anchorCandidates, beats.length); anchor++) {
    const chain = [{ raw: beats[anchor], index: 0 }];
    for (let b = anchor + 1; b < beats.length; b++) {
      const last = chain[chain.length - 1];
      const steps = (beats[b].anchor - last.raw.anchor) / refined;
      const rounded = Math.round(steps);
      if (rounded >= 1 && Math.abs(steps - rounded) <= REGRESSION.gridTolerance) {
        chain.push({ raw: beats[b], index: last.index + rounded });
      }
    }
    if (chain.length > best.length) best = chain;
  }
  return best;
}

function solve(members, center) {
  const m = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (const member of members) {
    const row = [1, member.index - center, alternating(member.index)];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += row[i] * row[j];
      m[i][3] += row[i] * member.raw.anchor;
    }
  }
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let r = column + 1; r < 3; r++) if (Math.abs(m[r][column]) > Math.abs(m[pivot][column])) pivot = r;
    if (!(Math.abs(m[pivot][column]) > 1e-9)) return null;
    [m[column], m[pivot]] = [m[pivot], m[column]];
    for (let row = 0; row < 3; row++) {
      if (row === column) continue;
      const factor = m[row][column] / m[column][column];
      for (let entry = column; entry <= 3; entry++) m[row][entry] -= factor * m[column][entry];
    }
  }
  return { a: m[0][3] / m[0][0], period: m[1][3] / m[1][1], c: m[2][3] / m[2][2] };
}

function residualOf(member, s, center) {
  return member.raw.anchor - s.a - s.period * (member.index - center) - s.c * alternating(member.index);
}

/** Fits tᵢ = a + P·i + c·(−1)ⁱ with iterative outlier clipping. */
function fitGrid(grid) {
  let members = grid;
  let solution = null;
  let center = 0;
  for (let iteration = 0; iteration <= REGRESSION.clipIterations; iteration++) {
    if (!(members.length > 3)) return null;
    center = members.reduce((s, m) => s + m.index, 0) / members.length;
    const current = solve(members, center);
    if (!current) return null;
    solution = current;
    const spread = 1.4826 * medianD(members.map((m) => Math.abs(residualOf(m, current, center))));
    const limit = Math.max(REGRESSION.clipSigmas * spread, 50e-6);
    const kept = members.filter((m) => Math.abs(residualOf(m, current, center)) <= limit);
    if (kept.length === members.length) break;
    members = kept;
  }
  if (!solution || !(members.length > 3)) return null;
  const residuals = members.map((m) => residualOf(m, solution, center));
  const sigma = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / (members.length - 3));

  const spread = members.reduce((s, m) => s + (m.index - center) ** 2, 0);
  let standardError = Infinity;
  if (spread > 0 && residuals.length > 2) {
    let lagged = 0;
    for (let i = 0; i + 1 < residuals.length; i++) lagged += residuals[i] * residuals[i + 1];
    const total = residuals.reduce((s, r) => s + r * r, 0);
    const correlation = total > 0 ? Math.min(0.95, Math.max(0, lagged / total)) : 0;
    standardError = sigma / Math.sqrt(spread) * Math.sqrt((1 + correlation) / (1 - correlation));
  }
  return { period: solution.period, alternatingTerm: solution.c, residualSigma: sigma, periodStandardError: standardError, members };
}

// MARK: Analyzer

const MINIMUM_SECONDS = 4;
const MAXIMUM_SNR = 120;
const MAXIMUM_UNLOCK_DISAGREEMENT = 0.001;

/**
 * Analyzes mono samples. Returns a plain object mirroring Swift's AnalysisResult;
 * throws AnalysisError("signalTooShort" | "noPeriodicSignal" | "insufficientBeats").
 */
export function analyze(samples, sampleRate, configuration = defaultConfiguration()) {
  const duration = samples.length / sampleRate;
  if (!(duration >= MINIMUM_SECONDS)) throw new AnalysisError("signalTooShort");

  const env = envelope(samples, sampleRate, configuration);

  let detection;
  if (configuration.manualBPH) {
    detection = { bph: configuration.manualBPH, period: 3600 / configuration.manualBPH };
  } else {
    detection = detectBPH(env, sampleRate, configuration);
    if (!detection) throw new AnalysisError("noPeriodicSignal");
  }

  const raw = detectBeats(env, sampleRate, detection.period, configuration);
  const grid = assignGrid(raw, detection.period);
  const initialFit = grid.length >= configuration.minimumBeats ? fitGrid(grid) : null;
  if (!initialFit || initialFit.members.length < configuration.minimumBeats) {
    throw new AnalysisError("insufficientBeats", grid.length);
  }

  const templates = (fit) => makeTemplatePair(env, sampleRate, fit.period,
    fit.members.filter((m) => m.index % 2 === 0).map((m) => m.raw.anchor),
    fit.members.filter((m) => m.index % 2 !== 0).map((m) => m.raw.anchor));

  let fit = initialFit;
  const firstPair = templates(fit);
  if (firstPair) {
    const aligned = grid.map((member) => {
      const side = member.index % 2 === 0 ? firstPair.even : firstPair.odd;
      return { raw: { anchor: side.align(member.raw.anchor, env), peak: member.raw.peak }, index: member.index };
    });
    const refined = fitGrid(aligned);
    if (refined && refined.members.length >= configuration.minimumBeats) fit = refined;
  }
  const pair = templates(fit);
  const evenTemplate = pair ? pair.even : null;
  const oddTemplate = pair ? pair.odd : null;

  const origin = fit.members[0].index;
  const beats = fit.members.map((member) => {
    const side = member.index % 2 === 0 ? evenTemplate : oddTemplate;
    const index = member.index - origin;
    return {
      index,
      isTick: index % 2 === 0,
      unlockTime: member.raw.anchor + (side ? side.unlockOffset : 0),
      thirdPulseTime: side && side.thirdOffset != null ? member.raw.anchor + side.thirdOffset : null,
    };
  });

  const beatError = Math.abs(2 * fit.alternatingTerm
    + (evenTemplate ? evenTemplate.unlockOffset : 0) - (oddTemplate ? oddTemplate.unlockOffset : 0));

  const spans = [evenTemplate, oddTemplate].filter(Boolean)
    .filter((side) => side.thirdOffset != null)
    .map((side) => side.thirdOffset - side.unlockOffset);
  const span = spans.length === 0 ? null : spans.reduce((s, v) => s + v, 0) / spans.length;

  const rateUncertainty = 1.96 * 86400 * (3600 / detection.bph) / (fit.period * fit.period) * fit.periodStandardError;

  const unlocksAgree = pair
    ? pair.even.isUnlockResolved && pair.odd.isUnlockResolved
      && Math.abs(pair.even.unlockOffset - pair.odd.unlockOffset) <= MAXIMUM_UNLOCK_DISAGREEMENT
    : false;

  const quality = assessQuality(fit, rateUncertainty, env,
    duration - configuration.leadInSeconds - configuration.edgeTrimSeconds, unlocksAgree, configuration);

  return {
    bph: detection.bph,
    measuredPeriod: fit.period,
    rate: rate(fit.period, detection.bph),
    rateUncertainty,
    beatErrorMs: beatError * 1000,
    liftAngle: configuration.liftAngle,
    pulseSpanMs: span == null ? null : span * 1000,
    amplitude: span == null ? null : amplitude(configuration.liftAngle, detection.bph, span),
    beats,
    quality,
  };
}

function assessQuality(fit, rateUncertainty, env, duration, unlocksAgree, configuration) {
  const sigmaMs = fit.residualSigma * 1000;
  const floor = medianF(env);
  const peak = medianF(fit.members.map((m) => m.raw.peak));
  const snr = floor > 0
    ? Math.min(MAXIMUM_SNR, 20 * Math.log10(Math.max(peak - floor, Number.MIN_VALUE) / floor))
    : MAXIMUM_SNR;
  const ratio = Math.min(1, fit.members.length / (duration / fit.period));
  const passes = (limits) => unlocksAgree && sigmaMs <= limits.residualSigmaMs && snr >= limits.snrDB
    && ratio >= limits.detectionRatio && rateUncertainty <= limits.rateUncertainty;
  const level = passes(configuration.goodQuality) ? Level.good : passes(configuration.fairQuality) ? Level.fair : Level.poor;
  return { residualSigmaMs: sigmaMs, snrDB: snr, detectionRatio: ratio, level };
}

export function qualityScore(quality) {
  const strength = Math.min(1, Math.max(0, (quality.snrDB - 6) / 14));
  const coverage = Math.min(1, quality.detectionRatio / 0.9);
  const steadiness = Math.min(1, Math.max(0.3, 1 - (quality.residualSigmaMs - 0.3) / 0.7 * 0.7));
  return strength * coverage * steadiness;
}

// MARK: Live measurement

export const SIGNAL_WINDOW_SECONDS = 4;

/** Judges the most recent audio, which should span SIGNAL_WINDOW_SECONDS. */
export function assessSignal(samples, sampleRate, configuration = defaultConfiguration()) {
  const windowConfiguration = ignoringRateUncertainty(configuration);
  windowConfiguration.leadInSeconds = windowConfiguration.edgeTrimSeconds;
  let result;
  try {
    result = analyze(samples, sampleRate, windowConfiguration);
  } catch {
    return { level: 0, isSufficient: false, bph: null };
  }
  const strength = Math.min(1, Math.max(0, (result.quality.snrDB - 6) / (20 - 6)));
  const coverage = Math.min(1, result.quality.detectionRatio / 0.9);
  return { level: strength * coverage, isSufficient: result.quality.level > Level.poor, bph: result.bph };
}

/** One measurement in progress: audio goes in as it arrives, analysis runs on what has been collected. */
export class LiveMeasurement {
  static minimumInterimSeconds = 6;
  static missesBeforeLost = 2;
  static longestBeatGap = 1.5;

  constructor(sampleRate, { duration = 20, maximumDuration = 40, targetUncertainty = 0.5, configuration = defaultConfiguration() } = {}) {
    this.sampleRate = sampleRate;
    this.configuration = configuration;
    this.targetUncertainty = targetUncertainty;
    this.frameCount = Math.trunc(duration * sampleRate);
    this.maximumFrameCount = Math.max(this.frameCount, Math.trunc(maximumDuration * sampleRate));
    this.buffer = new Float32Array(this.maximumFrameCount);
    this.length = 0;
    this.isExtended = false;
    this.missedChecks = 0;
  }

  get samples() { return this.buffer.subarray(0, this.length); }
  get progress() { return this.length / this.frameCount; }
  get isComplete() { return this.length >= this.frameCount; }
  get elapsed() { return this.length / this.sampleRate; }

  append(newSamples) {
    const room = this.frameCount - this.length;
    const count = Math.min(room, newSamples.length);
    if (count <= 0) return;
    this.buffer.set(newSamples.subarray(0, count), this.length);
    this.length += count;
  }

  /** "collecting" | "extended" | "finished" */
  completion() {
    if (!this.isComplete) return "collecting";
    if (this.isExtended || !(this.frameCount < this.maximumFrameCount)) return "finished";
    let result;
    try { result = this.finish(); } catch { return "finished"; }
    if (!(result.rateUncertainty > this.targetUncertainty)) return "finished";
    this.isExtended = true;
    this.frameCount = this.maximumFrameCount;
    return "extended";
  }

  /**
   * One analysis per second serves both the interim figure and the dropout check;
   * the Swift version runs the same analysis twice with configurations that only
   * differ in the quality grade, which the dropout check doesn't read.
   * Returns { interim, signalLost }.
   */
  update() {
    let interim = null;
    if (this.elapsed >= LiveMeasurement.minimumInterimSeconds
      || this.elapsed >= this.configuration.leadInSeconds + SIGNAL_WINDOW_SECONDS) {
      try { interim = analyze(this.samples, this.sampleRate, ignoringRateUncertainty(this.configuration)); } catch { interim = null; }
    }
    let signalLost = false;
    if (this.elapsed >= this.configuration.leadInSeconds + SIGNAL_WINDOW_SECONDS) {
      const lastBeat = interim && interim.beats[interim.beats.length - 1];
      if (lastBeat && this.elapsed - lastBeat.unlockTime > LiveMeasurement.longestBeatGap) {
        signalLost = true;
      } else {
        const recent = this.samples.subarray(Math.max(0, this.length - Math.trunc(SIGNAL_WINDOW_SECONDS * this.sampleRate)));
        const status = assessSignal(recent, this.sampleRate, this.configuration);
        this.missedChecks = status.isSufficient ? 0 : this.missedChecks + 1;
        signalLost = this.missedChecks >= LiveMeasurement.missesBeforeLost;
      }
    }
    return { interim: this.elapsed >= LiveMeasurement.minimumInterimSeconds ? interim : null, signalLost };
  }

  finish() {
    return analyze(this.samples, this.sampleRate, this.configuration);
  }
}

// MARK: Presentation

/** Paper-tape points: deviation of each beat from a perfect watch, in ms. */
export function tapePoints(result) {
  const first = result.beats[0];
  if (!first) return [];
  const idealPeriod = 3600 / result.bph;
  return result.beats.map((beat) => ({
    elapsed: beat.unlockTime - first.unlockTime,
    deviationMs: (beat.unlockTime - (first.unlockTime + beat.index * idealPeriod)) * 1000,
    isTick: beat.isTick,
  }));
}

/** Community rules of thumb: "good" | "caution" | "critical". */
export function amplitudeGrade(value) {
  if (value >= 250 && value <= 310) return "good";
  if (value < 220) return "critical";
  return "caution";
}

export function beatErrorGrade(ms) {
  if (ms <= 0.3) return "good";
  if (ms < 0.6) return "caution";
  return "critical";
}

export function positionSummary(rates) {
  if (rates.length === 0) return null;
  return { meanRate: rates.reduce((s, r) => s + r, 0) / rates.length, maximumDeviation: Math.max(...rates) - Math.min(...rates) };
}

// MARK: WAV

/** Decodes PCM16/24/32, float32/64 and extensible WAVs to mono. */
export function decodeWAV(arrayBuffer) {
  const v = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (v.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("notRIFFWave");
  let format = null, body = null, offset = 12;
  while (offset + 8 <= v.byteLength) {
    const id = tag(offset), size = v.getUint32(offset + 4, true), start = offset + 8;
    const end = Math.min(start + size, v.byteLength);
    if (id === "fmt " && end - start >= 16) {
      let formatTag = v.getUint16(start, true);
      if (formatTag === 0xfffe && end - start >= 26) formatTag = v.getUint16(start + 24, true);
      format = { tag: formatTag, channels: v.getUint16(start + 2, true), rate: v.getUint32(start + 4, true), bits: v.getUint16(start + 14, true) };
    } else if (id === "data") {
      body = { start, end };
    }
    offset = start + size + (size & 1);
  }
  if (!format || !body || format.channels <= 0) throw new Error("unsupportedWAV");
  const bytes = format.bits / 8, frameBytes = bytes * format.channels;
  const frames = Math.floor((body.end - body.start) / frameBytes);
  const read = (o) => {
    if (format.tag === 3) return format.bits === 64 ? v.getFloat64(o, true) : v.getFloat32(o, true);
    if (format.bits === 16) return v.getInt16(o, true) / 32768;
    if (format.bits === 24) return ((v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16))) / 8388608;
    if (format.bits === 32) return v.getInt32(o, true) / 2147483648;
    if (format.bits === 8) return (v.getUint8(o) - 128) / 128;
    throw new Error("unsupportedWAV");
  };
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < format.channels; c++) sum += read(body.start + f * frameBytes + c * bytes);
    mono[f] = sum / format.channels;
  }
  return { samples: mono, sampleRate: format.rate };
}

/** 16-bit mono PCM; small enough to keep a few recordings on a phone. */
export function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVEfmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return buffer;
}
