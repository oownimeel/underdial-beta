// Records: a month log book (each measured day shows the watch's photo), every
// record in order, the record detail, and the clock card with the phone's time.
import { t, locale } from "../i18n.js";
import { esc, icon, sheet, confirmDelete, toast, formatRate, formatDateTime, formatNumber, blobURL, grade } from "../ui.js";
import * as store from "../store.js";
import { paintClock } from "../dial.js";
import { amplitudeGrade, beatErrorGrade } from "../engine.js";
import { thumb, paintThumbs } from "./watch.js";
import { positionLabel } from "./measure.js";
import { openResultCard } from "../card.js";
import { interpretationHTML } from "../interpret.js";
import { overallGrade } from "./home.js";

let shownMonth = null;
const PAGE = 50;          // records listed at first; "show more" adds another page
let listLimit = PAGE;

function calendar(month, measurements, watchesById) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date().toDateString();
  const byDay = new Map();   // day → that day's measurements, newest first
  for (const m of measurements) {
    const d = new Date(m.date);
    if (d.getFullYear() !== month.getFullYear() || d.getMonth() !== month.getMonth()) continue;
    if (!byDay.has(d.getDate())) byDay.set(d.getDate(), []);
    byDay.get(d.getDate()).push(m);
  }
  const dow = new Intl.DateTimeFormat(locale(), { weekday: "narrow" });
  let html = "";
  for (let i = 0; i < 7; i++) html += `<span class="dow">${esc(dow.format(new Date(2026, 1, 1 + i)))}</span>`;
  for (let i = 0; i < first.getDay(); i++) html += `<span class="day other"></span>`;
  for (let day = 1; day <= days; day++) {
    const list = byDay.get(day);
    const m = list && list[0];
    const w = m && watchesById.get(m.watchId);
    const watchCount = list ? new Set(list.map((x) => x.watchId)).size : 0;
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const cls = ["day", date.toDateString() === today ? "today" : "", m ? "has" : "", w && w.photo ? "photo" : ""].join(" ");
    html += m
      ? `<button class="${cls}" data-day="${date.getTime()}" aria-label="${esc(t("{date} · 시계 {n}개 · 측정 {count}회", { date: dayTitle(date), n: watchCount, count: list.length }))}">${w && w.photo ? `<img class="ph" src="${blobURL(w.photo)}" alt="">` : ""}<span class="n">${day}</span>${watchCount > 1 ? `<span class="count num">${watchCount}</span>` : ""}</button>`
      : `<span class="${cls}"><span class="n">${day}</span></span>`;
  }
  return html;
}

export async function renderRecords(root) {
  const [measurements, watches] = await Promise.all([store.measurements(), store.watches()]);
  const watchesById = new Map(watches.map((w) => [w.id, w]));
  if (!shownMonth) { const now = new Date(); shownMonth = new Date(now.getFullYear(), now.getMonth(), 1); }
  const monthName = new Intl.DateTimeFormat(locale(), { year: "numeric", month: "long" }).format(shownMonth);

  root.innerHTML = `
    <h1 class="screen-title">${esc(t("기록"))}</h1>
    <section class="card rise">
      <span class="eyebrow">${esc(t("로그북"))}</span>
      <div class="month-head">
        <button class="icon-btn" data-prev aria-label="${esc(t("이전 달"))}" style="background:var(--bg)">${icon("back")}</button>
        <h2>${esc(monthName)}</h2>
        <button class="icon-btn" data-next aria-label="${esc(t("다음 달"))}" style="background:var(--bg)">${icon("chevron")}</button>
      </div>
      <div class="calendar">${calendar(shownMonth, measurements, watchesById)}</div>
    </section>
    <section class="stack rise" style="animation-delay:60ms">
      <span class="eyebrow">${esc(t("전체 기록"))}</span>
      ${measurements.length ? `<div class="list">${measurements.slice(0, listLimit).map((m) => {
        const w = watchesById.get(m.watchId);
        return `<button class="list-row" data-record="${m.id}">
          ${thumb(w)}
          <span class="grow"><span class="title">${esc(store.archiveNumber(m.serial))} · ${esc(w ? w.name : t("삭제된 시계"))}</span><span class="caption">${esc(formatDateTime(m.date))}${m.position ? " · " + esc(positionLabel(m.position)) : ""}</span></span>
          <span class="rec-rate ${m.qualityLevel > 0 ? "" : "muted"}">${formatRate(m.rate)} s/d</span>
          ${icon("chevron", 'class="chev"')}
        </button>`;
      }).join("")}</div>
      ${measurements.length > listLimit ? `<button class="btn btn-secondary btn-block" data-more>${esc(t("더 보기 ({n}개 남음)", { n: measurements.length - listLimit }))}</button>` : ""}`
      : `<div class="card empty"><p>${esc(t("아직 저장된 측정이 없습니다."))}</p></div>`}
    </section>`;

  paintThumbs(root);
  root.querySelector("[data-prev]").onclick = () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1); renderRecords(root); };
  root.querySelector("[data-next]").onclick = () => { shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1); renderRecords(root); };
  root.querySelectorAll("[data-record]").forEach((el) => { el.onclick = () => openRecordDetail(el.dataset.record); });
  root.querySelectorAll("[data-day]").forEach((el) => { el.onclick = () => openDay(new Date(Number(el.dataset.day))); });
  const more = root.querySelector("[data-more]");
  if (more) more.onclick = () => {
    const scroller = root.closest(".screen"), top = scroller ? scroller.scrollTop : 0;
    listLimit += PAGE * 2;
    renderRecords(root).then(() => { if (scroller) scroller.scrollTop = top; });
  };
}

