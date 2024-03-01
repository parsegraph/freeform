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
    fontSize,
    scale,
    color,
    strokeColor
  ) {
    this._text = text;
    this._x = x;
    this._y = y;
    this._fontSize = fontSize;
    this._scale = scale;
    this._color = color;
    this._strokeColor = strokeColor;
  }

  knownSize() {
    return !isNaN(this._measuredWidth) && !isNaN(this._measuredHeight);
  }

  setMeasuredSize(w, h) {
    this._measuredWidth = w;
    this._measuredHeight = h;
  }

  measuredWidth() {
    return this._measuredWidth;
  }

  measuredHeight() {
    return this._measuredHeight;
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

  fontSize() {
    return this._fontSize;
  }

  color() {
    return this._color ?? DEFAULT_COLOR;
  }

  strokeColor() {
    return this._strokeColor;
  }
}

class WorldLabelRendering {
  constructor(worldLabels, ctx, worldX, worldY, worldWidth, worldHeight, worldScale) {
    this._worldLabels = worldLabels;
    this._ctx = ctx;
    this._worldX = worldX;
    this._worldY = worldY;
    this._worldWidth = worldWidth;
    this._worldHeight = worldHeight;
    this._worldScale = worldScale;
    this._drawnLabels = [];
    this._labelsIndex = 0;
  }

  worldLabels() {
    return this._worldLabels;
  }

  crank() {
    const needRender = this.runOcclusion();
    return this.renderLabels() || needRender;
  }

  runOcclusion() {
    const ctx = this._ctx;
    const x = this._worldX;
    const y = this._worldY;
    const scale = this._worldScale;
    const w = this._worldWidth / scale;
    const h = this._worldHeight / scale;
    if (!this._occluder) {
      this._occluder = new Occluder(-x + w / 2, -y + h / 2, w, h);
    }
    const occluder = this._occluder;

    const allLabels = this.worldLabels().labels();
    if (this._labelsIndex >= allLabels.length) {
      console.log("Done with labels");
      return false;
    }
    const label = allLabels[this._labelsIndex++];

    if (label.scale() > this.worldLabels().scaleMultiplier() / scale) {
      return true;
    }

    ctx.font = `${Math.round(
      label.fontSize() / scale
    )}px ${this.worldLabels().font()}`;

    const shouldDraw = () => {
      if (label.knownSize()) {
        return occluder.occlude(label.x(), label.y(), label.measuredWidth()/scale, label.measuredHeight()/scale);
      }
      const metrics = ctx.measureText(label.text());
      const height =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      const width = metrics.width;
      label.setMeasuredSize(width * scale, height * scale);
      return occluder.occlude(label.x(), label.y(), width, height);
    }

    if (shouldDraw()) {
      this._drawnLabels.push(label);
    } else {
    }

    return true;
  }

  renderLabels() {
    const ctx = this._ctx;
    const scale = this._worldScale;
    this._drawnLabels.forEach((label) => {
      const overlay = ctx;
      overlay.font = `${Math.round(label.fontSize() / scale)}px ${this.worldLabels().font()}`;
      overlay.strokeStyle = label.strokeColor()
        ? label.strokeColor().asRGB()
        : label.color().luminance() < 0.1
        ? "white"
        : "black";
      overlay.miterLimit = this.worldLabels().lineWidth();
      overlay.lineWidth = this.worldLabels().lineWidth() / scale;
      overlay.lineCap = "round";
      overlay.textAlign = "center";
      overlay.textBaseline = "middle";
      ctx.strokeText(label.text(), label.x(), label.y());
      ctx.fillStyle = label.color().asRGB();
      ctx.fillText(label.text(), label.x(), label.y());
    });
    return false;
  }
}

export class WorldLabels {
  constructor(scaleMultiplier) {
    this.clear();
    this._lineWidth = 2;
    this._scaleMultiplier = scaleMultiplier;
    this._font = "sans-serif";
  }

  scaleMultiplier() {
    return this._scaleMultiplier;
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
    this._labels.push(new WorldLabel(text, x, y, size, scale, color, strokeColor));
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

  labels() {
    return this._labels;
  }

  render(ctx, worldX, worldY, worldWidth, worldHeight, worldScale) {
    return new WorldLabelRendering(this, ctx, worldX, worldY, worldWidth, worldHeight, worldScale);
  }
}