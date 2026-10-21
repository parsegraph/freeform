import { mousePanSettings } from "./mousePanSettings";

// Speeds are in screen pixels so navigation feels consistent at every zoom.
const KEY_SPEED = 800;
const KEY_RESPONSE = 12;
const FRICTION = 8;
const STOP_SPEED = 5;
const MAX_FLING_SPEED = 2400;
const DRAG_SAMPLE_MS = 80;
const KEY_DIRECTIONS = new Map([
  ["ArrowLeft", [1, 0]],
  ["ArrowRight", [-1, 0]],
  ["ArrowUp", [0, 1]],
  ["ArrowDown", [0, -1]],
]);

export default class ViewportPan {
  constructor(viewport, settings = mousePanSettings) {
    this._viewport = viewport;
    this._settings = settings;
    this._mouseGlide = false;
    this._keys = new Map();
    this._velocity = [0, 0];
    this._frame = null;
    this._samples = null;
  }

  stop() {
    if (this._frame !== null) {
      cancelAnimationFrame(this._frame);
      this._frame = null;
    }
    this._keys.clear();
    this._velocity = [0, 0];
    this._samples = null;
    this._mouseGlide = false;
  }

  keyDown(key, direction = key) {
    if (!KEY_DIRECTIONS.has(direction)) {
      return false;
    }
    if (!this._samples) {
      this._mouseGlide = false;
      this._keys.set(key, direction);
      this.schedule();
    }
    return true;
  }

  keyUp(key) {
    this._keys.delete(key);
  }

  schedule() {
    if (this._frame !== null) {
      return;
    }
    this._lastFrame = performance.now();
    this._frame = requestAnimationFrame((time) => this.tick(time));
  }

  tick(time) {
    this._frame = null;
    if (!this._viewport.hasWidget() || this._viewport.showingEditor()) {
      this.stop();
      return;
    }
    // Avoid a large jump after a stalled or backgrounded frame.
    const dt = Math.min((time - this._lastFrame) / 1000, 0.05);
    this._lastFrame = time;
    let x = 0;
    let y = 0;
    // Aliases can be held together without doubling a direction's influence.
    new Set(this._keys.values()).forEach((key) => {
      const direction = KEY_DIRECTIONS.get(key);
      x += direction[0];
      y += direction[1];
    });
    const length = Math.hypot(x, y) || 1;
    const target = [x * KEY_SPEED / length, y * KEY_SPEED / length];
    const friction = this._mouseGlide ? this._settings.friction : FRICTION;
    const rate = this._keys.size ? KEY_RESPONSE : friction;
    const decay = Math.exp(-rate * dt);
    const movement = target.map((speed, axis) => {
      const difference = this._velocity[axis] - speed;
      this._velocity[axis] = speed + difference * decay;
      return speed * dt + difference * (1 - decay) / rate;
    });
    this.move(...movement);
    if (this._keys.size || Math.hypot(...this._velocity) > STOP_SPEED) {
      this._frame = requestAnimationFrame((nextTime) => this.tick(nextTime));
    } else {
      this._velocity = [0, 0];
    }
  }

  move(dx, dy) {
    if (!dx && !dy) {
      return;
    }
    const cam = this._viewport.camera();
    cam.adjustOrigin(dx / cam.scale(), dy / cam.scale());
    this._viewport.refresh();
  }

  beginDrag(time = performance.now()) {
    this.stop();
    this._samples = [{ time, x: 0, y: 0 }];
  }

  dragBy(dx, dy, time = performance.now()) {
    if (!this._samples || (!dx && !dy)) {
      return;
    }
    dx *= this._settings.dragSpeed;
    dy *= this._settings.dragSpeed;
    this.move(dx, dy);
    const last = this._samples[this._samples.length - 1];
    this._samples.push({ time, x: last.x + dx, y: last.y + dy });
    // Keep the sample preceding the window, including at low event rates.
    while (this._samples.length > 2 && this._samples[1].time < time - DRAG_SAMPLE_MS) {
      this._samples.shift();
    }
  }

  endDrag(time = performance.now()) {
    const samples = this._samples;
    this._samples = null;
    if (!samples || samples.length < 2) {
      return;
    }
    const first = samples[0];
    const last = samples[samples.length - 1];
    // Event timestamps preserve flick speed when rendering delays input handling.
    // Coarse clocks can still give equal timestamps; cap the resulting speed below.
    const dt = Math.max(1, last.time - first.time) / 1000;
    const vx = (last.x - first.x) / dt * this._settings.glideStrength;
    const vy = (last.y - first.y) / dt * this._settings.glideStrength;
    const limit = Math.min(1, MAX_FLING_SPEED / Math.hypot(vx, vy));
    const decay = Math.exp(-Math.max(0, time - last.time) / this._settings.releaseGrace);
    this._velocity = [vx * limit * decay, vy * limit * decay];
    this._mouseGlide = true;
    if (Math.hypot(...this._velocity) > STOP_SPEED) {
      this.schedule();
    }
  }
}
