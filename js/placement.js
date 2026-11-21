// How to hold the phone against the watch for each position, as a looping
// drawing on the black stage: the phone comes down, the microphone touches,
// the ticks ripple out. Mirrors PlacementGuide.swift.
import { t } from "./i18n.js";

const CYCLE = 3.6;
// The scene is drawn in a fixed 320 × 220 box and scaled to fit the canvas.
const W = 320, H = 220;

export const PLACEMENT_TEXT = {
  dialUp: "시계를 다이얼이 위로 오게 눕히고, 스마트폰을 세워 아래쪽 끝을 유리에 가볍게 대 주세요.",
  dialDown: "시계를 뒤집어 뒷면이 위로 오게 두고, 스마트폰 아래쪽 끝을 케이스 뒷면에 대 주세요.",
  crownUp: "시계를 세워 크라운이 위를 향하게 두고, 스마트폰 아래쪽 끝을 케이스 위쪽에 대 주세요.",
  crownDown: "시계를 세워 크라운이 아래를 향하게 두고, 스마트폰 아래쪽 끝을 케이스 위쪽에 대 주세요.",
  crownLeft: "시계를 세워 크라운이 왼쪽을 향하게 두고, 스마트폰 아래쪽 끝을 케이스 위쪽에 대 주세요.",
  crownRight: "시계를 세워 크라운이 오른쪽을 향하게 두고, 스마트폰 아래쪽 끝을 케이스 위쪽에 대 주세요.",
};

const smooth = (v, a, b) => { const x = Math.min(1, Math.max(0, (v - a) / (b - a))); return x * x * (3 - 2 * x); };

export class PlacementGuide {
  constructor(canvas) {
    this.canvas = canvas;
    this.position = "dialUp";
    this.frame = null;
    this.running = false;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.started = performance.now();
    this.loop = (now) => {
      this.frame = null;
      if (!this.running) return;
      this.draw(((now - this.started) / 1000) % CYCLE);
      if (!this.reduceMotion) this.frame = requestAnimationFrame(this.loop);
    };
  }

  setPosition(position) {
    const next = position || "dialUp";
    if (next !== this.position) { this.position = next; this.started = performance.now(); }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.started = performance.now();
    // Without motion, hold the moment the phone touches.
    if (this.reduceMotion) { this.draw(1.6); return; }
    this.frame = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  redraw() { if (this.running && this.reduceMotion) this.draw(1.6); }

  draw(time) {
    const c = this.canvas;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const cw = c.clientWidth, ch = c.clientHeight;
    if (!cw || !ch) return;
    if (c.width !== Math.round(cw * ratio) || c.height !== Math.round(ch * ratio)) { c.width = Math.round(cw * ratio); c.height = Math.round(ch * ratio); }
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const s = Math.min(cw / W, ch / H) * ratio;
    g.setTransform(s, 0, 0, s, (c.width - W * s) / 2, (c.height - H * s) / 2);

    const css = getComputedStyle(c);
    const col = {
      line: "rgba(255,255,255,0.55)",
      ink: css.getPropertyValue("--stage-text").trim() || "#F4F2EE",
      relief: "rgba(255,255,255,0.2)",
      fill: css.getPropertyValue("--stage").trim() || "#050506",
      accent: css.getPropertyValue("--accent").trim() || "#FF7A45",
      font: css.getPropertyValue("--font").trim() || "system-ui, sans-serif",
    };
    new Scene(g, this.position, time, col).draw();
  }
}

class Scene {
  constructor(g, position, time, col) {
    this.g = g; this.position = position; this.time = time; this.col = col;
    this.landing = smooth(time, 0.1, 0.9) * (1 - smooth(time, 3.1, 3.5));
  }

  stroke(color, width = 1.2) {
    const g = this.g;
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = "round"; g.lineJoin = "round"; g.stroke();
  }

  label(text, x, y, color, align = "center") {
    const g = this.g;
    g.font = `12px ${this.col.font}`;
    g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle";
    g.fillText(text, x, y);
  }

  draw() {
    const g = this.g, { line } = this.col;
    const groundY = H - 14, midX = W / 2;
    g.beginPath(); g.moveTo(midX - 150, groundY); g.lineTo(midX + 150, groundY); this.stroke(this.col.relief, 1);

    const lying = this.position === "dialUp" || this.position === "dialDown";
    let contact, surface;
    if (lying) {
      contact = this.drawLying(midX, groundY, this.position === "dialUp");
      surface = { text: t(this.position === "dialUp" ? "유리" : "뒷면"), x: contact.x - 92, y: contact.y - 30 };
    } else {
      contact = this.drawStanding(midX, groundY);
      surface = { text: t("케이스"), x: contact.x - 96, y: contact.y - 26 };
    }
    // Standing watches are taller, so the phone is drawn shorter to stay in frame.
    this.drawPhone(contact, lying ? 100 : 72);
    this.drawRipples(contact);

    g.beginPath(); g.moveTo(contact.x - 18, contact.y + 2); g.lineTo(surface.x + 18, surface.y + 8); this.stroke(line, 1);
    this.label(surface.text, surface.x, surface.y, line);
  }

