import { cameraTravelSettings } from "./cameraTravelSettings";

export function cameraPose(camera) {
  return {
    x: camera.width() / (2 * camera.scale()) - camera.x(),
    y: camera.height() / (2 * camera.scale()) - camera.y(),
    scale: camera.scale(),
  };
}

export function nodeTravelTarget(camera, layout, sourceNodeScale, referenceScale) {
  const size = [0, 0];
  layout.absoluteSize(size);
  // absoluteSize already includes the node's absolute scale.
  const fit = Math.min(camera.width() * 0.8 / size[0], camera.height() * 0.8 / size[1]);
  return {
    x: layout.absoluteX(),
    y: layout.absoluteY(),
    scale: Math.min(referenceScale * sourceNodeScale / layout.absoluteScale(), fit),
  };
}

export function travelDuration(distance, zoomDoublings, settings = cameraTravelSettings) {
  if (settings.baseTime === 0) return 0;
  let growth = 0;
  if (settings.curve === "logarithmic") growth = Math.log2(1 + distance);
  if (settings.curve === "power") growth = Math.pow(1 + distance, settings.exponent) - 1;
  return Math.min(settings.maxTime,
    settings.baseTime * (1 + settings.distanceGrowth * growth) + settings.zoomTime * zoomDoublings);
}

function validPose(pose) {
  return Number.isFinite(pose.x) && Number.isFinite(pose.y) &&
    Number.isFinite(pose.scale) && pose.scale > 0;
}

export function planTravel(from, to, width, height, nodeOnScreen, settings = cameraTravelSettings) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y) *
    Math.min(from.scale, to.scale) / Math.min(width, height);
  const logRatio = Math.log(to.scale) - Math.log(from.scale);
  const duration = travelDuration(distance, Math.abs(logRatio) / Math.LN2, settings);
  let dip = 0;
  if (!nodeOnScreen && settings.zoomOut > 0 && distance > settings.zoomOutDistance) {
    // At the midpoint, reveal context beyond the wider of the two endpoint views.
    dip = Math.abs(logRatio) / 2 + Math.min(Math.log(16),
      settings.zoomOut * Math.log1p(distance - settings.zoomOutDistance));
  }
  return { from, to, duration, dip };
}

export function sampleTravel(plan, progress) {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0) return { ...plan.from };
  if (t === 1) return { ...plan.to };
  // Quintic smoothstep gives zero velocity and acceleration at both ends.
  const u = t * t * t * (10 + t * (-15 + t * 6));
  const logScale = Math.log(plan.from.scale) * (1 - u) + Math.log(plan.to.scale) * u;
  return {
    x: plan.from.x * (1 - u) + plan.to.x * u,
    y: plan.from.y * (1 - u) + plan.to.y * u,
    scale: Math.exp(logScale - plan.dip * Math.pow(Math.sin(Math.PI * u), 2)),
  };
}

export default class ViewportCameraTravel {
  constructor(viewport, settings = cameraTravelSettings) {
    this._viewport = viewport;
    this._settings = settings;
    this._frame = null;
    this._plan = null;
  }

  active() { return this._plan !== null; }
  destinationScale() { return this._plan?.to.scale; }
  destination() { return this._plan?.to; }

  cancel() {
    if (this._frame !== null) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._plan = null;
  }

  apply(pose) {
    const cam = this._viewport.camera();
    cam.setScale(pose.scale);
    cam.setOrigin(cam.width() / (2 * pose.scale) - pose.x,
      cam.height() / (2 * pose.scale) - pose.y);
  }

  start(to, nodeOnScreen) {
    const cam = this._viewport.camera();
    const from = cameraPose(cam);
    this.cancel();
    if (!validPose(from) || !validPose(to) || !cam.canProject()) return;
    const plan = planTravel(from, to, cam.width(), cam.height(), nodeOnScreen, this._settings);
    if (plan.duration === 0 || (Math.hypot(to.x - from.x, to.y - from.y) * cam.scale() < 0.1 &&
      Math.abs(Math.log(to.scale / from.scale)) < 1e-6)) {
      this.apply(to);
      return;
    }
    this._plan = plan;
    this._start = performance.now();
    this._frame = requestAnimationFrame((time) => this.tick(time));
  }

  tick(time) {
    this._frame = null;
    if (!this._plan) return;
    if (!this._viewport.hasWidget()) {
      this.cancel();
      return;
    }
    const progress = (time - this._start) / this._plan.duration;
    this.apply(sampleTravel(this._plan, progress));
    if (progress >= 1) this._plan = null;
    else this._frame = requestAnimationFrame((next) => this.tick(next));
    this._viewport.refresh();
  }
}
