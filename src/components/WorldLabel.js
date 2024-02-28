import Rect from "parsegraph-rect";
import { containsAny } from "parsegraph-camera";
import Color from "parsegraph-color";

export class Occluder {
  constructor(x, y, width, height) {
    this._bbox = new Rect(x, y, width, height);
    this.clear();
  }

  clear() {
    this._rects = [];
  }

  occlude(x, y, w, h) {
    if (
      !containsAny(
        this._bbox.x(),
        this._bbox.y(),
        this._bbox.width(),
        this._bbox.height(),
        x,
        y,
        w,
        h
      )
    ) {
      // console.log("Occluded outside bbox", this._bbox.toString(), x, y, w, h);
      return false;
    }
    if (
      this._rects.some((rect) => {
        return containsAny(rect.x(), rect.y(), rect.w(), rect.h(), x, y, w, h);
      })
    ) {
      return false;
    }
    const newRect = new Rect(x, y, w, h);
    this._rects.push(newRect);
    return true;
  }
}

const DEFAULT_COLOR = new Color(0, 0, 0, 1);

export class WorldLabel {
  text() {
    return this._text;
  }

  constructor(
    text,
    x,
    y,
    size,
    scale,
    color,
    strokeColor
  ) {
    this._text = text;
    this._x = x;
    this._y = y;
    this._size = size;
    this._scale = scale;
    this._color = color;
    this._strokeColor = strokeColor;
  }

  x() {
    return this._x;
  }

  scale() {
    return this._scale;
  }

  y() {
    return this._y;
  }

  size() {
    return this._size;
  }

  color() {
    return this._color ?? DEFAULT_COLOR;
  }

  strokeColor() {
    return this._strokeColor;
  }
}

export class WorldLabels {
  constructor(scaleMultiplier) {
    this.clear();
    this._lineWidth = 2;
    this._scaleMultiplier = scaleMultiplier;
    this._font = "sans-serif";
  }

  draw(
    text,
    x,
    y,
    size,
    scale = 1,
    color = null,
    strokeColor = null
  ) {
    this._labels.push(
      new WorldLabel(text, x, y, size, scale, color, strokeColor)
    );
  }

  clear() {
    this._labels = [];
  }

  lineWidth() {
    return this._lineWidth;
  }

  setLineWidth(width) {
    this._lineWidth = width;
  }

  font() {
    return this._font;
  }

  setFont(font) {
    this._font = font;
  }

  setScaleMultiplier(multiplier) {
    this._scaleMultiplier = multiplier;
  }

  render(ctx, worldX, worldY, worldWidth, worldHeight, worldScale) {
    const x = worldX;
    const y = worldY;
    const scale = worldScale;
    const w = worldWidth / scale;
    const h = worldHeight / scale;
    this._labels = this._labels.sort((a, b) => b.size() - a.size());
    const occluder = new Occluder(-x + w / 2, -y + h / 2, w, h);
    const drawnLabels = this._labels.filter((label) => {
      if (label.scale() > this._scaleMultiplier / scale) {
        return false;
      }
      ctx.font = `${Math.round(
        label.size() / scale
      )}px ${this.font()}`;
      const metrics = ctx.measureText(label.text());
      const height =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const width = metrics.width;
      return occluder.occlude(label.x(), label.y(), width, height);
    });
    drawnLabels.forEach((label) => {
      const overlay = ctx;
      overlay.font = `${Math.round(label.size() / scale)}px ${this.font()}`;
      overlay.strokeStyle = label.strokeColor()
        ? label.strokeColor().asRGB()
        : label.color().luminance() < 0.1
        ? "white"
        : "black";
      overlay.miterLimit = this.lineWidth();
      overlay.lineWidth = this.lineWidth() / scale;
      overlay.lineCap = "round";
      overlay.textAlign = "center";
      overlay.textBaseline = "middle";
      ctx.strokeText(label.text(), label.x(), label.y());
      ctx.fillStyle = label.color().asRGB();
      ctx.fillText(label.text(), label.x(), label.y());
    });
  }
}