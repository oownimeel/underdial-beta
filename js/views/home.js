// Home: one page per watch, swiped sideways. Photo, name, this week's measuring days,
// the recent average rate with a small bar history, and the latest figures.
import { t, locale } from "../i18n.js";
import { esc, icon, formatRate, formatRelative, blobURL, grade } from "../ui.js";
import * as store from "../store.js";
import { IS_BETA } from "../version.js";
import { paintDotDial } from "../dial.js";
import { amplitudeGrade, beatErrorGrade } from "../engine.js";
import { openWatchDetail, openWatchBox, openEditWatch } from "./watch.js";
import { openClockCard } from "./records.js";
import { startMeasure } from "../app.js";

const RECENT = 5;
const MAX_DOTS = 9;   // beyond this, a "3 / 30" counter replaces the dots

export function summarize(watch, measurements) {
  const own = measurements.filter((m) => m.watchId === watch.id);
  const reliable = own.filter((m) => m.qualityLevel > 0);
  const recent = reliable.slice(0, RECENT);
  const average = recent.length ? recent.reduce((s, m) => s + m.rate, 0) / recent.length : null;
  const latest = own[0] || null;
  return { own, reliable, recent, average, latest };
}

export function overallGrade(m) {
  const amp = store.measurementAmplitude(m);
  const grades = [beatErrorGrade(m.beatErrorMs)].concat(amp == null ? [] : [amplitudeGrade(amp)]);
  if (grades.includes("critical")) return "critical";
  return grades.includes("caution") ? "caution" : "good";
}

function weekStrip(own) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  const days = new Set(own.map((m) => new Date(m.date).toDateString()));
  const names = new Intl.DateTimeFormat(locale(), { weekday: "narrow" });
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const cls = d.toDateString() === today.toDateString() ? "today" : days.has(d.toDateString()) ? "has" : "";
    html += `<div class="d ${cls}">${esc(names.format(d))}<b>${d.getDate()}</b></div>`;
  }
  return `<div class="week" aria-label="${esc(t("이번 주 측정"))}">${html}</div>`;
}

function bars(recent) {
  const rates = recent.slice(0, 8).reverse().map((m) => m.rate);
  if (rates.length === 0) return "";
  const max = Math.max(4, ...rates.map(Math.abs));
  return `<div class="bars" aria-hidden="true">${rates.map((r, i) =>
    `<i class="${r < 0 ? "neg" : ""}" style="height:${Math.max(10, Math.abs(r) / max * 100)}%; animation-delay:${i * 50}ms"></i>`).join("")}</div>`;
}

function page(watch, measurements, index) {
  const { own, recent, average, latest } = summarize(watch, measurements);
  const photo = watch.photo ? `<img src="${blobURL(watch.photo)}" alt="">` : `<canvas data-dial aria-hidden="true"></canvas>`;
  const amp = latest ? store.measurementAmplitude(latest) : null;
  const gradeName = latest ? overallGrade(latest) : null;
  return `
    <section class="watch-page" data-index="${index}" aria-label="${esc(watch.name)}">
      <div class="hero rise">
        ${photo}
        <button class="hero-name glass" data-detail="${watch.id}">
          <strong>${esc(watch.name)} ›</strong>
          <span>${latest ? esc(t("마지막 측정 {when}", { when: formatRelative(latest.date) })) : esc(t("아직 측정 없음"))}</span>
        </button>
      </div>
      <div class="card rise" style="animation-delay:60ms">
        ${weekStrip(own)}
        <div class="rate-hero">
          <div class="stack" style="gap:2px">
            <div class="big">${average == null ? "–" : formatRate(average)}<small>s/d</small></div>
            <div class="caption">${average == null ? esc(t("측정하면 이곳에 오차가 쌓입니다. 오른쪽 아래 + 버튼을 눌러 시작하세요.")) : esc(t("최근 {count}회 평균 오차", { count: recent.length }))}</div>
          </div>
          ${bars(recent)}
        </div>
        <div class="metric-grid">
          <div class="metric"><span class="label">${esc(t("상태"))}</span><span class="value ${gradeName || ""}" style="font-family:var(--font);font-size:18px;font-weight:600">${gradeName ? esc(grade(gradeName)) : "–"}</span></div>
          <div class="metric"><span class="label">${esc(t("측정 횟수"))}</span><span class="value">${own.length}<small>${esc(t("회"))}</small></span></div>
          <div class="metric"><span class="label">Amplitude</span><span class="value">${amp == null ? "–" : Math.round(amp)}<small>${amp == null ? "" : "°"}</small></span></div>
          <div class="metric"><span class="label">Beat error</span><span class="value">${latest ? latest.beatErrorMs.toFixed(2) : "–"}<small>${latest ? "ms" : ""}</small></span></div>
        </div>
        <button class="btn btn-primary btn-block" data-measure="${watch.id}">${icon("wave")}${esc(t("이 시계 측정"))}</button>
      </div>
    </section>`;
}