  // Side view, lying flat. Returns where the phone touches.
  drawLying(midX, groundY, faceUp) {
    const g = this.g, { line, ink } = this.col;
    for (const side of [-1, 1]) {
      g.beginPath();
      if (faceUp) {
        g.moveTo(midX + side * 58, groundY - 22);
        g.quadraticCurveTo(midX + side * 100, groundY - 4, midX + side * 134, groundY - 7);
        g.lineTo(midX + side * 134, groundY - 1);
        g.quadraticCurveTo(midX + side * 96, groundY + 5, midX + side * 58, groundY - 12);
      } else {
        // Turned over, the strap curls up and away from the table.
        g.moveTo(midX + side * 58, groundY - 30);
        g.quadraticCurveTo(midX + side * 104, groundY - 30, midX + side * 126, groundY - 58);
        g.lineTo(midX + side * 132, groundY - 52);
        g.quadraticCurveTo(midX + side * 106, groundY - 18, midX + side * 58, groundY - 20);
      }
      this.stroke(line);
    }
    g.beginPath(); g.roundRect(midX - 64, groundY - 32, 128, 26, 10); this.stroke(line);

    const topY = groundY - 40;
    g.beginPath(); g.ellipse(midX, topY + 7, 56, 7, 0, 0, Math.PI * 2);
    if (faceUp) {
      this.stroke(ink);
      // A glimpse of the hands under the crystal.
      g.beginPath(); g.moveTo(midX - 18, topY + 4); g.lineTo(midX, topY + 8); g.lineTo(midX + 26, topY + 3);
      g.globalAlpha = 0.7; this.stroke(this.col.accent, 1.5); g.globalAlpha = 1;
    } else {
      g.fillStyle = "rgba(255,255,255,0.1)"; g.fill(); this.stroke(ink);
      g.beginPath(); g.ellipse(midX, topY + 7, 34, 4, 0, 0, Math.PI * 2); this.stroke(line, 1);
    }
    return { x: midX, y: topY + 2 };
  }

  // Front view, standing on its edge with the crown pointing as the position says.
  drawStanding(midX, groundY) {
    const g = this.g, { line, ink, fill, relief } = this.col;
    const radius = 54, strapLength = 34;
    const crownAngle = { crownUp: -90, crownDown: 90, crownLeft: 180 }[this.position] ?? 0;
    const lugAngle = (crownAngle + 90) * Math.PI / 180;
    const crown = crownAngle * Math.PI / 180;

    // Rest the lowest point of the watch on the table.
    const strapReach = (radius + strapLength) * Math.abs(Math.sin(lugAngle));
    const crownReach = crownAngle === 90 ? radius + 10 : radius;
    const cx = midX, cy = groundY - Math.max(strapReach, crownReach);

    for (const dir of [-1, 1]) {
      g.save(); g.translate(cx, cy); g.rotate(lugAngle + (dir < 0 ? Math.PI : 0));
      g.beginPath(); g.roundRect(radius - 6, -15, strapLength + 6, 30, 6); this.stroke(line);
      g.restore();
    }

    g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); this.stroke(ink);
    g.beginPath(); g.arc(cx, cy, radius - 8, 0, Math.PI * 2); this.stroke(line, 1);

    // Indices and hands turn with the watch, so the dial reads as rotated.
    for (let hour = 0; hour < 12; hour++) {
      const a = hour * Math.PI / 6 + crown;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (radius - 14), cy + Math.sin(a) * (radius - 14));
      g.lineTo(cx + Math.cos(a) * (radius - 20), cy + Math.sin(a) * (radius - 20));
      this.stroke(line, hour % 3 === 0 ? 2 : 1);
    }
    for (const [angle, length] of [[-145, radius * 0.45], [-35, radius * 0.62]]) {
      const r = angle * Math.PI / 180 + crown;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(r) * length, cy + Math.sin(r) * length); this.stroke(ink, 3);
    }

    g.save(); g.translate(cx, cy); g.rotate(crown);
    g.beginPath(); g.roundRect(radius - 1, -9, 11, 18, 3); g.fillStyle = relief; g.fill(); this.stroke(ink);
    g.restore();

    // Touch the top of the case, clear of the crown and of a strap pointing up.
    const touch = ({ crownUp: -125, crownLeft: -45, crownRight: -135 }[this.position] ?? -90) * Math.PI / 180;
    return { x: cx + Math.cos(touch) * radius, y: cy + Math.sin(touch) * radius };
  }

  drawPhone(contact, height) {
    const g = this.g, { line, ink, fill, accent } = this.col;
    const width = 24;
    const bottom = contact.y - (1 - this.landing) * 30;
    const x = contact.x - width / 2, y = bottom - height;
    g.globalAlpha = 0.35 + 0.65 * this.landing;
    g.beginPath(); g.roundRect(x, y, width, height, 8); g.fillStyle = fill; g.fill(); this.stroke(ink);
    for (const offset of [0.26, 0.4]) { g.beginPath(); g.roundRect(x - 3, y + height * offset, 3, 18, 1); g.fillStyle = line; g.fill(); }
    // Keep the phone's label well above the microphone's on a short phone.
    const labelY = y + Math.min(30, height * 0.12);
    g.beginPath(); g.moveTo(x + width + 4, labelY); g.lineTo(x + width + 30, labelY); this.stroke(line, 1);
    this.label(t("스마트폰"), x + width + 34, labelY, ink, "left");
    g.globalAlpha = 1;

    const micY = bottom - 3;
    g.beginPath(); g.arc(contact.x, micY, 4, 0, Math.PI * 2); g.fillStyle = accent; g.fill();
    g.beginPath(); g.moveTo(contact.x + 8, micY - 2); g.lineTo(contact.x + 62, micY - 24); this.stroke(accent, 1);
    this.label(t("마이크"), contact.x + 66, micY - 26, accent, "left");
  }

  drawRipples(contact) {
    if (this.landing <= 0.95) return;
    const g = this.g;
    for (let wave = 0; wave < 3; wave++) {
      const age = (((this.time - 0.9) * 1.1 + wave / 3) % 1 + 1) % 1;
      g.beginPath(); g.arc(contact.x, contact.y, 6 + age * 34, 0, Math.PI * 2);
      g.globalAlpha = 0.6 * (1 - age); this.stroke(this.col.accent, 1); g.globalAlpha = 1;
    }
  }
}