const dayTitle = (date) => new Intl.DateTimeFormat(locale(), { month: "long", day: "numeric", weekday: "short" }).format(date);
const sameDay = (ms, date) => new Date(ms).toDateString() === date.toDateString();
const timeOf = (ms) => new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" }).format(new Date(ms));
const qualityText = (level) => [t("신호 불안정"), t("신호 보통"), t("신호 좋음")][level] || "";

/**
 * A logbook day: the watches measured that day, then one watch's measurements, then the record.
 * Steps with a single choice are skipped, so a day with one measurement opens it straight away.
 */
export async function openDay(date) {
  const [all, watches] = await Promise.all([store.measurements(), store.watches()]);
  const dayList = all.filter((m) => sameDay(m.date, date));
  if (!dayList.length) return;
  if (dayList.length === 1) { openRecordDetail(dayList[0].id); return; }
  const watchesById = new Map(watches.map((w) => [w.id, w]));

  sheet((body, close) => {
    let current = null;   // watchId shown, or null for the watch list
    const groups = () => {
      const map = new Map();
      for (const m of dayList) {
        if (!map.has(m.watchId)) map.set(m.watchId, []);
        map.get(m.watchId).push(m);
      }
      return [...map.entries()];
    };

    const watchList = () => {
      const rows = groups().map(([watchId, list]) => {
        const w = watchesById.get(watchId);
        const good = list.filter((m) => m.qualityLevel > 0);
        const use = good.length ? good : list;
        const avg = use.reduce((s, m) => s + m.rate, 0) / use.length;
        const g = overallGrade({ ...use[0], rate: avg });
        return `<button class="list-row" data-watch="${esc(watchId)}">
            ${thumb(w)}
            <span class="grow"><span class="title">${esc(w ? w.name : t("삭제된 시계"))}</span>
              <span class="caption">${esc(t("측정 {n}회", { n: list.length }))} · <span class="${g}">${esc(grade(g))}</span></span></span>
            <span class="rec-rate">${formatRate(avg)} s/d</span>
            ${icon("chevron", 'class="chev"')}
          </button>`;
      }).join("");
      body.innerHTML = `<p class="caption" style="margin:0">${esc(t("이 날 측정한 시계 {n}개 · 오차는 그날 평균입니다.", { n: groups().length }))}</p>
        <div class="list">${rows}</div>`;
      paintThumbs(body);
      body.querySelectorAll("[data-watch]").forEach((el) => { el.onclick = () => { current = el.dataset.watch; draw(); }; });
    };

    const measurementList = (watchId, canGoBack) => {
      const w = watchesById.get(watchId);
      const list = dayList.filter((m) => m.watchId === watchId);
      body.innerHTML = `
        ${canGoBack ? `<button class="btn btn-ghost day-back" data-back>${icon("back")}${esc(t("시계 목록"))}</button>` : ""}
        <div class="day-watch">${thumb(w, 52)}<span class="grow"><span class="title">${esc(w ? w.name : t("삭제된 시계"))}</span>
          <span class="caption">${esc(t("측정 {n}회", { n: list.length }))}</span></span></div>
        <div class="list">${list.map((m) => `
          <button class="list-row" data-record="${m.id}">
            <span class="grow"><span class="title num">${esc(timeOf(m.date))}</span>
              <span class="caption">${esc(store.archiveNumber(m.serial))}${m.position ? " · " + esc(positionLabel(m.position)) : ""} · ${esc(qualityText(m.qualityLevel))}</span></span>
            <span class="rec-rate ${m.qualityLevel > 0 ? "" : "muted"}">${formatRate(m.rate)} s/d</span>
            ${icon("chevron", 'class="chev"')}
          </button>`).join("")}</div>`;
      paintThumbs(body);
      const back = body.querySelector("[data-back]");
      if (back) back.onclick = () => { current = null; draw(); };
      body.querySelectorAll("[data-record]").forEach((el) => { el.onclick = () => openRecordDetail(el.dataset.record); });
    };

    const draw = () => {
      const g = groups();
      if (!g.length) { close(); return; }
      if (g.length === 1) measurementList(g[0][0], false);
      else if (current && g.some(([id]) => id === current)) measurementList(current, true);
      else watchList();
    };

    // A record deleted from the detail sheet disappears from this day too.
    const stop = store.onChange(async () => {
      const fresh = await store.measurements();
      dayList.splice(0, dayList.length, ...fresh.filter((m) => sameDay(m.date, date)));
      if (body.isConnected) draw(); else stop();
    });
    draw();
  }, { title: dayTitle(date) });
}

