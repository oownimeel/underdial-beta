// Runs analysis off the main thread, with the same loop as the iOS MeasurementEngine:
// every 250 ms new audio is taken in; once a second the signal (or the interim result) is analyzed.
import { LiveMeasurement, assessSignal, SIGNAL_WINDOW_SECONDS, defaultConfiguration } from "./engine.js";
import { diagnose } from "./diagnose.js";

const TICK_MS = 250;
const TICKS_PER_ANALYSIS = 4;

let sampleRate = 48000;
let pending = [];
let recent = null;
let recentLength = 0;
let measurement = null;
let measureRequest = null;
let cancelRequested = false;
let tickCount = 0;
let lastInterim = null;
let timer = null;
let phase = "idle";
// While the signal won't settle, the last few seconds are checked for the likely cause.
const HINT_SECONDS = 8;
const HINT_AFTER_SECONDS = 6;
let hintChunks = [];
let hintLength = 0;
let unsettledTicks = 0;
let hint = null;

function pushHint(samples) {
  hintChunks.push(samples.slice());
  hintLength += samples.length;
  while (hintChunks.length > 1 && hintLength - hintChunks[0].length >= HINT_SECONDS * sampleRate) {
    hintLength -= hintChunks.shift().length;
  }
}

function hintSamples() {
  const out = new Float32Array(hintLength);
  let offset = 0;
  for (const chunk of hintChunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

function resetHint() {
  hintChunks = []; hintLength = 0; unsettledTicks = 0; hint = null;
}

function post(message) {
  self.postMessage(message);
}

function drain() {
  if (pending.length === 0) return null;
  const total = pending.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of pending) { out.set(chunk, offset); offset += chunk.length; }
  pending = [];
  return out;
}

/** Keeps the last SIGNAL_WINDOW_SECONDS of audio for the signal check. */
function pushRecent(samples) {
  const capacity = recent.length;
  if (samples.length >= capacity) {
    recent.set(samples.subarray(samples.length - capacity));
    recentLength = capacity;
    return;
  }
  const keep = Math.min(recentLength, capacity - samples.length);
  recent.copyWithin(0, recentLength - keep, recentLength);
  recent.set(samples, keep);
  recentLength = keep + samples.length;
}

function loop() {
  tickCount++;
  const isAnalysisTick = tickCount % TICKS_PER_ANALYSIS === 0;
  const fresh = drain();

  if (phase === "measuring") {
    if (fresh) measurement.append(fresh);
    if (cancelRequested) {
      cancelRequested = false;
      measurement = null;
      recentLength = 0; resetHint();
      phase = "listening";
      post({ type: "listening", status: { level: 0, isSufficient: false, bph: null } });
      return;
    }
    const completion = measurement.completion();
    if (completion === "finished") {
      finish();
      return;
    }
    if (completion === "extended") post({ type: "notice", key: "extended" });
    let interim = lastInterim;
    if (isAnalysisTick) {
      const update = measurement.update();
      if (update.signalLost) {
        measurement = null;
        recentLength = 0; resetHint();
        phase = "listening";
        post({ type: "notice", key: "lost" });
        post({ type: "listening", status: { level: 0, isSufficient: false, bph: null } });
        return;
      }
      if (update.interim) interim = lastInterim = slim(update.interim);
    }
    post({ type: "measuring", progress: measurement.progress, elapsed: measurement.elapsed, extended: measurement.isExtended, interim });
    return;
  }

  if (fresh) { pushRecent(fresh); pushHint(fresh); }

  if (measureRequest) {
    const { duration, configuration } = measureRequest;
    measureRequest = null;
    lastInterim = null;
    measurement = new LiveMeasurement(sampleRate, { duration, configuration });
    phase = "measuring";
    post({ type: "measuring", progress: 0, elapsed: 0, extended: false, interim: null });
    return;
  }

  if (isAnalysisTick && phase === "listening") {
    const status = recentLength === recent.length
      ? assessSignal(recent, sampleRate)
      : { level: 0, isSufficient: false, bph: null };
    if (status.isSufficient) { unsettledTicks = 0; hint = null; }
    else {
      unsettledTicks++;
      // Every other second after the first few, so the hint doesn't flicker.
      if (unsettledTicks >= HINT_AFTER_SECONDS && unsettledTicks % 2 === 0) hint = diagnose(hintSamples(), sampleRate);
    }
    post({ type: "listening", status: { ...status, hint, seconds: unsettledTicks } });
  }
}

/** Beats are large; the UI only needs the figures and the paper tape. */
function slim(result) {
  const { beats, ...rest } = result;
  return { ...rest, beatCount: beats.length };
}

function finish() {
  clearInterval(timer);
  timer = null;
  phase = "idle";
  const samples = measurement.samples.slice();
  let result = null, error = null, reason = null;
  try {
    result = measurement.finish();
  } catch (e) {
    error = e.code || "failed";
    try { reason = diagnose(samples, sampleRate); } catch { reason = null; }
  }
  measurement = null;
  post({ type: "finished", result, error, reason, samples, sampleRate });
}

self.onmessage = (event) => {
  const message = event.data;
  switch (message.type) {
    case "start":
      sampleRate = message.sampleRate;
      recent = new Float32Array(Math.trunc(SIGNAL_WINDOW_SECONDS * sampleRate));
      recentLength = 0;
      resetHint();
      pending = [];
      measurement = null;
      measureRequest = null;
      phase = "listening";
      tickCount = 0;
      clearInterval(timer);
      timer = setInterval(loop, TICK_MS);
      break;
    case "audio":
      pending.push(message.samples);
      break;
    case "measure":
      measureRequest = { duration: message.duration || 20, configuration: { ...defaultConfiguration(), ...message.configuration } };
      pending = [];
      break;
    case "cancel":
      if (phase === "measuring") cancelRequested = true;
      break;
    case "stop":
      clearInterval(timer);
      timer = null;
      phase = "idle";
      measurement = null;
      pending = [];
      break;
  }
};
