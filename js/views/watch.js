// Watch box (list), watch detail, and the add/edit form.
import { t } from "../i18n.js";
import { esc, icon, sheet, confirmDelete, toast, formatRate, formatDateTime, blobURL, preparePhoto } from "../ui.js";
import * as store from "../store.js";
import { paintDotDial } from "../dial.js";
import { DEFAULT_LIFT_ANGLE } from "../engine.js";
import { summarize } from "./home.js";
import { openRecordDetail } from "./records.js";
import { startMeasure } from "../app.js";

export const CALIBER_PRESETS = [
  { name: "ETA 2824", liftAngle: 50 },
  { name: "Sellita SW200", liftAngle: 50 },
  { name: "ETA 2892 / 2893", liftAngle: 51 },
  { name: "Miyota 82", liftAngle: 49 },
  { name: "Seiko NH35 / NH36", liftAngle: 53 },
];

export function thumb(watch, size = 44) {
  if (watch && watch.photo) return `<span class="thumb" style="width:${size}px;height:${size}px"><img src="${blobURL(watch.photo)}" alt=""></span>`;
  return `<span class="thumb" style="width:${size}px;height:${size}px"><canvas data-dial aria-hidden="true"></canvas></span>`;
}

export function paintThumbs(root) {
  root.querySelectorAll("canvas[data-dial]").forEach((c) => requestAnimationFrame(() => paintDotDial(c, { fill: 0.75 })));
}

// MARK: Watch box

export function openWatchBox() {
  sheet(async (body, close) => {
    const [watches, measurements] = await Promise.all([store.watches(), store.measurements()]);
    body.innerHTML = `
      <div class="field"><input class="input" type="search" placeholder="${esc(t("시계 검색"))}" aria-label="${esc(t("시계 검색"))}" id="watch-search"></div>
      <div class="list" data-list></div>
      <button class="btn btn-primary btn-block" data-add>${icon("plus")}${esc(t("시계 추가"))}</button>`;
    const list = body.querySelector("[data-list]");
    const draw = (query) => {
      const q = query.trim().toLowerCase();
      const shown = watches.filter((w) => !q || w.name.toLowerCase().includes(q) || (w.caliber || "").toLowerCase().includes(q));
      list.innerHTML = shown.length ? shown.map((w) => {
        const s = summarize(w, measurements);
        return `<button class="list-row" data-id="${w.id}">
          ${thumb(w)}
          <span class="grow"><span class="title">${esc(w.name)}</span><span class="caption">${s.own.length ? esc(t("{count}회 측정", { count: s.own.length })) : esc(t("아직 측정 없음"))}</span></span>
          <span class="rec-rate">${s.average == null ? "" : formatRate(s.average) + " s/d"}</span>
          ${icon("chevron", 'class="chev"')}
        </button>`;
      }).join("") : `<div class="empty"><p>${esc(watches.length ? t("검색 결과가 없습니다.") : t("첫 시계를 추가해 보세요."))}</p></div>`;
      list.querySelectorAll("[data-id]").forEach((row) => { row.onclick = () => { close(); openWatchDetail(row.dataset.id); }; });
      paintThumbs(list);
    };
    draw("");
    body.querySelector("#watch-search").oninput = (e) => draw(e.target.value);
    body.querySelector("[data-add]").onclick = () => { close(); openEditWatch(null); };
  }, { title: t("내 시계 보관함") });
}

// MARK: Detail

