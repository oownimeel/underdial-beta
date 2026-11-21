// The measuring stage: black backdrop, motion gauge, and a white card below it.
// ready → listening (signal check) → measuring (20 s, up to 40 s) → finished.
import { t } from "../i18n.js";
import { esc, icon, toast, formatRate, formatNumber, grade, isIOS } from "../ui.js";
import * as store from "../store.js";
import { MotionGauge, paintTape } from "../dial.js";
import { Microphone } from "../audio.js";
import { amplitude, amplitudeGrade, beatErrorGrade, tapePoints, positionSummary, encodeWAV, DEFAULT_LIFT_ANGLE } from "../engine.js";
import { openEditWatch, thumb, paintThumbs } from "./watch.js";
import { openResultCard } from "../card.js";
import { PlacementGuide, PLACEMENT_TEXT } from "../placement.js";
import { interpretationHTML } from "../interpret.js";
import { logEvent } from "../log.js";

// Why a measurement gave no result (see diagnose.js), and what to try next.
const REASONS = {
  quiet: { title: "소리가 거의 들리지 않아요", tips: [
    "휴대폰 아래쪽 끝(마이크 구멍)을 시계 유리에 직접 붙여 주세요.",
    "두꺼운 케이스, 이어폰이나 블루투스 마이크가 연결되어 있지 않은지 확인해 주세요.",
    "시계가 멈춰 있지 않은지 확인해 주세요. 태엽을 감으면 다시 움직입니다."] },
  noisy: { title: "주변 소음이 커요", tips: [
    "대화, 음악, 에어컨 소리가 없는 조용한 곳에서 다시 측정해 주세요.",
    "시계를 천이나 손바닥 위에 두면 책상에서 울리는 소리가 줄어듭니다."] },
  knocked: { title: "부딪히거나 긁히는 소리가 들렸어요", tips: [
    "휴대폰을 가볍게 댄 채 측정이 끝날 때까지 움직이지 마세요.",
    "손으로 들고 있다면 시계를 천 위에 내려놓고 재 보세요."] },
  quartz: { title: "쿼츠(배터리) 시계로 보여요", tips: [
    "1초에 한 번씩 똑딱이는 소리가 들립니다.",
    "Underdial은 기계식(오토매틱·수동) 시계만 측정할 수 있어요."] },
  irregular: { title: "박동은 들리지만 일정하지 않아요", tips: [
    "측정 중 휴대폰이나 시계가 움직였을 수 있어요. 고정한 채 다시 재 보세요.",
    "휴대폰을 대는 위치를 조금 옮겨 가장 또렷하게 들리는 곳을 찾아 주세요.",
    "태엽이 거의 풀렸다면 감은 뒤 다시 재 보세요."] },
};

const HINTS = {
  quiet: "소리가 거의 들리지 않아요. 마이크(아래쪽 끝)를 시계에 직접 붙여 주세요.",
  noisy: "주변 소음이 커요. 조용한 곳으로 옮겨 주세요.",
  knocked: "움직이거나 부딪히는 소리가 들려요. 가만히 대 주세요.",
  quartz: "1초 간격의 소리가 들려요. 쿼츠 시계는 측정할 수 없어요.",
  irregular: "박동이 들려요. 위치를 조금씩 옮겨 가장 또렷한 곳을 찾아 주세요.",
};

export const POSITIONS = [
  { id: "dialUp", label: "다이얼 위" },
  { id: "dialDown", label: "다이얼 아래" },
  { id: "crownUp", label: "크라운 위" },
  { id: "crownDown", label: "크라운 아래" },
  { id: "crownLeft", label: "크라운 왼쪽" },
  { id: "crownRight", label: "크라운 오른쪽" },
];
export const positionLabel = (id) => { const p = POSITIONS.find((x) => x.id === id); return p ? t(p.label) : ""; };

const DURATION = 20;
let active = null;

export function openMeasure({ mode = "single", watchId = null } = {}) {
  if (active) return;
  active = new Stage(mode, watchId);
}

