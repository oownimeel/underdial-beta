// First run: what Underdial does, how to hold the phone, and how to keep it on the home screen.
import { t } from "../i18n.js";
import { esc, icon, sheet, isIOS, isStandalone } from "../ui.js";
import * as store from "../store.js";
import { paintDotDial } from "../dial.js";

export function showOnboarding() {
  const el = document.createElement("div");
  el.className = "onboard";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", t("시작하기"));
  el.innerHTML = `
    <div class="onboard-inner">
      <div class="art"><canvas aria-hidden="true"></canvas></div>
      <h1>${esc(t("다이얼 아래의 박동을 듣다"))}</h1>
      <p class="muted" style="margin:0;font-size:16px;line-height:1.6">${esc(t("휴대폰 마이크로 기계식 시계의 박동을 듣고 하루 오차(Rate), 비트 에러, 진폭을 계산합니다."))}</p>
      <div class="howto">
        <div><b>1.</b> ${esc(t("조용한 곳에서 시계를 손에 들거나 천 위에 놓습니다."))}</div>
        <div><b>2.</b> ${esc(t("휴대폰 아래쪽 끝(마이크)을 시계 유리에 가볍게 붙입니다."))}</div>
        <div><b>3.</b> ${esc(t("측정이 끝날 때까지 20초 동안 움직이지 마세요."))}</div>
      </div>
      ${isStandalone() ? "" : `<button class="link-btn" data-install style="justify-self:start;text-align:left">${icon("plus", 'width="16" height="16" style="vertical-align:-3px"')} ${esc(t("홈 화면에 추가하면 앱처럼 쓰고 기록도 안전하게 남습니다."))}</button>`}
      <div class="spacer"></div>
      <p class="caption" style="margin:0;text-align:center">${esc(t("소리는 이 기기 안에서만 처리됩니다."))}</p>
      <button class="btn btn-primary btn-block" data-go>${esc(t("시작하기"))}</button>
    </div>`;
  document.body.append(el);

  const canvas = el.querySelector("canvas");
  const started = performance.now();
  let frame = null;
  const animate = (now) => {
    const fill = Math.min(1, (now - started) / 2400);
    paintDotDial(canvas, { fill: fill * fill * (3 - 2 * fill) });
    if (fill < 1) frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);

  el.querySelector("[data-install]")?.addEventListener("click", installHelp);
  el.querySelector("[data-go]").onclick = () => {
    cancelAnimationFrame(frame);
    store.setPrefs({ onboarded: true });
    el.style.transition = "opacity 300ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  };
}

const SHARE_GLYPH = `<svg class="share-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/></svg>`;

export function installHelp() {
  const prompt = window.__installPrompt;
  if (prompt) {
    // Chrome on Android offers its own install dialog.
    prompt.prompt();
    prompt.userChoice.finally(() => { window.__installPrompt = null; });
    return;
  }
  sheet((body) => {
    body.innerHTML = isIOS() ? `
      <ol class="guide-steps">
        <li>${t("Safari 아래쪽(또는 위쪽)의 공유 버튼 {glyph}을 누릅니다.", { glyph: SHARE_GLYPH })}</li>
        <li>${esc(t("목록을 내려 '홈 화면에 추가'를 누릅니다."))}</li>
        <li>${esc(t("오른쪽 위 '추가'를 누르면 홈 화면에 Underdial 아이콘이 생깁니다."))}</li>
      </ol>
      <p class="caption" style="margin:0">${esc(t("이후에는 홈 화면 아이콘으로 여세요. Safari에서 연 페이지와 홈 화면 앱은 기록을 따로 보관합니다."))}</p>` : `
      <ol class="guide-steps">
        <li>${esc(t("Chrome 오른쪽 위의 ⋮ 메뉴를 누릅니다."))}</li>
        <li>${esc(t("'홈 화면에 추가' 또는 '앱 설치'를 누릅니다."))}</li>
        <li>${esc(t("'설치'를 누르면 앱 목록과 홈 화면에 Underdial이 생깁니다."))}</li>
      </ol>
      <p class="caption" style="margin:0">${esc(t("삼성 인터넷은 아래 메뉴 ≡ › '현재 페이지 추가' › '홈 화면'에서 추가할 수 있습니다."))}</p>`;
  }, { title: t("홈 화면에 추가") });
}
