// Settings: measuring options, recordings, backup, language, theme, install help, reference values.
import { t, setLanguage, getLanguage } from "../i18n.js";
import { esc, icon, sheet, confirmDelete, toast, formatDateTime, blobURL, shareOrDownload, isIOS, isStandalone } from "../ui.js";
import * as store from "../store.js";
import { showOnboarding, installHelp } from "./onboarding.js";
import { APP_VERSION, IS_BETA, CHANGELOG } from "../version.js";
import { feedbackReport, logEntries } from "../log.js";

const versionText = () => `${APP_VERSION}${IS_BETA ? ` ${t("베타")}` : ""}`;

function toggleRow(id, title, caption, checked) {
  return `<label class="list-row" for="${id}"><span class="grow"><span class="title" style="white-space:normal">${esc(title)}</span>${caption ? `<span class="caption">${esc(caption)}</span>` : ""}</span>
    <span class="switch"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span></span></span></label>`;
}

function linkRow(key, title, value = "") {
  return `<button class="list-row" data-row="${key}"><span class="grow"><span class="title">${esc(title)}</span></span>${value ? `<span class="caption">${esc(value)}</span>` : ""}${icon("chevron", 'class="chev"')}</button>`;
}

export async function renderSettings(root) {
  const prefs = store.prefs();
  const [persisted, estimate, recordings, watches, measurements] = await Promise.all([
    navigator.storage && navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : Promise.resolve(false),
    store.storageEstimate(),
    store.recordings(),
    store.watches(),
    store.measurements(),
  ]);
  // Built now, so the copy runs straight from the tap (Safari only allows that).
  const report = () => feedbackReport({ watches: watches.length, measurements: measurements.length,
    standalone: isStandalone(), language: getLanguage(), micLabel: store.prefs().lastMic });
  const standalone = isStandalone();
  const safe = persisted || standalone;
  const used = estimate && estimate.usage ? `${(estimate.usage / 1048576).toFixed(1)} MB` : "";

  root.innerHTML = `
    <h1 class="screen-title">${esc(t("설정"))}</h1>

    <section class="card rise" style="gap:10px">
      <div class="row" style="align-items:flex-start">
        <span style="color:${safe ? "var(--good)" : "var(--warn)"};flex:none;margin-top:2px">${icon(safe ? "check" : "warning", 'width="20" height="20"')}</span>
        <div class="stack" style="gap:4px">
          <strong>${esc(safe ? t("기록이 이 기기에 안전하게 저장됩니다") : t("홈 화면에 추가해 주세요"))}</strong>
          <span class="caption">${esc(safe
            ? t("시계, 측정 기록, 사진은 이 기기 안에만 있습니다. 기기를 바꾸기 전에 백업을 내보내 두세요.")
            : t("브라우저에서만 쓰면 오래 접속하지 않을 때 기록이 지워질 수 있습니다. 홈 화면에 추가하면 앱처럼 열리고 기록도 유지됩니다."))}</span>
          ${safe ? "" : `<button class="link-btn" data-install style="justify-self:start">${esc(t("홈 화면에 추가하는 방법"))}</button>`}
        </div>
      </div>
    </section>

    <section class="stack rise" style="animation-delay:40ms">
      <span class="eyebrow">${esc(t("측정"))}</span>
      <div class="list">
        ${toggleRow("pref-auto", t("자동 시작"), t("신호가 잡히면 바로 측정을 시작합니다."), prefs.autoStart)}
        ${toggleRow("pref-rec", t("녹음 파일 보관"), t("최근 30개의 측정 소리를 이 기기에 남깁니다."), prefs.keepRecordings)}
        ${linkRow("recordings", t("녹음 파일"), recordings.length ? t("{n}개", { n: recordings.length }) : "")}
        ${linkRow("howto", t("측정 방법 다시 보기"))}
      </div>
    </section>

    <section class="stack rise" style="animation-delay:80ms">
      <span class="eyebrow">${esc(t("데이터"))}</span>
      <div class="list">
        ${linkRow("export", t("백업 내보내기"), used)}
        <label class="list-row" for="import-file"><span class="grow"><span class="title">${esc(t("백업 불러오기"))}</span></span>${icon("chevron", 'class="chev"')}<input type="file" id="import-file" accept="application/json,.json" hidden></label>
      </div>
      <span class="caption">${esc(t("백업 파일에는 시계, 사진, 측정 기록이 들어 있습니다. 녹음 파일은 포함되지 않습니다."))}</span>
    </section>

    <section class="stack rise" style="animation-delay:120ms">
      <span class="eyebrow">${esc(t("앱"))}</span>
      <div class="card" style="gap:14px">
        <div class="field"><span class="label">${esc(t("언어"))}</span>
          <div class="chips"><button class="chip" data-lang="ko" aria-pressed="${getLanguage() === "ko"}">한국어</button><button class="chip" data-lang="en" aria-pressed="${getLanguage() === "en"}">English</button></div></div>
        <div class="field"><span class="label">${esc(t("화면"))}</span>
          <div class="chips">${[["system", t("시스템")], ["light", t("라이트")], ["dark", t("다크")]].map(([v, label]) =>
            `<button class="chip" data-theme-choice="${v}" aria-pressed="${prefs.theme === v}">${esc(label)}</button>`).join("")}</div></div>
      </div>
    </section>

    <section class="stack rise" style="animation-delay:140ms">
      <span class="eyebrow">${esc(t("도움"))}</span>
      <div class="list">
        ${linkRow("feedback", t("의견 보내기"), logEntries().length ? t("기록 {n}건", { n: logEntries().length }) : "")}
        ${linkRow("version", t("버전 정보"), versionText())}
      </div>
    </section>

    <section class="stack rise" style="animation-delay:160ms">
      <span class="eyebrow">${esc(t("참고 기준"))}</span>
      <div class="list">
        <div class="list-row"><span class="grow">Amplitude</span><span class="caption"><span class="good">270–310° ${esc(t("양호"))}</span> · <span class="critical">220° ${esc(t("미만 점검"))}</span></span></div>
        <div class="list-row"><span class="grow">Beat error</span><span class="caption"><span class="good">≤0.3 ms ${esc(t("양호"))}</span> · <span class="critical">≥0.6 ms ${esc(t("점검"))}</span></span></div>
      </div>
      <span class="caption">${esc(t("커뮤니티에서 통용되는 값이며 공식 규격이 아닙니다."))}</span>
    </section>

    <section class="card rise" style="animation-delay:200ms;gap:8px">
      <div class="row">${icon("info", 'width="18" height="18" style="color:var(--text-2);flex:none"')}<strong>${esc(t("개인정보"))}</strong></div>
      <span class="caption" style="font-size:13px">${esc(t("측정한 소리와 사진은 이 기기 안에서만 처리되며, 계정이나 서버를 사용하지 않습니다. 이 웹사이트는 파일만 내려받고, 어떤 데이터도 서버로 보내지 않습니다."))}</span>
      <span class="caption">Underdial ${esc(versionText())}</span>
    </section>`;

  root.querySelector("#pref-auto").onchange = (e) => store.setPrefs({ autoStart: e.target.checked });
  root.querySelector("#pref-rec").onchange = (e) => store.setPrefs({ keepRecordings: e.target.checked });
  root.querySelector('[data-row="recordings"]').onclick = openRecordings;
  root.querySelector('[data-row="howto"]').onclick = () => showOnboarding();
  root.querySelector('[data-row="feedback"]').onclick = () => openFeedback(report());
  root.querySelector('[data-row="version"]').onclick = openVersions;
  root.querySelector("[data-install]")?.addEventListener("click", installHelp);
  root.querySelector('[data-row="export"]').onclick = async () => {
    const blob = await store.exportBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    const outcome = await shareOrDownload(blob, `underdial-backup-${stamp}.json`, "Underdial backup");
    if (outcome !== "cancelled") toast(t("백업 파일을 만들었습니다."));
  };
  root.querySelector("#import-file").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const counts = await store.importBackup(file);
      toast(t("시계 {w}개, 기록 {m}개를 불러왔습니다.", { w: counts.watches, m: counts.measurements }));
    } catch {
      toast(t("Underdial 백업 파일이 아닙니다."));
    }
  };
  root.querySelectorAll("[data-lang]").forEach((chip) => {
    chip.onclick = () => { store.setPrefs({ language: chip.dataset.lang }); setLanguage(chip.dataset.lang); };
  });
  root.querySelectorAll("[data-theme-choice]").forEach((chip) => {
    chip.onclick = () => {
      const value = chip.dataset.themeChoice;
      store.setPrefs({ theme: value });
      if (value === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = value;
      root.querySelectorAll("[data-theme-choice]").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    };
  });
}