export function openRecordDetail(id) {
  sheet(async (body, close) => {
    const m = await store.measurement(id);
    if (!m) { close(); return; }
    const w = await store.watch(m.watchId);
    const amp = store.measurementAmplitude(m);
    const quality = [t("나쁨"), t("보통"), t("좋음")][m.qualityLevel] || "–";
    body.innerHTML = `
      <div class="card" style="text-align:center;justify-items:center">
        <span class="eyebrow">${esc(formatDateTime(m.date))}</span>
        <div class="num" style="font-weight:300;font-size:56px;line-height:1;letter-spacing:-0.03em">${formatRate(m.rate)}<small style="font-size:16px;color:var(--text-2);margin-left:4px">s/d</small></div>
        <span class="caption">${m.rateUncertainty != null ? `±${m.rateUncertainty.toFixed(1)} s/d · ` : ""}${esc(t("신호 품질"))} ${esc(quality)}</span>
      </div>
      <div class="metric-grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="metric"><span class="label">Beat error</span><span class="value ${beatErrorGrade(m.beatErrorMs)}">${m.beatErrorMs.toFixed(2)}<small>ms</small></span></div>
        <div class="metric"><span class="label">Amplitude</span><span class="value ${amp == null ? "" : amplitudeGrade(amp)}">${amp == null ? "–" : Math.round(amp)}<small>${amp == null ? "" : "°"}</small></span></div>
        <div class="metric"><span class="label">BPH</span><span class="value">${formatNumber(m.bph)}</span></div>
      </div>
      ${m.qualityLevel > 0 ? interpretationHTML({
        rate: m.rate,
        amplitude: amp != null && isFinite(amp) ? amp : null,
        beatErrorMs: m.beatErrorMs,
        liftAngleIsDefault: !(w && w.liftAngle),
      }) : ""}
      <div class="stack">
        <span class="eyebrow">${esc(t("측정 조건"))}</span>
        <div class="list">
          <div class="list-row"><span class="grow muted">${esc(t("시계"))}</span><span>${esc(w ? w.name : t("삭제된 시계"))}</span></div>
          <div class="list-row"><span class="grow muted">${esc(t("포지션"))}</span><span>${esc(m.position ? positionLabel(m.position) : t("모름"))}</span></div>
          <div class="list-row"><span class="grow muted">${esc(t("리프트 앵글"))}</span><span class="num">${m.liftAngle}°</span></div>
          <div class="list-row"><span class="grow muted">${esc(t("마이크"))}</span><span style="text-align:right;overflow-wrap:anywhere">${esc(m.device || "–")}</span></div>
        </div>
      </div>
      <p class="caption" style="margin:0">${esc(t("Amplitude와 Beat error의 색은 커뮤니티에서 통용되는 참고 기준이며 공식 규격이 아닙니다."))}</p>
      <div class="row"><button class="btn btn-primary" style="flex:1" data-card>${icon("share")}${esc(t("결과 카드"))}</button></div>
      <button class="btn btn-ghost btn-block critical" data-delete>${icon("trash")}${esc(t("기록 삭제"))}</button>`;
    body.querySelector("[data-card]").onclick = () => openResultCard(m, w);
    body.querySelector("[data-delete]").onclick = async () => {
      const ok = await confirmDelete({
        title: t("{no} 기록을 삭제할까요?", { no: store.archiveNumber(m.serial) }),
        message: t("삭제하면 되돌릴 수 없습니다."),
      });
      if (!ok) return;
      await store.deleteMeasurement(id);
      close();
      toast(t("삭제했습니다."));
    };
  }, { title: t("기록") });
}

/** The phone's own time, for setting a watch by. */
export function openClockCard() {
  let frame = null;
  sheet((body) => {
    body.innerHTML = `
      <div class="card clock-card">
        <canvas aria-hidden="true"></canvas>
        <div class="time" data-time></div>
        <div class="caption" data-date></div>
      </div>
      <p class="caption" style="margin:0;text-align:center">${esc(t("휴대폰 시간 기준입니다. 휴대폰 시간은 네트워크로 자동 맞춰집니다."))}</p>`;
    const canvas = body.querySelector("canvas"), time = body.querySelector("[data-time]"), date = body.querySelector("[data-date]");
    const timeFormat = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    const dateFormat = new Intl.DateTimeFormat(locale(), { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    const tick = () => {
      const now = new Date();
      paintClock(canvas, now);
      time.textContent = timeFormat.format(now);
      date.textContent = dateFormat.format(now);
      frame = requestAnimationFrame(tick);
    };
    tick();
  }, { title: t("현재 시각"), onClose: () => cancelAnimationFrame(frame) });
}