class Stage {
  constructor(mode, watchId) {
    this.mode = mode;
    this.watchId = watchId;
    this.watches = [];
    this.position = mode === "positions" ? POSITIONS[0].id : null;
    this.positionIndex = 0;
    this.positionResults = [];       // [{ position, result }]
    this.phase = "ready";
    this.status = null;
    this.progress = 0;
    this.elapsed = 0;
    this.interim = null;
    this.result = null;
    this.saved = null;
    this.notice = null;
    this.error = null;
    this.mic = null;
    this.worker = null;
    this.autoStartArmed = false;

    this.el = document.createElement("div");
    this.el.className = "stage";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", t("측정"));
    this.el.innerHTML = `
      <div class="stage-head">
        <div class="wordmark" aria-hidden="true">Underdial</div>
        <button class="icon-btn" data-close aria-label="${esc(t("닫기"))}">${icon("close")}</button>
      </div>
      <div class="stage-main">
        <div class="placement" aria-hidden="true"><canvas></canvas></div>
        <div class="gauge">
          <canvas aria-hidden="true"></canvas>
          <div class="gauge-text"><div class="gauge-value num" data-value>–</div><div class="gauge-caption" data-caption></div><div class="gauge-detail" data-detail></div></div>
        </div>
      </div>
      <section class="stage-card"><div class="stage-card-inner" data-card></div></section>`;
    document.body.append(this.el);
    this.gauge = new MotionGauge(this.el.querySelector(".gauge canvas"));
    this.placement = new PlacementGuide(this.el.querySelector(".placement canvas"));
    this.el.querySelector("[data-close]").onclick = () => this.close();

    this.onPop = () => this.close({ fromHistory: true });
    history.pushState({ underdialMeasure: true }, "");
    window.addEventListener("popstate", this.onPop);
    this.onHidden = () => {
      if (document.visibilityState === "hidden" && this.phase === "measuring") {
        this.worker && this.worker.postMessage({ type: "cancel" });
        this.notice = t("화면을 벗어나 측정을 멈췄습니다. 돌아와서 다시 시작해 주세요.");
      }
    };
    document.addEventListener("visibilitychange", this.onHidden);

    store.watches().then((ws) => {
      this.watches = ws;
      if (!ws.some((w) => w.id === this.watchId)) this.watchId = ws[0] ? ws[0].id : null;
      this.render();
    });
    this.render();
  }

  get watch() { return this.watches.find((w) => w.id === this.watchId) || null; }
  get liftAngle() { return store.effectiveLiftAngle(this.watch); }

  // MARK: Audio and worker

