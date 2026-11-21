// On-device storage (IndexedDB). Nothing here leaves the device.
// watches:      { id, name, caliber, liftAngle|null, createdAt, photo: Blob|null }
// measurements: { id, serial, watchId, date, bph, rate, beatErrorMs, pulseSpanMs, liftAngle,
//                 residualSigmaMs, snrDB, qualityLevel, position, hoursSinceWinding, rateUncertainty, device }
// recordings:   { id, date, watchName, seconds, sampleRate, blob }

import { amplitude, DEFAULT_LIFT_ANGLE } from "./engine.js";
import { STORAGE_NAME } from "./version.js";

const DB_NAME = STORAGE_NAME;
const DB_VERSION = 1;
let dbPromise = null;
const listeners = new Set();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("watches")) db.createObjectStore("watches", { keyPath: "id" });
        if (!db.objectStoreNames.contains("measurements")) {
          const store = db.createObjectStore("measurements", { keyPath: "id" });
          store.createIndex("watchId", "watchId");
        }
        if (!db.objectStoreNames.contains("recordings")) db.createObjectStore("recordings", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function tx(stores, mode, work) {
  const db = await open();
  const transaction = db.transaction(stores, mode);
  const result = await work(transaction);
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  return result;
}

function notify() {
  for (const listener of listeners) listener();
}

export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

// MARK: Watches

// Every read from IndexedDB returns a new Blob, and each would get a new object URL that
// is never freed. Handing back the same Blob while the photo is unchanged keeps one URL per photo.
const photoCache = new Map();
function stablePhoto(w) {
  if (!w || !w.photo) return w;
  const cached = photoCache.get(w.id);
  if (cached && cached.size === w.photo.size && cached.type === w.photo.type) w.photo = cached;
  else photoCache.set(w.id, w.photo);
  return w;
}

export async function watches() {
  const all = await tx(["watches"], "readonly", (t) => done(t.objectStore("watches").getAll()));
  return all.map(stablePhoto).sort((a, b) => a.createdAt - b.createdAt);
}

export async function watch(id) {
  return stablePhoto(await tx(["watches"], "readonly", (t) => done(t.objectStore("watches").get(id))));
}

export async function saveWatch(record) {
  const value = { createdAt: Date.now(), liftAngle: null, caliber: "", photo: null, ...record, id: record.id || newId() };
  await tx(["watches"], "readwrite", (t) => done(t.objectStore("watches").put(value)));
  notify();
  return value;
}

/** Deletes the watch and every measurement taken of it. */
export async function deleteWatch(id) {
  await tx(["watches", "measurements"], "readwrite", async (t) => {
    t.objectStore("watches").delete(id);
    const index = t.objectStore("measurements").index("watchId");
    const keys = await done(index.getAllKeys(id));
    for (const key of keys) t.objectStore("measurements").delete(key);
  });
  notify();
}

export const effectiveLiftAngle = (w) => (w && w.liftAngle ? w.liftAngle : DEFAULT_LIFT_ANGLE);

// MARK: Measurements

export async function measurements() {
  const all = await tx(["measurements"], "readonly", (t) => done(t.objectStore("measurements").getAll()));
  return all.sort((a, b) => b.date - a.date);
}

export async function measurement(id) {
  return tx(["measurements"], "readonly", (t) => done(t.objectStore("measurements").get(id)));
}

export async function saveMeasurement(record) {
  const all = await measurements();
  const serial = all.reduce((m, r) => Math.max(m, r.serial || 0), 0) + 1;
  const value = { ...record, id: newId(), serial, date: Date.now() };
  await tx(["measurements"], "readwrite", (t) => done(t.objectStore("measurements").put(value)));
  notify();
  return value;
}

export async function deleteMeasurement(id) {
  await tx(["measurements"], "readwrite", (t) => done(t.objectStore("measurements").delete(id)));
  notify();
}

export function measurementAmplitude(m) {
  return m.pulseSpanMs == null ? null : amplitude(m.liftAngle, m.bph, m.pulseSpanMs / 1000);
}

export const archiveNumber = (serial) => "No." + String(serial).padStart(3, "0");

// MARK: Recordings

const MAX_RECORDINGS = 30;

export async function recordings() {
  const all = await tx(["recordings"], "readonly", (t) => done(t.objectStore("recordings").getAll()));
  return all.sort((a, b) => b.date - a.date);
}

/** Keeps the most recent recordings so the store doesn't grow without bound. */
export async function saveRecording(record) {
  const value = { ...record, id: newId(), date: Date.now() };
  const existing = await recordings();
  await tx(["recordings"], "readwrite", (t) => {
    const store = t.objectStore("recordings");
    store.put(value);
    for (const old of existing.slice(MAX_RECORDINGS - 1)) store.delete(old.id);
  });
  notify();
  return value;
}

export async function deleteRecording(id) {
  await tx(["recordings"], "readwrite", (t) => done(t.objectStore("recordings").delete(id)));
  notify();
}

// MARK: Backup

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

/** Watches (with photos) and measurements as one JSON file. Recordings are left out; they are large. */
export async function exportBackup() {
  const ws = await watches();
  const ms = await measurements();
  const out = {
    format: "underdial-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    watches: await Promise.all(ws.map(async (w) => ({ ...w, photo: w.photo ? await blobToDataURL(w.photo) : null }))),
    measurements: ms,
  };
  return new Blob([JSON.stringify(out)], { type: "application/json" });
}

/** Merges a backup: records with the same id are replaced, others are added. Returns counts. */
export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.format !== "underdial-backup" || !Array.isArray(data.watches) || !Array.isArray(data.measurements)) {
    throw new Error("invalid-backup");
  }
  const ws = await Promise.all(data.watches.map(async (w) => ({ ...w, photo: w.photo ? await dataURLToBlob(w.photo) : null })));
  await tx(["watches", "measurements"], "readwrite", (t) => {
    for (const w of ws) t.objectStore("watches").put(w);
    for (const m of data.measurements) t.objectStore("measurements").put(m);
  });
  notify();
  return { watches: ws.length, measurements: data.measurements.length };
}

// MARK: Persistence

/** Asks the browser not to evict our data. Safari grants it to home-screen apps. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch { /* not supported */ }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* not supported */ }
  return null;
}

// MARK: Preferences (small, per device)

export const PREFS_KEY = `${STORAGE_NAME}.prefs`;
const defaults = { language: null, autoStart: false, onboarded: false, keepRecordings: true, lastWatchId: null, theme: "system" };

export function prefs() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}

export function setPrefs(patch) {
  const next = { ...prefs(), ...patch };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}
