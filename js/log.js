// A short on-device log of errors and failed measurements, for "Send feedback".
// It stays in this browser until the person copies it themselves; nothing is sent anywhere.
// No watch names, photos or sounds are kept: only what went wrong and on what device.
import { APP_VERSION, IS_BETA, STORAGE_NAME } from "./version.js";

const KEY = `${STORAGE_NAME}.log`;
const LIMIT = 40;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

/** kind: "error" | "measure" | "mic". detail is a short string. */
export function logEvent(kind, detail) {
  const entries = read();
  const text = String(detail || "").slice(0, 300);
  const last = entries[entries.length - 1];
  // The same error firing in a loop is counted, not repeated.
  if (last && last.kind === kind && last.detail === text) last.count = (last.count || 1) + 1;
  else entries.push({ at: Date.now(), v: APP_VERSION, kind, detail: text });
  try { localStorage.setItem(KEY, JSON.stringify(entries.slice(-LIMIT))); } catch { /* full or private mode */ }
}

export function clearLog() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export function logEntries() {
  return read();
}

/** Catches what would otherwise only reach the console. */
export function installErrorLog() {
  window.addEventListener("error", (event) => {
    const where = event.filename ? ` @ ${event.filename.split("/").pop()}:${event.lineno}` : "";
    logEvent("error", `${event.message || "error"}${where}`);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    logEvent("error", `promise: ${reason && (reason.message || reason.name) || String(reason)}`);
  });
}

function stamp(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Plain text to paste into a cafe post. */
export function feedbackReport({ watches, measurements, standalone, language, micLabel }) {
  const entries = read();
  const lines = [
    "[Underdial 의견 보내기]",
    `버전: ${APP_VERSION}${IS_BETA ? " (베타)" : ""}`,
    `기기: ${navigator.userAgent}`,
    `화면: ${screen.width}×${screen.height} @${window.devicePixelRatio || 1}x · ${standalone ? "홈 화면 앱" : "브라우저"} · ${language}`,
    `기록: 시계 ${watches}개 · 측정 ${measurements}개`,
  ];
  if (micLabel) lines.push(`마이크: ${micLabel}`);
  lines.push("", entries.length ? `최근 기록 ${entries.length}건:` : "최근 오류 기록 없음");
  for (const e of entries.slice().reverse()) {
    lines.push(`- ${stamp(e.at)} [${e.kind}] ${e.detail}${e.count > 1 ? ` (×${e.count})` : ""}${e.v !== APP_VERSION ? ` (v${e.v})` : ""}`);
  }
  lines.push("", "내용(어떤 상황이었는지 적어 주세요):", "");
  return lines.join("\n");
}
