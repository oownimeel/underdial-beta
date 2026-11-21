// The shareable 1080×1350 result card, drawn on a canvas (same layout as the iOS ResultCardView).
import { t, locale } from "./i18n.js";
import { esc, icon, sheet, toast, formatRate, shareOrDownload } from "./ui.js";
import * as store from "./store.js";
import { drawDotDial } from "./dial.js";
import { positionLabel } from "./views/measure.js";

const W = 1080, H = 1350, PAD = 72;
const INK = "#1E1F22", MUTED = "rgba(30,31,34,0.55)", ACCENT = "#E8602C";

async function loadImage(blob) {
  if (!blob) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function fitText(ctx, text, font, size, maxWidth) {
  let s = size;
  do {
    ctx.font = font.replace("{s}", s);
    if (ctx.measureText(text).width <= maxWidth) break;
    s -= 2;
  } while (s > size * 0.6);
  return s;
}

export async function renderCard(m, watch) {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#F3F2EF";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createLinearGradient(0, 0, W / 2, H / 2);
  glow.addColorStop(0, "rgba(242,217,176,0.35)");
  glow.addColorStop(1, "rgba(242,217,176,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = '500 44px "Inter Num", sans-serif';
  ctx.fillText(store.archiveNumber(m.serial), PAD, PAD + 40);
  ctx.font = '500 30px "Inter Num", sans-serif';
  const status = "Status: Measured";
  const sw = ctx.measureText(status).width;
  ctx.fillStyle = MUTED;
  ctx.fillText(status, W - PAD - sw, PAD + 36);
  ctx.beginPath();
  ctx.arc(W - PAD - sw - 22, PAD + 26, 8, 0, 2 * Math.PI);
  ctx.fillStyle = ACCENT;
  ctx.fill();

  // Hero: the watch photo in a rounded frame, or the dot dial.
  const heroTop = PAD + 90, heroH = 600;
  const photo = await loadImage(watch && watch.photo);
  if (photo) {
    const boxW = W - 2 * PAD, boxH = heroH;
    const scale = Math.max(boxW / photo.width, boxH / photo.height);
    const dw = photo.width * scale, dh = photo.height * scale;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)";
    ctx.shadowBlur = 50;
    ctx.shadowOffsetY = 24;
    ctx.beginPath();
    ctx.roundRect(PAD, heroTop, boxW, boxH, 36);
    ctx.fillStyle = "#ddd";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PAD, heroTop, boxW, boxH, 36);
    ctx.clip();
    ctx.drawImage(photo, PAD + (boxW - dw) / 2, heroTop + (boxH - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    const side = heroH;
    drawDotDial(ctx, side, {
      fill: 1, hands: "tenTen", x: (W - side) / 2, y: heroTop,
      colors: { ink: INK, relief: "#E4E2DD", muted: "#8C8A86", accent: ACCENT },
    });
  }

  let y = heroTop + heroH + 100;
  const name = watch ? watch.name : "";
  ctx.fillStyle = INK;
  const nameSize = fitText(ctx, name, '{s}px "Playfair", serif', 60, W - 2 * PAD);
  ctx.font = `${nameSize}px "Playfair", serif`;
  ctx.fillText(name, PAD, y);

  y += 170;
  ctx.font = '300 160px "Inter Num", sans-serif';
  const rateText = formatRate(m.rate);
  ctx.fillText(rateText, PAD - 6, y);
  const rw = ctx.measureText(rateText).width;
  ctx.font = '500 40px "Inter Num", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText("s/d", PAD + rw + 12, y);

  y += 90;
  const amp = store.measurementAmplitude(m);
  const metrics = [
    ["Beat error", `${m.beatErrorMs.toFixed(2)} ms`],
    ["Amplitude", amp == null ? "–" : `${Math.round(amp)}°`],
    ["BPH", new Intl.NumberFormat("en-US").format(m.bph)],
  ];
  let x = PAD;
  for (const [label, value] of metrics) {
    ctx.font = '400 28px "Pretendard", sans-serif';
    ctx.fillStyle = MUTED;
    ctx.fillText(label, x, y);
    ctx.font = '500 46px "Inter Num", sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(value, x, y + 56);
    x += Math.max(ctx.measureText(value).width, 180) + 60;
  }

  const footer = [
    new Intl.DateTimeFormat(locale(), { year: "numeric", month: "numeric", day: "numeric" }).format(new Date(m.date)),
    m.position ? positionLabel(m.position) : null,
    `σ ${m.residualSigmaMs.toFixed(2)} ms`,
    "Underdial",
  ].filter(Boolean).join(" · ");
  ctx.font = '400 28px "Pretendard", sans-serif';
  ctx.fillStyle = MUTED;
  ctx.fillText(footer, PAD, H - PAD);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function openResultCard(m, watch) {
  if (!m) return;
  sheet(async (body) => {
    body.innerHTML = `<div class="card" style="padding:10px;place-items:center;min-height:200px"><span class="caption">${esc(t("카드를 만드는 중…"))}</span></div>`;
    const blob = await renderCard(m, watch);
    const url = URL.createObjectURL(blob);
    body.innerHTML = `
      <img src="${url}" alt="${esc(t("결과 카드"))}" style="border-radius:14px;box-shadow:var(--shadow);width:100%;height:auto">
      <button class="btn btn-primary btn-block" data-share>${icon("share")}${esc(t("공유 · 사진에 저장"))}</button>
      <p class="caption" style="margin:0;text-align:center">${esc(t("공유 메뉴에서 '이미지 저장'을 누르면 사진첩에 저장됩니다."))}</p>`;
    body.querySelector("[data-share]").onclick = async () => {
      const outcome = await shareOrDownload(blob, `underdial-${store.archiveNumber(m.serial).replace(".", "")}.png`, "Underdial");
      if (outcome === "downloaded") toast(t("이미지를 내려받았습니다."));
    };
  }, { title: t("결과 카드") });
}
