// Korean is the source language: every string in the code is its Korean text,
// and `t` looks up English when English is chosen. {name} placeholders are filled from `values`.
import { EN } from "./i18n-en.js";
import { STORAGE_NAME } from "./version.js";

let language = "ko";
const listeners = new Set();

export function initLanguage() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(`${STORAGE_NAME}.prefs`) || "{}").language; } catch { /* private mode */ }
  language = saved || "ko";
  document.documentElement.lang = language;
}

export function getLanguage() {
  return language;
}

export function setLanguage(next) {
  language = next === "en" ? "en" : "ko";
  document.documentElement.lang = language;
  listeners.forEach((listener) => listener());
}

export function onLanguageChange(listener) {
  listeners.add(listener);
}

export const locale = () => (language === "en" ? "en-US" : "ko-KR");

export function t(key, values) {
  let text = language === "en" ? EN[key] ?? key : key;
  if (values) text = text.replace(/\{(\w+)\}/g, (_, name) => (values[name] ?? ""));
  return text;
}
