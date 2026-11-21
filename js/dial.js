// Canvas drawings: the dot dial (watches without a photo, onboarding), the measuring gauge,
// the paper tape, and the clock card. Ported from DialSlab, MotionGauge and PaperTapeView.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Sizes a canvas to its CSS box at device pixel ratio; returns the context and CSS size. */
export function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(rect.width * ratio)), h = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function sword(ctx, cx, cy, angleDeg, length, width, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angleDeg * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(0, -length);
  ctx.lineTo(width / 2, -length * 0.78);
  ctx.lineTo(0, 0);
  ctx.lineTo(-width / 2, -length * 0.78);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/**
 * The dot dial: fine dots on a few circles and a ring of larger dots filled to `fill`.
 * `colors` lets the result card draw it with fixed colors.
 */
export function drawDotDial(ctx, size, { fill = 1, hands = "tenTen", rate = null, colors = null, x = 0, y = 0 } = {}) {
  const c = colors || { ink: css("--ink"), relief: css("--relief"), muted: css("--text-2"), accent: css("--accent") };
  const side = size, cx = x + side / 2, cy = y + side / 2;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = c.muted;
  for (const share of [0.44, 0.48, 0.18, 0.13]) {
    const radius = side * share;
    const count = Math.trunc(2 * Math.PI * radius / (side * 0.028));
    for (let i = 0; i < count; i++) {
      const a = i / count * 2 * Math.PI;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, side * 0.006, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();

  const radius = side * 0.36, dots = 60;
  const filled = Math.round(Math.min(1, Math.max(0, fill)) * dots);
  for (let i = 0; i < dots; i++) {
    const a = i / dots * 2 * Math.PI - Math.PI / 2;
    const isFilled = i < filled;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, side * (isFilled ? 0.016 : 0.011), 0, 2 * Math.PI);
    ctx.fillStyle = i === filled - 1 && filled < dots ? c.accent : isFilled ? c.ink : c.relief;
    ctx.fill();
  }

  if (hands === "tenTen") {
    sword(ctx, cx, cy, -55, side * 0.2, side * 0.026, c.ink);
    sword(ctx, cx, cy, 55, side * 0.28, side * 0.02, c.ink);
    ctx.beginPath();
    ctx.arc(cx, cy, side * 0.015, 0, 2 * Math.PI);
    ctx.fillStyle = c.accent;
    ctx.fill();
  } else if (hands === "rate") {
    const angle = rate == null ? 0 : Math.min(60, Math.max(-60, rate * 2));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle * Math.PI / 180);
    // A short needle near the ring, leaning toward the error direction.
    sword(ctx, 0, -side * 0.23, 0, side * 0.08, side * 0.026, c.accent);
    ctx.restore();
  }
}

/** Draws the dot dial into a canvas element, filling its box. */
export function paintDotDial(canvas, options = {}) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const side = Math.min(width, height);
  drawDotDial(ctx, side, { ...options, x: (width - side) / 2, y: (height - side) / 2 });
}

/**
 * The gauge on the black measuring stage: 96 ticks lit to `fill`, ripples at the
 * beat rate while listening, a dot circling inside while live, and a ring of light
 * spreading out for a moment after completion. Call `update` with new state; it animates itself.
 */
