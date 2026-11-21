// Microphone capture. Browsers clean up voice by default (echo cancellation,
// noise suppression, auto gain); all three would damage tick sounds, so all are turned off.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.length = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      // Batch the 128-frame render quanta so the main thread isn't flooded.
      if (this.length + channel.length > this.buffer.length) this.flush();
      this.buffer.set(channel, this.length);
      this.length += channel.length;
      if (this.length >= this.buffer.length) this.flush();
    }
    return true;
  }
  flush() {
    if (this.length === 0) return;
    const out = this.buffer.slice(0, this.length);
    this.port.postMessage(out, [out.buffer]);
    this.length = 0;
  }
}
registerProcessor("underdial-tap", Tap);
`;

export class Microphone {
  constructor(onSamples) {
    this.onSamples = onSamples;
    this.context = null;
    this.stream = null;
    this.node = null;
    this.wakeLock = null;
    this.onVisibility = () => this.reacquireWakeLock();
  }

  get sampleRate() { return this.context ? this.context.sampleRate : 48000; }

  /** What the browser actually applied, for the settings screen and diagnostics. */
  get settings() {
    const track = this.stream && this.stream.getAudioTracks()[0];
    const s = track && track.getSettings ? track.getSettings() : {};
    return {
      label: track ? track.label : "",
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      sampleRate: this.sampleRate,
    };
  }

  /** Must be called from a tap or click: browsers only start audio after a user gesture. */
  async start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      this.context = new AudioContextClass({ sampleRate: 48000, latencyHint: "interactive" });
    } catch {
      this.context = new AudioContextClass();
    }
    const resumed = this.context.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
          sampleRate: 48000,
        },
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
    await resumed;

    const source = this.context.createMediaStreamSource(this.stream);
    const silent = this.context.createGain();
    silent.gain.value = 0;
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await this.context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.context, "underdial-tap", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      this.node.port.onmessage = (event) => this.onSamples(event.data);
    } catch {
      // Older browsers: the deprecated processor still works.
      this.node = this.context.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (event) => this.onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
    }
    source.connect(this.node);
    this.node.connect(silent);
    silent.connect(this.context.destination);

    await this.reacquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  async reacquireWakeLock() {
    if (document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
    try { this.wakeLock = await navigator.wakeLock.request("screen"); } catch { /* not granted */ }
  }

  async stop() {
    document.removeEventListener("visibilitychange", this.onVisibility);
    try { this.wakeLock && (await this.wakeLock.release()); } catch { /* already released */ }
    this.wakeLock = null;
    if (this.node) { try { this.node.disconnect(); } catch { /* detached */ } }
    if (this.node && this.node.port) this.node.port.onmessage = null;
    this.node = null;
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.context) { try { await this.context.close(); } catch { /* closed */ } }
    this.context = null;
  }
}