export async function renderHome(root) {
  const [watches, measurements] = await Promise.all([store.watches(), store.measurements()]);
  const prefs = store.prefs();

  const header = `
    <header class="home-top">
      <button class="icon-btn glass" data-box aria-label="${esc(t("내 시계 보관함"))}">${icon("list")}</button>
      <div class="wordmark glass" aria-label="Underdial">Underdial${IS_BETA ? '<span class="beta-tag">BETA</span>' : ""}</div>
      <button class="icon-btn glass" data-clock aria-label="${esc(t("현재 시각"))}">${icon("clock")}</button>
    </header>`;

  if (watches.length === 0) {
    root.innerHTML = `${header}
      <div class="card empty rise">
        <canvas data-dial style="width:min(60vw,220px);aspect-ratio:1" aria-hidden="true"></canvas>
        <h2 style="margin:0;font-size:20px">${esc(t("첫 시계를 추가해 보세요."))}</h2>
        <p>${esc(t("시계를 등록하면 측정 기록이 시계별로 쌓입니다."))}</p>
        <button class="btn btn-primary" data-add>${icon("plus")}${esc(t("시계 추가"))}</button>
        <button class="link-btn" data-quick>${esc(t("시계 없이 바로 측정"))}</button>
      </div>`;
  } else {
    const start = Math.max(0, watches.findIndex((w) => w.id === prefs.lastWatchId));
    root.innerHTML = `${header}
      <div class="watch-pager" data-pager>${watches.map((w, i) => page(w, measurements, i)).join("")}</div>
      ${watches.length > MAX_DOTS ? `<div class="dots count num" data-count aria-live="polite">${start + 1} / ${watches.length}</div>`
        : watches.length > 1 ? `<div class="dots" data-dots>${watches.map((_, i) => `<i class="${i === start ? "on" : ""}"></i>`).join("")}</div>` : ""}`;
    const pager = root.querySelector("[data-pager]");
    requestAnimationFrame(() => { pager.scrollLeft = start * pager.clientWidth; });
    let settle = null;
    pager.addEventListener("scroll", () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const index = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
        root.querySelectorAll("[data-dots] i").forEach((dot, i) => dot.classList.toggle("on", i === index));
        const count = root.querySelector("[data-count]");
        if (count) count.textContent = `${index + 1} / ${watches.length}`;
        if (watches[index]) store.setPrefs({ lastWatchId: watches[index].id });
      }, 120);
    }, { passive: true });
  }

  root.querySelectorAll("canvas[data-dial]").forEach((canvas) => requestAnimationFrame(() => paintDotDial(canvas, { fill: 0.75 })));
  root.querySelector("[data-box]").onclick = () => openWatchBox();
  root.querySelector("[data-clock]").onclick = () => openClockCard();
  root.querySelector("[data-add]")?.addEventListener("click", () => openEditWatch(null));
  root.querySelector("[data-quick]")?.addEventListener("click", () => startMeasure("single"));
  root.querySelectorAll("[data-detail]").forEach((b) => { b.onclick = () => openWatchDetail(b.dataset.detail); });
  root.querySelectorAll("[data-measure]").forEach((b) => {
    b.onclick = () => { store.setPrefs({ lastWatchId: b.dataset.measure }); startMeasure("single", b.dataset.measure); };
  });
}
