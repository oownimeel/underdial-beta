// App shell: hash routing between the three tabs, the floating tab bar and + menu,
// the splash, first-run onboarding and offline support.
import { t, initLanguage, onLanguageChange } from "./i18n.js";
import { $, esc, icon, closeAllSheets } from "./ui.js";
import * as store from "./store.js";
import { renderHome } from "./views/home.js";
import { renderRecords } from "./views/records.js";
import { renderSettings } from "./views/settings.js";
import { openMeasure } from "./views/measure.js";
import { openEditWatch } from "./views/watch.js";
import { showOnboarding } from "./views/onboarding.js";
import { installErrorLog } from "./log.js";
import { IS_BETA } from "./version.js";

const TABS = [
  { route: "home", icon: "watch", label: "시계", render: renderHome },
  { route: "records", icon: "list", label: "기록", render: renderRecords },
  { route: "settings", icon: "gear", label: "설정", render: renderSettings },
];

let current = null;   // { route, element, cleanup }
let menuOpen = false;
let showSeq = 0;      // only the newest of overlapping renders is kept

function routeFromHash() {
  const name = location.hash.replace("#", "");
  return TABS.some((tab) => tab.route === name) ? name : "home";
}

export function navigate(route) {
  if (location.hash !== "#" + route) location.hash = route;
  else show(route);
}

/** Each tab lives in its own scroll container; switching cross-fades instead of rebuilding the page. */
async function show(route, { force = false } = {}) {
  if (!force && current && current.route === route) return;
  const seq = ++showSeq;
  const tab = TABS.find((x) => x.route === route);
  const app = $("#app");
  const element = document.createElement("main");
  element.className = "screen";
  element.style.opacity = "0";
  const inner = document.createElement("div");
  inner.className = "screen-inner";
  element.append(inner);
  app.append(element);

  const cleanup = await tab.render(inner, { navigate, refresh: () => show(route, { force: true }) });
  // Rendering is async (it reads the database). If another show() started meanwhile,
  // this one is stale: drop it rather than leave a second copy of the screen behind.
  if (seq !== showSeq) {
    cleanup && cleanup();
    element.remove();
    return;
  }
  const previous = current;
  current = { route, element, cleanup };
  if (previous && previous.route === route) element.scrollTop = previous.element.scrollTop;
  requestAnimationFrame(() => { element.style.opacity = "1"; });
  if (previous) {
    previous.element.classList.add("leaving");
    previous.cleanup && previous.cleanup();
    setTimeout(() => previous.element.remove(), force ? 0 : 230);
  }
  for (const stray of [...app.children]) {
    if (stray !== element && (!previous || stray !== previous.element)) stray.remove();
  }
  renderTabbar();
}

/** Several saves in a row (e.g. six positions) cause one re-render, not six. */
let refreshQueued = false;
function refreshCurrent() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(() => {
    refreshQueued = false;
    if (current) show(current.route, { force: true });
  }, 60);
}

function renderTabbar() {
  let bar = $(".tabbar");
  if (!bar) {
    bar = document.createElement("nav");
    bar.className = "tabbar";
    document.body.append(bar);
  }
  const index = Math.max(0, TABS.findIndex((tab) => current && tab.route === current.route));
  bar.setAttribute("aria-label", t("메뉴"));
  bar.innerHTML = `
    <div class="tabs glass">
      <span class="tab-pill" style="transform: translateX(${index * 56}px)"></span>
      ${TABS.map((tab) => `<button class="tab" data-route="${tab.route}" aria-label="${esc(t(tab.label))}" ${current && current.route === tab.route ? 'aria-current="page"' : ""}>${icon(tab.icon)}</button>`).join("")}
    </div>
    <button class="fab" aria-label="${esc(t("새로 만들기"))}" aria-expanded="${menuOpen}">${icon("plus")}</button>`;
  bar.querySelectorAll(".tab").forEach((button) => {
    button.onclick = () => { closeMenu(); navigate(button.dataset.route); };
  });
  bar.querySelector(".fab").onclick = () => (menuOpen ? closeMenu() : openMenu());
}

function openMenu() {
  menuOpen = true;
  renderTabbar();
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.onclick = closeMenu;
  const menu = document.createElement("div");
  menu.className = "fab-menu glass";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button role="menuitem" data-act="measure">${esc(t("측정"))}${icon("wave")}</button>
    <button role="menuitem" data-act="positions">${esc(t("포지션 측정"))}${icon("rotate")}</button>
    <button role="menuitem" data-act="add">${esc(t("시계 추가"))}${icon("plus")}</button>`;
  menu.querySelector('[data-act="measure"]').onclick = () => { closeMenu(); startMeasure("single"); };
  menu.querySelector('[data-act="positions"]').onclick = () => { closeMenu(); startMeasure("positions"); };
  menu.querySelector('[data-act="add"]').onclick = () => { closeMenu(); openEditWatch(null); };
  document.body.append(scrim, menu);
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  document.querySelector(".fab-menu")?.remove();
  document.querySelector(".scrim")?.remove();
  renderTabbar();
}

export function startMeasure(mode = "single", watchId = null) {
  closeAllSheets();
  openMeasure({ mode, watchId: watchId || store.prefs().lastWatchId });
}

function splash() {
  const el = document.createElement("div");
  el.className = "splash";
  el.innerHTML = `<div class="script" aria-hidden="true">Underdial</div>`;
  document.body.append(el);
  return () => {
    el.classList.add("done");
    setTimeout(() => el.remove(), 520);
  };
}

async function boot() {
  installErrorLog();
  if (IS_BETA) {
    // The home-screen name is taken from the title, so the test copy is easy to tell apart.
    document.title = "Underdial β";
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", "Underdial β");
    document.documentElement.dataset.channel = "beta";
  }
  initLanguage();
  const theme = store.prefs().theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  const hideSplash = splash();
  window.addEventListener("hashchange", () => { closeMenu(); show(routeFromHash()); });
  // Re-render the visible tab when data changes elsewhere (a save in the measure stage, an import).
  store.onChange(refreshCurrent);
  onLanguageChange(refreshCurrent);

  await show(routeFromHash());
  setTimeout(() => {
    hideSplash();
    if (!store.prefs().onboarded) showOnboarding();
  }, 1500);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  store.requestPersistence();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  window.__installPrompt = event;
});

window.__underdial = { startMeasure, navigate };
boot();