export class MotionGauge {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = { fill: 0, pulseRate: null, isLive: false, completedAt: null };
    this.shownFill = 0;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.frame = null;
    this.accent = "#FF7A45";
    this.draw = this.draw.bind(this);
    this.frame = requestAnimationFrame(this.draw);
  }

  update(patch) {
    Object.assign(this.state, patch);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
  }

  draw(now) {
    this.frame = requestAnimationFrame(this.draw);
    const { ctx, width, height } = fitCanvas(this.canvas);
    const time = now / 1000;
    ctx.clearRect(0, 0, width, height);
    // Ease the lit arc toward its target instead of jumping.
    this.shownFill += (this.state.fill - this.shownFill) * (this.reduceMotion ? 1 : 0.12);
    const cx = width / 2, cy = height / 2, radius = Math.min(width, height) / 2 * 0.94;
    const ticks = 96, lit = Math.round(Math.min(1, Math.max(0, this.shownFill)) * ticks);

    if (this.state.completedAt && !this.reduceMotion) {
      const age = (performance.now() - this.state.completedAt) / 1000;
      if (age >= 0 && age < 1.4) {
        const p = age / 1.4, r = radius * (0.6 + 0.5 * p);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255,122,69,${0.7 * (1 - p)})`;
        ctx.lineWidth = 2 + 6 * (1 - p);
        ctx.stroke();
      }
    }

    if (this.state.pulseRate && !this.reduceMotion) {
      for (let wave = 0; wave < 2; wave++) {
        const phase = (time * this.state.pulseRate + wave * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(cx, cy, radius * (0.55 + 0.3 * phase), 0, 2 * Math.PI);
        ctx.strokeStyle = `rgba(255,255,255,${0.18 * (1 - phase)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.lineCap = "round";
    for (let i = 0; i < ticks; i++) {
      const a = i / ticks * 2 * Math.PI - Math.PI / 2;
      const isMajor = i % 8 === 0;
      const isHead = this.state.isLive && i === lit - 1 && lit < ticks;
      const length = isHead ? 30 : isMajor ? 20 : 12;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (radius - length), cy + Math.sin(a) * (radius - length));
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.strokeStyle = isHead ? this.accent : i < lit ? "#fff" : "rgba(255,255,255,0.16)";
      ctx.lineWidth = isHead ? 3 : isMajor ? 2 : 1.2;
      ctx.stroke();
    }

    if (this.state.isLive && !this.reduceMotion) {
      const orbit = (time % 3) / 3 * 2 * Math.PI - Math.PI / 2, r = radius - 44;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(orbit) * r, cy + Math.sin(orbit) * r, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = this.accent;
      ctx.fill();
    }
  }
}

/** Ticks and tocks as two rows; a row that drifts shows the rate. */
export function paintTape(canvas, points, duration) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const middle = height / 2, range = 5, rowOffset = height * 0.22, scale = (height / 2 - rowOffset) / range;
  ctx.strokeStyle = css("--relief") || "#E4E2DD";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, middle);
  ctx.lineTo(width, middle);
  ctx.stroke();
  const accent = "#E8602C", muted = "#8C8A86";
  for (const p of points) {
    const clamped = Math.min(range, Math.max(-range, p.deviationMs));
    const x = 6 + (width - 12) * Math.min(1, p.elapsed / duration);
    const y = middle + (p.isTick ? -rowOffset : rowOffset) + clamped * scale;
    ctx.beginPath();
    ctx.arc(x, y, 1.6, 0, 2 * Math.PI);
    ctx.fillStyle = p.isTick ? accent : muted;
    ctx.fill();
  }
}

/** Analog clock with a sweeping seconds hand. */
export function paintClock(canvas, date) {
  const { ctx, width, height } = fitCanvas(canvas);
  ctx.clearRect(0, 0, width, height);
  const side = Math.min(width, height), cx = width / 2, cy = height / 2, r = side / 2 * 0.96;
  const ink = css("--ink"), muted = css("--text-2"), accent = css("--accent");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fillStyle = css("--surface");
  ctx.fill();
  for (let i = 0; i < 60; i++) {
    const a = i / 60 * 2 * Math.PI, major = i % 5 === 0;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(a) * r * 0.86, cy - Math.cos(a) * r * 0.86, major ? side * 0.012 : side * 0.005, 0, 2 * Math.PI);
    ctx.fillStyle = major ? ink : muted;
    ctx.fill();
  }
  const s = date.getSeconds() + date.getMilliseconds() / 1000;
  const m = date.getMinutes() + s / 60, h = (date.getHours() % 12) + m / 60;
  sword(ctx, cx, cy, h * 30, r * 0.5, side * 0.04, ink);
  sword(ctx, cx, cy, m * 6, r * 0.74, side * 0.03, ink);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(s * 6 * Math.PI / 180);
  ctx.beginPath();
  ctx.moveTo(0, r * 0.14);
  ctx.lineTo(0, -r * 0.8);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, side * 0.018, 0, 2 * Math.PI);
  ctx.fillStyle = accent;
  ctx.fill();
}
