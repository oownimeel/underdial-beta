// Small DOM helpers shared by the views: escaping, icons, sheets, confirmations, toasts, formatting.
import { t, locale } from "./i18n.js";

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const ICON_PATHS = {
  watch: '<circle cx="12" cy="12" r="6"/><path d="M12 9v3l2 1.5"/><path d="M9 6.5 9.6 3h4.8l.6 3.5M9 17.5l.6 3.5h4.8l.6-3.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  wave: '<path d="M3 12h3l2-6 4 12 3-9 2 3h4"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v8h14v-8"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  play: '<path d="M7 5v14l12-7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  download: '<path d="M12 4v11M8 11l4 4 4-4"/><path d="M5 20h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
};

export function icon(name, extra = "") {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICON_PATHS[name] || ""}</svg>`;
}

// MARK: Formatting

export function formatRate(rate, digits = 1) {
  if (rate == null || !isFinite(rate)) return "–";
  const rounded = Number(rate.toFixed(digits));
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return sign + Math.abs(rounded).toFixed(digits);
}

export const formatNumber = (n) => new Intl.NumberFormat(locale()).format(n);

export function formatDate(time, options = { month: "long", day: "numeric", weekday: "short" }) {
  return new Intl.DateTimeFormat(locale(), options).format(new Date(time));
}

export function formatDateTime(time) {
  return new Intl.DateTimeFormat(locale(), { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(time));
}

export function formatRelative(time) {
  const seconds = (time - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(0, "minute");
}

// MARK: Blob URLs, cached so re-renders don't leak them

const urlCache = new WeakMap();
export function blobURL(blob) {
  if (!blob) return null;
  let url = urlCache.get(blob);
  if (!url) { url = URL.createObjectURL(blob); urlCache.set(blob, url); }
  return url;
}

// MARK: Sheets

let openSheets = [];

/** Shows a bottom sheet. `render(body, close)` fills it. Returns close(). */
export function sheet(render, { title = "", onClose } = {}) {
  const root = document.getElementById("sheet-root");
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  const panel = document.createElement("section");
  panel.className = "sheet";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.innerHTML = `<div class="sheet-grip"></div>${title ? `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="${esc(t("닫기"))}">${icon("close")}</button></div>` : ""}<div class="sheet-body"></div>`;
  root.append(backdrop, panel);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openSheets = openSheets.filter((s) => s !== close);
    panel.classList.add("closing");
    backdrop.classList.add("closing");
    setTimeout(() => { panel.remove(); backdrop.remove(); onClose && onClose(); }, 220);
  };
  backdrop.addEventListener("click", close);
  panel.querySelector("[data-close]")?.addEventListener("click", close);
  openSheets.push(close);
  render(panel.querySelector(".sheet-body"), close);
  const focusable = panel.querySelector("input, button:not([data-close])");
  if (focusable && !matchMedia("(pointer: coarse)").matches) focusable.focus();
  return close;
}

export function closeAllSheets() {
  [...openSheets].forEach((close) => close());
}

/** Confirmation sheet; resolves true only on the destructive choice. */
export function confirmDelete({ title, message, action = t("삭제") }) {
  return new Promise((resolve) => {
    let answered = false;
    sheet((body, close) => {
      body.innerHTML = `
        <div class="confirm">
          <div class="icon-circle">${icon("trash")}</div>
          <h2>${esc(title)}</h2>
          <p>${esc(message)}</p>
          <div class="row">
            <button class="btn btn-secondary" data-cancel>${esc(t("취소"))}</button>
            <button class="btn btn-danger" data-ok>${esc(action)}</button>
          </div>
        </div>`;
      body.querySelector("[data-cancel]").onclick = () => close();
      body.querySelector("[data-ok]").onclick = () => { answered = true; close(); };
    }, { onClose: () => resolve(answered) });
  });
}

let toastTimer = null;
export function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// MARK: Photos

/** Downscales a picked photo to a JPEG no larger than `max` pixels on its long side. */
export async function preparePhoto(file, max = 1400) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width, h = source.height, scale = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
}

// MARK: Files

/** Shares a file where the browser can, otherwise downloads it. */
export async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if (error && error.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

export function grade(name) {
  return { good: t("양호"), caution: t("주의"), critical: t("점검 권장") }[name];
}