/** Puts text on the clipboard; falls back to a selected text area on older browsers. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

function openFeedback(text) {
  const copying = copyText(text);
  sheet(async (body) => {
    const copied = await copying;
    body.innerHTML = `
      <div class="${copied ? "status-pill" : "notice"}" style="justify-self:start">${copied ? icon("check", 'width="16" height="16"') : ""}${esc(copied ? t("오류 기록을 복사했어요") : t("자동 복사가 되지 않았어요. 아래 내용을 길게 눌러 복사해 주세요."))}</div>
      <ol class="guide-steps">
        <li>${esc(t("카페의 Underdial 게시글이나 댓글에 붙여넣어 주세요."))}</li>
        <li>${esc(t("맨 아래에 어떤 상황이었는지 한두 줄 적어 주시면 고치는 데 큰 도움이 됩니다."))}</li>
      </ol>
      <pre class="report" tabindex="0">${esc(text)}</pre>
      <span class="caption">${esc(t("기기 종류, 앱 버전, 최근 오류만 들어갑니다. 시계 이름, 사진, 녹음은 들어가지 않으며, 직접 붙여넣기 전에는 어디로도 전송되지 않습니다."))}</span>
      <button class="btn btn-primary btn-block" data-copy>${esc(t("다시 복사"))}</button>`;
    body.querySelector("[data-copy]").onclick = async () => {
      toast(await copyText(text) ? t("복사했습니다.") : t("복사하지 못했습니다."));
    };
  }, { title: t("의견 보내기") });
}

function openVersions() {
  sheet((body) => {
    const en = getLanguage() === "en";
    body.innerHTML = `
      <div class="card" style="gap:4px">
        <span class="eyebrow">${esc(t("현재 버전"))}</span>
        <strong class="num" style="font-size:22px">Underdial ${esc(versionText())}</strong>
        ${IS_BETA ? `<span class="caption">${esc(t("테스트용 베타입니다. 기록은 정식 버전과 따로 저장됩니다."))}</span>` : ""}
      </div>
      <div class="changelog">${CHANGELOG.map((entry) => `
        <section>
          <div class="row between"><strong class="num">${esc(entry.version)}${entry.version === APP_VERSION ? ` <span class="badge good">${esc(t("현재"))}</span>` : ""}</strong><span class="caption num">${esc(entry.date)}</span></div>
          <ul>${(en ? entry.en : entry.ko).map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
        </section>`).join("")}</div>`;
  }, { title: t("업데이트 내역") });
}

function openRecordings() {
  let audio = null;
  sheet(async (body) => {
    const draw = async () => {
      const list = await store.recordings();
      body.innerHTML = list.length ? `<div class="list">${list.map((r) => `
        <div class="list-row">
          <button class="icon-btn" style="background:var(--relief)" data-play="${r.id}" aria-label="${esc(t("재생"))}">${icon("play")}</button>
          <span class="grow"><span class="title">${esc(r.watchName || t("시계 미지정"))}</span><span class="caption">${esc(formatDateTime(r.date))} · ${Math.round(r.seconds)}${esc(t("초"))}</span></span>
          <button class="icon-btn" style="background:transparent" data-save="${r.id}" aria-label="${esc(t("내보내기"))}">${icon("download")}</button>
          <button class="icon-btn critical" style="background:transparent" data-del="${r.id}" aria-label="${esc(t("삭제"))}">${icon("trash")}</button>
        </div>`).join("")}</div><p class="caption" style="margin:0">${esc(t("측정 소리를 WAV 파일로 내보내 다른 기기나 앱과 비교할 수 있습니다."))}</p>`
        : `<div class="card empty"><p>${esc(t("저장된 녹음 파일이 없습니다."))}</p></div>`;
      const find = (id) => list.find((r) => r.id === id);
      body.querySelectorAll("[data-play]").forEach((b) => {
        b.onclick = () => {
          if (audio) { audio.pause(); }
          audio = new Audio(blobURL(find(b.dataset.play).blob));
          audio.play().catch(() => {});
        };
      });
      body.querySelectorAll("[data-save]").forEach((b) => {
        b.onclick = () => {
          const r = find(b.dataset.save);
          const stamp = new Date(r.date).toISOString().replace(/[:T]/g, "-").slice(0, 19);
          shareOrDownload(r.blob, `underdial-${stamp}.wav`, "Underdial recording");
        };
      });
      body.querySelectorAll("[data-del]").forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDelete({ title: t("녹음 파일을 삭제할까요?"), message: t("삭제하면 되돌릴 수 없습니다.") });
          if (!ok) return;
          await store.deleteRecording(b.dataset.del);
          draw();
        };
      });
    };
    draw();
  }, { title: t("녹음 파일"), onClose: () => audio && audio.pause() });
}

