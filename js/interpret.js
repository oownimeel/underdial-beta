// Plain-language reading of a result: one sentence, where each figure sits
// against common ranges, and whether the watch may need a service.
// The ranges are community rules of thumb (and COSC for rate), not a standard.
import { t } from "./i18n.js";
import { esc } from "./ui.js";
import { amplitudeGrade, beatErrorGrade } from "./engine.js";

const one = (v) => Math.abs(v).toFixed(1).replace(/\.0$/, "");

/** "About 4.2 seconds fast a day", plus how that compares. */
export function headline(rate) {
  const tone = rateTone(rate);
  const sentence = Math.abs(rate) < 1 ? t("하루 1초 이내로 거의 정확해요")
    : rate > 0 ? t("하루에 약 {n}초 빨라요", { n: one(rate) })
    : t("하루에 약 {n}초 느려요", { n: one(rate) });
  const verdict = rate >= -4 && rate <= 6 ? t("크로노미터 기준(−4~+6초) 안에 드는 좋은 결과예요.")
    : Math.abs(rate) <= 10 ? t("기계식 시계로는 양호한 편이에요.")
    : Math.abs(rate) <= 20 ? t("보통이에요. 조정을 받으면 더 정확해질 수 있어요.")
    : t("오차가 큰 편이에요.");
  return { sentence, verdict, tone };
}

function rateTone(rate) {
  if (rate >= -4 && rate <= 6) return "good";
  if (Math.abs(rate) <= 10) return "good";
  if (Math.abs(rate) <= 20) return "caution";
  return "critical";
}

/** Reasons the watch may want a watchmaker, or [] when nothing stands out. */
export function serviceReasons({ rate, amplitude, beatErrorMs, liftAngleIsDefault }) {
  const reasons = [];
  if (amplitude != null && amplitudeGrade(amplitude) === "critical") {
    reasons.push(t("진폭이 낮아요({n}°). 태엽을 충분히 감은 뒤 다이얼 위에서 다시 재 보세요. 그래도 낮으면 오버홀(분해 청소·주유)이 필요할 수 있어요.", { n: Math.round(amplitude) })
      + (liftAngleIsDefault ? " " + t("리프트 앵글이 실제와 다르면 진폭 값도 달라지니, 시계 정보에서 칼리버의 리프트 앵글을 확인해 주세요.") : ""));
  }
  if (beatErrorMs != null && beatErrorGrade(beatErrorMs) === "critical") {
    reasons.push(t("비트 에러가 커요({n}ms). 시계 수리점에서 비트 조정을 받으면 좋아집니다.", { n: beatErrorMs.toFixed(1) }));
  }
  if (rate > 30) reasons.push(t("많이 빨라요. 시계가 자성을 띠었을 수 있으니 탈자(자기 제거)를 먼저 해 보세요."));
  else if (rate < -30) reasons.push(t("많이 느려요. 태엽이 부족하지 않은지 확인하고, 계속 느리면 점검을 받아 보세요."));
  return reasons;
}

// Scales: [min, max], coloured zones and the marks under the bar.
const SCALES = {
  rate: { min: -30, max: 30, unit: "s/d",
    zones: [[-30, -20, "critical"], [-20, -10, "caution"], [-10, -4, "fair"], [-4, 6, "good"], [6, 10, "fair"], [10, 20, "caution"], [20, 30, "critical"]],
    marks: [-30, -4, 6, 30] },
  amplitude: { min: 150, max: 340, unit: "°",
    zones: [[150, 220, "critical"], [220, 270, "caution"], [270, 310, "good"], [310, 340, "caution"]],
    marks: [150, 220, 270, 310, 340] },
  beatError: { min: 0, max: 1.2, unit: "ms",
    zones: [[0, 0.3, "good"], [0.3, 0.6, "caution"], [0.6, 1.2, "critical"]],
    marks: [0, 0.3, 0.6, 1.2] },
};

function bar(label, key, value, text) {
  const s = SCALES[key];
  const pct = (v) => ((Math.min(s.max, Math.max(s.min, v)) - s.min) / (s.max - s.min)) * 100;
  const outside = value < s.min ? "low" : value > s.max ? "high" : "";
  const zones = s.zones.map(([a, b, tone]) => `<i class="zone ${tone}" style="left:${pct(a)}%;width:${pct(b) - pct(a)}%"></i>`).join("");
  const marks = s.marks.map((m) => `<span style="left:${pct(m)}%">${m > 0 && key === "rate" ? "+" : ""}${m}</span>`).join("");
  return `<div class="scale" role="img" aria-label="${esc(`${label} ${text}`)}">
      <div class="scale-head"><span>${esc(label)}</span><span class="num">${esc(text)}</span></div>
      <div class="scale-bar">${zones}<b class="${outside}" style="left:${pct(value)}%"></b></div>
      <div class="scale-marks num">${marks}</div>
    </div>`;
}

/**
 * The block under a result: the sentence, the three bars and any service note.
 * Pass null for amplitude when it can't be worked out.
 */
export function interpretationHTML({ rate, amplitude, beatErrorMs, liftAngleIsDefault }) {
  const h = headline(rate);
  const reasons = serviceReasons({ rate, amplitude, beatErrorMs, liftAngleIsDefault });
  const signed = `${rate > 0 ? "+" : rate < 0 ? "−" : ""}${Math.abs(rate).toFixed(1)} s/d`;
  return `
    <div class="reading">
      <p class="reading-line ${h.tone}">${esc(h.sentence)}</p>
      <p class="caption" style="margin:0;font-size:13px">${esc(h.verdict)}</p>
    </div>
    <div class="scales">
      ${bar(t("하루 오차"), "rate", rate, signed)}
      ${amplitude != null ? bar("Amplitude", "amplitude", amplitude, `${Math.round(amplitude)}°`) : ""}
      ${beatErrorMs != null ? bar("Beat error", "beatError", beatErrorMs, `${beatErrorMs.toFixed(2)} ms`) : ""}
      <p class="caption" style="margin:0">${esc(t("초록은 양호, 노랑은 주의, 빨강은 점검 권장 구간입니다. 오차의 초록 구간은 크로노미터 기준이며, 나머지는 커뮤니티 참고값입니다."))}</p>
    </div>
    ${reasons.length ? `<div class="service-note">
      <strong>${esc(t("점검이 필요할 수 있어요"))}</strong>
      <ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <span class="caption">${esc(t("한 번의 측정으로 판단하지 말고, 태엽을 감은 직후 같은 포지션에서 2~3번 측정해 확인해 주세요."))}</span>
    </div>` : ""}`;
}