function trendChart(reliable) {
  const points = reliable.slice(0, 20).reverse();
  if (points.length < 2) return `<p class="caption">${esc(t("측정이 두 번 이상 쌓이면 추이가 보입니다."))}</p>`;
  const w = 320, h = 120, pad = 14;
  const rates = points.map((m) => m.rate);
  const max = Math.max(5, ...rates.map(Math.abs)) * 1.15;
  const x = (i) => pad + (w - 2 * pad) * (i / (points.length - 1));
  const y = (r) => h / 2 - (r / max) * (h / 2 - pad);
  const path = points.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(m.rate).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(t("Rate 추이"))}" style="display:block">
    <line x1="${pad}" x2="${w - pad}" y1="${h / 2}" y2="${h / 2}" stroke="var(--relief)" stroke-width="1"/>
    <text x="${pad}" y="${h / 2 - 4}" font-size="10" fill="var(--text-2)" font-family="var(--num)">0</text>
    <path d="${path}" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((m, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(m.rate).toFixed(1)}" r="2.4" fill="var(--ink)"/>`).join("")}
    <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.rate).toFixed(1)}" r="4.5" fill="var(--accent)"/>
    <text x="${w - pad}" y="${Math.max(12, y(last.rate) - 9).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--text)" font-family="var(--num)">${formatRate(last.rate)}</text>
  </svg>`;
}

export function openWatchDetail(id) {
  sheet(async (body, close) => {
    const [watch, measurements] = await Promise.all([store.watch(id), store.measurements()]);
    if (!watch) { close(); return; }
    const s = summarize(watch, measurements);
    const lift = watch.liftAngle
      ? t("리프트 앵글 {angle}°", { angle: watch.liftAngle })
      : t("리프트 앵글 {angle}° (기본값)", { angle: DEFAULT_LIFT_ANGLE });
    body.innerHTML = `
      <div class="hero" style="aspect-ratio:4/3">
        ${watch.photo ? `<img src="${blobURL(watch.photo)}" alt="">` : `<canvas data-dial aria-hidden="true"></canvas>`}
      </div>
      <div class="stack">
        <h2 style="margin:0;font-family:var(--display);font-weight:400;font-size:26px">${esc(watch.name)}</h2>
        <div class="caption">${esc([watch.caliber, lift].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="row" style="gap:10px">
        <button class="btn btn-primary" style="flex:1" data-measure>${icon("wave")}${esc(t("측정"))}</button>
        <button class="btn btn-secondary" style="flex:1" data-edit>${icon("edit")}${esc(t("편집"))}</button>
      </div>
      <div class="card"><span class="eyebrow">${esc(t("Rate 추이"))}</span>${trendChart(s.reliable)}</div>
      <div class="stack">
        <span class="eyebrow">${esc(t("측정 기록"))}</span>
        ${s.own.length ? `<div class="list">${s.own.map((m) => `
          <button class="list-row" data-record="${m.id}">
            <span class="grow"><span class="title">${esc(store.archiveNumber(m.serial))}</span><span class="caption">${esc(formatDateTime(m.date))}</span></span>
            <span class="rec-rate ${m.qualityLevel > 0 ? "" : "muted"}">${formatRate(m.rate)} s/d</span>
            ${icon("chevron", 'class="chev"')}
          </button>`).join("")}</div>` : `<div class="card empty"><p>${esc(t("아직 측정 없음"))}</p></div>`}
      </div>
      <button class="btn btn-ghost btn-block critical" data-delete>${icon("trash")}${esc(t("시계 삭제"))}</button>`;
    body.querySelectorAll("canvas[data-dial]").forEach((c) => requestAnimationFrame(() => paintDotDial(c, { fill: 0.75 })));
    body.querySelector("[data-measure]").onclick = () => { store.setPrefs({ lastWatchId: id }); close(); startMeasure("single", id); };
    body.querySelector("[data-edit]").onclick = () => { close(); openEditWatch(watch); };
    body.querySelectorAll("[data-record]").forEach((row) => { row.onclick = () => openRecordDetail(row.dataset.record); });
    body.querySelector("[data-delete]").onclick = async () => {
      const ok = await confirmDelete({
        title: t("{name}을(를) 삭제할까요?", { name: watch.name }),
        message: t("측정 기록도 함께 삭제되며 되돌릴 수 없습니다."),
      });
      if (!ok) return;
      await store.deleteWatch(id);
      close();
      toast(t("삭제했습니다."));
    };
  }, { title: t("시계 상세") });
}

// MARK: Add / edit

/** `onSaved(watch)` runs after saving, e.g. to return to a measurement waiting for a watch. */
export function openEditWatch(existing, { onSaved } = {}) {
  let photo = existing ? existing.photo : null;
  sheet((body, close) => {
    body.innerHTML = `
      <div class="field">
        <span class="label">${esc(t("시계 사진 (필수)"))}</span>
        <div class="photo-pick ${photo ? "has" : ""}" data-pick>
          ${photo ? `<img src="${blobURL(photo)}" alt="">` : ""}
          <div class="pick-actions">
            <label class="btn ${photo ? "btn-light" : "btn-primary"}">${icon("camera")}${esc(t("촬영"))}<input type="file" accept="image/*" capture="environment" hidden data-camera></label>
            <label class="btn btn-light">${icon("image")}${esc(t("앨범에서 선택"))}<input type="file" accept="image/*" hidden data-album></label>
          </div>
        </div>
        <span class="caption">${esc(t("시계를 평평한 곳에 놓고 위에서 찍어 주세요. 사진은 이 기기에만 저장됩니다."))}</span>
      </div>
      <div class="field"><label for="w-name">${esc(t("이름"))}</label><input class="input" id="w-name" maxlength="60" placeholder="${esc(t("예: 까레라 크로노그래프"))}" value="${esc(existing ? existing.name : "")}"></div>
      <div class="field">
        <span class="label">${esc(t("칼리버"))}</span>
        <div class="chips" data-presets>${CALIBER_PRESETS.map((p) => `<button class="chip" type="button" data-preset="${esc(p.name)}" aria-pressed="${existing && existing.caliber === p.name}">${esc(p.name)} · ${p.liftAngle}°</button>`).join("")}</div>
        <input class="input" id="w-caliber" maxlength="60" placeholder="${esc(t("직접 입력 (선택)"))}" value="${esc(existing ? existing.caliber || "" : "")}">
      </div>
      <div class="field"><label for="w-lift">${esc(t("리프트 앵글 (°)"))}</label><input class="input num" id="w-lift" inputmode="decimal" placeholder="${DEFAULT_LIFT_ANGLE}" value="${existing && existing.liftAngle ? existing.liftAngle : ""}">
        <span class="caption">${esc(t("리프트 앵글을 모르면 비워 두세요. 기본값 52°로 계산하고 결과에 표시합니다."))}</span></div>
      <p class="caption" data-error style="color:var(--critical)" hidden></p>
      <div class="row"><button class="btn btn-secondary" style="flex:1" data-cancel>${esc(t("취소"))}</button><button class="btn btn-primary" style="flex:1" data-save>${esc(t("저장"))}</button></div>`;

    const pick = body.querySelector("[data-pick]");
    const onFile = async (input) => {
      const file = input.files && input.files[0];
      if (!file) return;
      photo = await preparePhoto(file);
      pick.classList.add("has");
      pick.querySelector("img")?.remove();
      const img = document.createElement("img");
      img.src = blobURL(photo);
      img.alt = "";
      pick.prepend(img);
      pick.querySelectorAll(".pick-actions .btn").forEach((b) => { b.classList.remove("btn-primary"); b.classList.add("btn-light"); });
    };
    body.querySelector("[data-camera]").onchange = (e) => onFile(e.target);
    body.querySelector("[data-album]").onchange = (e) => onFile(e.target);

    body.querySelectorAll("[data-preset]").forEach((chip) => {
      chip.onclick = () => {
        const preset = CALIBER_PRESETS.find((p) => p.name === chip.dataset.preset);
        body.querySelectorAll("[data-preset]").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
        body.querySelector("#w-caliber").value = preset.name;
        body.querySelector("#w-lift").value = preset.liftAngle;
      };
    });
    body.querySelector("[data-cancel]").onclick = close;
    let saving = false;   // a quick double tap must not add the watch twice
    body.querySelector("[data-save]").onclick = async () => {
      if (saving) return;
      const name = body.querySelector("#w-name").value.trim();
      const liftText = body.querySelector("#w-lift").value.trim().replace(",", ".");
      const lift = liftText ? Number(liftText) : null;
      const error = body.querySelector("[data-error]");
      const problem = !photo ? t("시계 사진을 촬영하거나 앨범에서 골라 주세요.")
        : !name ? t("시계 이름을 입력해 주세요.")
        : lift != null && !(lift >= 30 && lift <= 70) ? t("리프트 앵글은 30°에서 70° 사이로 입력해 주세요.")
        : null;
      if (problem) { error.textContent = problem; error.hidden = false; return; }
      saving = true;
      const saved = await store.saveWatch({
        ...(existing || {}),
        name,
        caliber: body.querySelector("#w-caliber").value.trim(),
        liftAngle: lift,
        photo,
      });
      store.setPrefs({ lastWatchId: saved.id });
      close();
      toast(existing ? t("저장했습니다.") : t("{name}을(를) 추가했습니다.", { name }));
      onSaved && onSaved(saved);
    };
  }, { title: existing ? t("시계 편집") : t("시계 추가") });
}