  async startListening() {
    this.error = null;
    this.reason = null;
    this.notice = null;
    this.worker = new Worker(new URL("../analysis-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (event) => this.onWorker(event.data);
    this.worker.onerror = (event) => {
      logEvent("error", `worker: ${event && event.message || "failed to start"}`);
      this.fail(t("분석을 시작하지 못했습니다. 브라우저를 최신 버전으로 업데이트해 주세요."));
    };
    this.mic = new Microphone((samples) => this.worker && this.worker.postMessage({ type: "audio", samples }, [samples.buffer]));
    try {
      await this.mic.start();
    } catch (error) {
      this.stopAudio();
      const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
      logEvent("mic", `${error && error.name || "Error"}: ${error && error.message || ""}`);
      this.phase = denied ? "denied" : "failed";
      this.error = denied ? null : t("마이크를 열지 못했습니다. 다른 앱이 마이크를 쓰고 있지 않은지 확인해 주세요.");
      this.render();
      return;
    }
    this.worker.postMessage({ type: "start", sampleRate: this.mic.sampleRate });
    this.phase = "listening";
    this.status = null;
    this.autoStartArmed = store.prefs().autoStart;
    this.render();
  }

  stopAudio() {
    if (this.mic) { this.mic.stop(); this.mic = null; }
    if (this.worker) { this.worker.postMessage({ type: "stop" }); this.worker.terminate(); this.worker = null; }
  }

  beginMeasurement() {
    if (!this.worker) return;
    this.notice = null;
    this.worker.postMessage({ type: "measure", duration: DURATION, configuration: { liftAngle: this.liftAngle } });
  }

  onWorker(message) {
    switch (message.type) {
      case "listening":
        this.phase = "listening";
        this.status = message.status;
        if (this.autoStartArmed && message.status.isSufficient) {
          this.autoStartArmed = false;
          this.beginMeasurement();
        }
        break;
      case "measuring":
        this.phase = "measuring";
        this.progress = message.progress;
        this.elapsed = message.elapsed;
        this.interim = message.interim;
        break;
      case "notice":
        this.notice = message.key === "lost"
          ? t("신호가 끊겨 측정을 멈췄습니다. 휴대폰 아래쪽 끝을 시계 유리에 다시 붙여 주세요.")
          : t("정밀도를 높이기 위해 측정을 최대 40초까지 이어갑니다.");
        if (message.key === "lost") this.autoStartArmed = store.prefs().autoStart;
        break;
      case "finished":
        this.onFinished(message);
        return;
    }
    this.render();
  }

  async onFinished({ result, error, reason, samples, sampleRate }) {
    const settings = this.mic ? this.mic.settings : null;
    this.stopAudio();
    this.micLabel = settings && settings.label ? settings.label : null;
    if (this.micLabel) store.setPrefs({ lastMic: this.micLabel });
    if (store.prefs().keepRecordings && samples && samples.length) {
      const blob = new Blob([encodeWAV(samples, sampleRate)], { type: "audio/wav" });
      store.saveRecording({ watchName: this.watch ? this.watch.name : "", seconds: samples.length / sampleRate, sampleRate, blob }).catch(() => {});
    }
    const seconds = samples && sampleRate ? Math.round(samples.length / sampleRate) : 0;
    if (!result) {
      logEvent("measure", `failed ${error || ""} → ${reason || "unknown"} · ${seconds}s`);
      this.fail(t("녹음에서 시계 박동을 찾지 못했습니다. 시계를 더 가까이 대고 다시 측정해 주세요."), reason);
      return;
    }
    if (result.quality.level === 0) {
      logEvent("measure", `unstable · ${result.bph} BPH · SNR ${result.quality.snrDB.toFixed(0)} dB · σ ${result.quality.residualSigmaMs.toFixed(2)} ms · ${seconds}s`);
    }
    this.result = result;
    this.saved = null;
    this.phase = "finished";
    this.completedAt = performance.now();
    if (this.mode === "positions") this.positionResults[this.positionIndex] = { position: this.position, result };
    if (navigator.vibrate) navigator.vibrate(30);
    this.render();
  }

  fail(message, reason = null) {
    this.stopAudio();
    this.phase = "failed";
    this.error = message;
    this.reason = REASONS[reason] ? reason : null;
    this.render();
  }

  close({ fromHistory = false } = {}) {
    // Someone who gives up while the signal never settled is the failure we most need to hear about.
    if (this.phase === "listening" && this.status && !this.status.isSufficient && this.status.seconds >= 15) {
      logEvent("measure", `closed while listening · ${this.status.seconds}s · ${this.status.hint || "no hint"} · level ${Math.round(this.status.level * 100)}%`);
    }
    this.stopAudio();
    this.gauge.destroy();
    this.placement.stop();
    window.removeEventListener("popstate", this.onPop);
    document.removeEventListener("visibilitychange", this.onHidden);
    this.el.style.transition = "opacity 220ms ease";
    this.el.style.opacity = "0";
    setTimeout(() => this.el.remove(), 230);
    active = null;
    if (!fromHistory && history.state && history.state.underdialMeasure) history.back();
  }

  // MARK: Saving

  measurementRecord(result, position) {
    return {
      watchId: this.watchId,
      bph: result.bph,
      rate: result.rate,
      beatErrorMs: result.beatErrorMs,
      pulseSpanMs: result.pulseSpanMs,
      liftAngle: this.liftAngle,
      residualSigmaMs: result.quality.residualSigmaMs,
      snrDB: result.quality.snrDB,
      qualityLevel: result.quality.level,
      position,
      hoursSinceWinding: null,
      rateUncertainty: result.rateUncertainty,
      device: this.micLabel || (isIOS() ? "iPhone" : /Android/.test(navigator.userAgent) ? "Android" : ""),
    };
  }

  async ensureWatch() {
    if (this.watch) return true;
    return new Promise((resolve) => {
      openEditWatch(null, {
        onSaved: async (w) => {
          this.watches = await store.watches();
          this.watchId = w.id;
          this.render();
          resolve(true);
        },
      });
    });
  }

  // `saving` stops a quick double tap from storing the same result twice.
  async save() {
    if (this.saving || this.saved) return;
    this.saving = true;
    try {
      if (!(await this.ensureWatch())) return;
      this.saved = await store.saveMeasurement(this.measurementRecord(this.result, this.position));
      store.setPrefs({ lastWatchId: this.watchId });
    } finally {
      this.saving = false;
    }
    this.render();
  }

  async saveAllPositions() {
    if (this.saving) return;
    this.saving = true;
    try {
      if (!(await this.ensureWatch())) return;
      for (const entry of this.positionResults.filter(Boolean)) {
        if (entry.result.quality.level > 0) await store.saveMeasurement(this.measurementRecord(entry.result, entry.position));
      }
    } finally {
      this.saving = false;
    }
    store.setPrefs({ lastWatchId: this.watchId });
    toast(t("포지션 측정을 모두 저장했습니다."));
    this.close();
  }

  nextPosition() {
    this.positionIndex += 1;
    this.position = POSITIONS[this.positionIndex].id;
    this.result = null;
    this.phase = "ready";
    this.render();
  }

  retake() {
    this.result = null;
    this.saved = null;
    this.phase = "ready";
    this.render();
    this.startListening();
  }

  // MARK: Rendering

  renderGauge() {
    const value = this.el.querySelector("[data-value]");
    const caption = this.el.querySelector("[data-caption]");
    const detail = this.el.querySelector("[data-detail]");
    let fill = 0, pulseRate = null, isLive = false, v = "–", c = "", d = "";
    if (this.phase === "ready") {
      c = this.mode === "positions" ? positionLabel(this.position) : t("준비");
      v = this.mode === "positions" ? `${this.positionIndex + 1}/6` : "–";
    } else if (this.phase === "listening") {
      const level = this.status ? this.status.level : 0;
      fill = level;
      v = `${Math.round(level * 100)}%`;
      c = t("신호");
      // A beat rate guessed from a weak signal is noise; show it only once the signal holds.
      d = this.status && this.status.isSufficient && this.status.bph ? `${formatNumber(this.status.bph)} BPH` : "";
      pulseRate = this.status && this.status.isSufficient ? 1.2 : null;
      isLive = true;
    } else if (this.phase === "measuring") {
      fill = this.progress;
      isLive = true;
      pulseRate = 1.2;
      v = this.interim ? formatRate(this.interim.rate) : "···";
      c = t("s/d · 실시간");
      d = this.interim ? `±${this.interim.rateUncertainty.toFixed(1)}` : t("{s}초", { s: Math.floor(this.elapsed) });
    } else if (this.phase === "finished") {
      fill = 1;
      v = formatRate(this.result.rate);
      c = t("s/d · 측정");
      d = `±${this.result.rateUncertainty.toFixed(1)}`;
    }
    value.textContent = v;
    caption.textContent = c;
    detail.textContent = d;
    this.gauge.update({ fill, pulseRate, isLive, completedAt: this.phase === "finished" ? this.completedAt : null });
  }

  watchPicker() {
    if (this.watches.length === 0) {
      return `<div class="row between"><span class="caption">${esc(t("저장하려면 시계가 필요합니다."))}</span><button class="link-btn" data-new-watch>${esc(t("시계 추가"))}</button></div>`;
    }
    return `<div class="field"><span class="label">${esc(t("시계"))}</span><div class="chips scroller" data-watch-chips>${this.watches.map((w) =>
      `<button class="chip row" style="gap:8px;padding:5px 12px 5px 5px" data-watch="${w.id}" aria-pressed="${w.id === this.watchId}">${thumb(w, 26)}${esc(w.name)}</button>`).join("")}</div></div>`;
  }

  positionPicker() {
    return `<div class="field"><span class="label">${esc(t("포지션"))}</span><div class="chips">${POSITIONS.map((p) =>
      `<button class="chip" data-position="${p.id}" aria-pressed="${p.id === this.position}">${esc(t(p.label))}</button>`).join("")}</div></div>`;
  }

  liftNote() {
    const w = this.watch;
    const angle = w && w.liftAngle ? w.liftAngle : DEFAULT_LIFT_ANGLE;
    return w && w.liftAngle
      ? t("리프트 앵글 {angle}° · 참고 기준이며 공식 규격이 아닙니다.", { angle })
      : t("리프트 앵글 {angle}° (기본값) · 참고 기준이며 공식 규격이 아닙니다.", { angle });
  }

  /** The plain-language reading under a final result. */
  reading(result) {
    if (!result || result.quality.level === 0) return "";
    const amp = result.pulseSpanMs != null ? amplitude(this.liftAngle, result.bph, result.pulseSpanMs / 1000) : null;
    return interpretationHTML({
      rate: result.rate,
      amplitude: amp != null && isFinite(amp) ? amp : null,
      beatErrorMs: result.beatErrorMs,
      liftAngleIsDefault: !(this.watch && this.watch.liftAngle),
    });
  }

  metrics(result, live = false) {
    const amp = result && result.pulseSpanMs != null ? amplitude(this.liftAngle, result.bph, result.pulseSpanMs / 1000) : null;
    const be = result ? result.beatErrorMs : null;
    const ampGrade = amp == null || live ? "" : amplitudeGrade(amp);
    const beGrade = be == null || live ? "" : beatErrorGrade(be);
    return `<div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="metric"><span class="label">Beat error</span><span class="value ${beGrade}">${be == null ? "–" : be.toFixed(2)}<small>${be == null ? "" : "ms"}</small></span></div>
      <div class="metric"><span class="label">Amplitude</span><span class="value ${ampGrade}">${amp == null ? "–" : Math.round(amp)}<small>${amp == null ? "" : "°"}</small></span></div>
      <div class="metric"><span class="label">BPH</span><span class="value">${result ? formatNumber(result.bph) : "–"}</span></div>
    </div>`;
  }

  render() {
    // Before listening, the stage shows how to hold the phone instead of an empty gauge.
    this.el.dataset.phase = this.phase;
    if (this.phase === "ready") { this.placement.setPosition(this.position); this.placement.start(); this.placement.redraw(); }
    else this.placement.stop();
    this.renderGauge();
    const card = this.el.querySelector("[data-card]");
    const notice = this.notice ? `<div class="notice">${esc(this.notice)}</div>` : "";
    let html = "";

    if (this.phase === "ready") {
      const title = this.mode === "positions"
        ? t("{n}번째 포지션: {name}", { n: this.positionIndex + 1, name: positionLabel(this.position) })
        : t("올바른 위치 찾기");
      html = `
        <div class="stage-card-scroll">
          <h2>${esc(title)}</h2>
          ${this.mode === "positions" && this.positionIndex > 0 ? `<div class="notice" style="background:var(--bg);color:var(--text)">${esc(t("시계를 다음 포지션으로 돌려 주세요."))}</div>` : ""}
          <ol class="guide-steps">
            <li>${esc(t("조용한 곳에서 시계를 손에 들거나 천 위에 놓습니다."))}</li>
            <li>${esc(t(PLACEMENT_TEXT[this.position || "dialUp"]))}</li>
            <li>${esc(t("측정이 끝날 때까지 20초 동안 움직이지 마세요."))}</li>
          </ol>
          ${this.watchPicker()}
          ${this.mode === "single" ? this.positionPicker() : ""}
          ${notice}
        </div>
        <button class="btn btn-primary btn-block" data-listen>${icon("mic")}${esc(t("마이크 켜고 시작"))}</button>
        <p class="caption" style="margin:0;text-align:center">${esc(t("소리는 이 기기 안에서만 처리됩니다."))}</p>`;
    } else if (this.phase === "listening") {
      const s = this.status;
      const pill = !s ? `<span class="status-pill wait">${esc(t("소리를 듣는 중…"))}</span>`
        : s.isSufficient ? `<span class="status-pill">${icon("check", 'width="16" height="16"')}${esc(t("신호 안정"))} · ${formatNumber(s.bph)} BPH</span>`
        : s.hint && HINTS[s.hint] ? `<span class="status-pill wait hint">${esc(t(HINTS[s.hint]))}</span>`
        : s.level > 0 ? `<span class="status-pill wait">${esc(t("신호가 약합니다. 위치를 조금씩 옮겨 보세요."))}</span>`
        : `<span class="status-pill wait">${esc(t("시계를 찾는 중…"))}</span>`;
      const auto = store.prefs().autoStart;
      html = `
        <div class="stage-card-scroll">
          <div class="row between"><h2>${esc(t("신호"))}</h2><span class="caption">${esc(t("{n}초 측정", { n: DURATION }))}</span></div>
          <div class="signal-meter"><i style="width:${Math.round((s ? s.level : 0) * 100)}%;background:${s && s.isSufficient ? "var(--good)" : "var(--warn)"}"></i></div>
          <div>${pill}</div>
          ${notice}
          <label class="row between" for="auto-start"><span class="stack" style="gap:0"><span style="font-weight:500">${esc(t("다음부터 자동 시작"))}</span><span class="caption">${esc(t("신호가 잡히면 바로 측정을 시작합니다."))}</span></span>
            <span class="switch"><input type="checkbox" id="auto-start" ${auto ? "checked" : ""}><span></span></span></label>
        </div>
        <button class="btn btn-primary btn-block" data-start ${s && s.isSufficient ? "" : 'style="opacity:0.55"'}>${esc(t("측정 시작"))}</button>`;
    } else if (this.phase === "measuring") {
      html = `
        <div class="stage-card-scroll">
          <div class="row between"><h2>${esc(t("측정 중"))}</h2><span class="num caption">${Math.floor(this.elapsed)} / ${this.interim && this.progress > 0 ? Math.round(this.elapsed / this.progress) : DURATION}${esc(t("초"))}</span></div>
          <div class="progress-line"><i style="width:${Math.min(100, this.progress * 100)}%"></i></div>
          ${this.metrics(this.interim, true)}
          ${notice || `<p class="caption" style="margin:0">${esc(t("휴대폰과 시계를 움직이지 마세요."))}</p>`}
        </div>
        <button class="btn btn-secondary btn-block" data-cancel>${esc(t("취소"))}</button>`;
    } else if (this.phase === "finished") {
      html = this.finishedCard();
    } else if (this.phase === "denied") {
      html = `
        <div class="stage-card-scroll">
          <h2>${esc(t("마이크 권한이 필요합니다"))}</h2>
          <p class="caption" style="font-size:14px">${esc(isIOS()
            ? t("설정 › Safari › 마이크에서 허용하거나, 주소창의 \"가가\" 메뉴 › 웹사이트 설정에서 마이크를 허용한 뒤 다시 시도해 주세요.")
            : t("주소창의 자물쇠 아이콘 › 권한에서 마이크를 허용한 뒤 다시 시도해 주세요."))}</p>
        </div>
        <button class="btn btn-primary btn-block" data-listen>${esc(t("다시 시도"))}</button>`;
    } else if (this.phase === "failed") {
      html = `
        <div class="stage-card-scroll"><h2>${esc(t("측정하지 못했습니다"))}</h2>${this.reason ? `
          <div class="notice"><strong>${esc(t(REASONS[this.reason].title))}</strong></div>
          <ol class="guide-steps">${REASONS[this.reason].tips.map((tip) => `<li>${esc(t(tip))}</li>`).join("")}</ol>`
          : `<div class="notice">${esc(this.error || "")}</div>`}</div>
        <button class="btn btn-primary btn-block" data-listen>${esc(t("다시 시도"))}</button>`;
    }
    // The worker reports several times a second; rebuilding unchanged markup would
    // swallow taps on the switch and buttons, so only replace it when it differs.
    if (html === this.lastCardHTML) return;
    this.lastCardHTML = html;
    card.innerHTML = html;
    this.bind(card);
  }

  finishedCard() {
    const r = this.result;
    const level = r.quality.level;
    const badge = level === 2 ? `<span class="badge good">${esc(t("신호 품질 좋음"))}</span>`
      : level === 1 ? `<span class="badge caution">${esc(t("신호 품질 보통"))}</span>`
      : `<span class="badge critical">${esc(t("신호 불안정"))}</span>`;
    const tape = `<canvas class="tape" data-tape aria-label="${esc(t("박동 기록"))}"></canvas>`;

    if (this.mode === "positions") {
      const done = this.positionResults.filter(Boolean);
      const isLast = this.positionIndex === POSITIONS.length - 1;
      const summary = positionSummary(done.filter((e) => e.result.quality.level > 0).map((e) => e.result.rate));
      return `
        <div class="stage-card-scroll">
          <div class="row between"><h2>${esc(positionLabel(this.position))}</h2>${badge}</div>
          ${this.metrics(r)}
          ${level === 0 ? `<div class="notice">${esc(t("신호가 고르지 않아 이 포지션은 저장하지 않습니다. 재측정을 권합니다."))}</div>` : ""}
          <div class="list">${done.map((e) => `<div class="list-row"><span class="grow">${esc(positionLabel(e.position))}</span><span class="rec-rate ${e.result.quality.level ? "" : "muted"}">${formatRate(e.result.rate)} s/d</span></div>`).join("")}</div>
          ${summary && done.length > 1 ? `<p class="caption" style="margin:0">${esc(t("평균 {mean} s/d · 포지션 편차 {dev} s/d", { mean: formatRate(summary.meanRate), dev: summary.maximumDeviation.toFixed(1) }))}</p>` : ""}
          ${isLast ? this.watchPicker() : ""}
        </div>
        <div class="stage-actions">
          <button class="btn btn-secondary" data-retake>${esc(t("재측정"))}</button>
          ${isLast ? `<button class="btn btn-primary" data-save-all>${esc(t("모두 저장"))}</button>` : `<button class="btn btn-primary" data-next>${esc(t("다음"))}</button>`}
        </div>`;
    }

    if (this.saved) {
      return `
        <div class="stage-card-scroll">
          <div class="row between"><h2>${esc(t("완료"))}</h2>${badge}</div>
          ${this.metrics(r)}
          ${this.reading(r)}
          <div class="status-pill">${icon("check", 'width="16" height="16"')}${esc(t("{no} 저장됨", { no: store.archiveNumber(this.saved.serial) }))}</div>
          <p class="caption" style="margin:0">${esc(t("같은 포지션끼리 비교해야 정확합니다. 기계식 시계는 자세에 따라 하루 수 초씩 달라집니다."))}</p>
        </div>
        <div class="stage-actions">
          <button class="btn btn-primary" data-card-open>${icon("share")}${esc(t("결과 카드"))}</button>
          <button class="btn btn-secondary" data-retake>${esc(t("재측정"))}</button>
        </div>`;
    }

    return `
      <div class="stage-card-scroll">
        <div class="row between"><h2>${esc(level ? t("완료") : t("다시 측정해 주세요"))}</h2>${badge}</div>
        ${this.metrics(r)}
        ${level === 0 ? `<div class="notice">${esc(t("신호가 고르지 않아 결과를 확정하지 않았습니다. 휴대폰을 시계 유리에 붙이고 움직이지 않게 다시 측정해 주세요."))}</div>` : this.reading(r)}
        ${tape}
        ${this.watchPicker()}
        ${this.positionPicker()}
        <p class="caption" style="margin:0">${esc(this.liftNote())}</p>
      </div>
      <div class="stage-actions">
        <button class="btn btn-secondary" data-retake>${esc(t("재측정"))}</button>
        <button class="btn btn-primary" data-save ${level ? "" : "disabled"}>${esc(t("측정 저장"))}</button>
      </div>`;
  }

  bind(card) {
    const on = (selector, handler) => card.querySelectorAll(selector).forEach((el) => { el.onclick = handler; });
    on("[data-listen]", () => this.startListening());
    on("[data-start]", () => this.beginMeasurement());
    on("[data-cancel]", () => this.worker && this.worker.postMessage({ type: "cancel" }));
    on("[data-retake]", () => this.retake());
    on("[data-save]", () => this.save());
    on("[data-save-all]", () => this.saveAllPositions());
    on("[data-next]", () => this.nextPosition());
    on("[data-new-watch]", () => this.ensureWatch());
    on("[data-card-open]", () => openResultCard(this.saved, this.watch));
    card.querySelectorAll("[data-watch]").forEach((chip) => {
      chip.onclick = () => { this.watchId = chip.dataset.watch; this.render(); };
    });
    // Keep the chosen watch in view in the sideways row (and keep the row where it was on re-render).
    const row = card.querySelector("[data-watch-chips]");
    if (row) {
      if (this.chipScroll != null) row.scrollLeft = this.chipScroll;
      const chosen = row.querySelector('[aria-pressed="true"]');
      if (chosen && (chosen.offsetLeft < row.scrollLeft || chosen.offsetLeft + chosen.offsetWidth > row.scrollLeft + row.clientWidth)) {
        row.scrollLeft = chosen.offsetLeft - 4;
      }
      row.onscroll = () => { this.chipScroll = row.scrollLeft; };
    }
    card.querySelectorAll("[data-position]").forEach((chip) => {
      chip.onclick = () => { this.position = this.position === chip.dataset.position ? null : chip.dataset.position; this.render(); };
    });
    const auto = card.querySelector("#auto-start");
    if (auto) auto.onchange = () => {
      store.setPrefs({ autoStart: auto.checked });
      this.autoStartArmed = auto.checked;
    };
    paintThumbs(card);
    const tapeCanvas = card.querySelector("[data-tape]");
    if (tapeCanvas && this.result && this.result.beats) {
      const points = tapePoints(this.result);
      const duration = points.length ? points[points.length - 1].elapsed : 1;
      requestAnimationFrame(() => paintTape(tapeCanvas, points, duration));
    }
  }
}
