import Color from "parsegraph-color";

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

export class WorldLabels {
  constructor(scaleMultiplier) {
    this.clear();
    this._lineWidth = 2;
    this._scaleMultiplier = scaleMultiplier;
    this._font = "sans-serif";

    this._worker = new Worker("occluder.js");
    this._worker.onmessage = (e) => {
      if (typeof e.data === "number") {
        return;
      }
      if (e.data.key !== this._workerKey) {
        return;
      }
      if (this._workerCallback) {
        this._workerCallback(e.data.labels);
      }
    };
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
    this._workerKey = null;
    this._workerCallback = null;
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

  prepareRender(ctx, worldX, worldY, worldWidth, worldHeight, worldScale, onFinish) {
    let curFontSize = NaN;

    const filteredLabels = this.labels().filter(label => {
        if (label.scale() > this.scaleMultiplier() / worldScale) {
            return false;
        }
        if (label.knownSize()) {
          return true;
        }
        if (label.fontSize() !== curFontSize) {
            ctx.font = `${Math.round(label.fontSize() / worldScale)}px ${this.font()}`;
            curFontSize = label.fontSize();
        }
        const metrics = ctx.measureText(label.text());
        const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        const width = metrics.width;
        label.setMeasuredSize(width, height);
        return true;
    });

    this._workerKey = Math.random() + "-" + Date.now();
    this._workerCallback = (data) => {
      this._drawnLabels = data.map(index => filteredLabels[index]);
      onFinish();
    };

    this._worker.postMessage([
      worldX,
      worldY,
      worldWidth,
      worldHeight,
      worldScale,
      filteredLabels.map(label => {
        return {
          scale: label.scale(),
          fontSize: label.fontSize(),
          text: label.text(),
          x: label.x(),
          y: label.y(),
          width: label.measuredWidth(),
          height: label.measuredHeight()
        };
      }),
      this._workerKey
    ]);

    return () => {

    };
  }

  render(ctx, bg) {
    if (this._drawnLabels == null) {
      return;
    }
    const scale = this._worldScale;
    this._drawnLabels.forEach((label) => {
      const overlay = ctx;
      overlay.font = `${Math.round(label.fontSize() / scale)}px ${this.font()}`;

      const lumLimit = 0.2
      overlay.strokeStyle = bg.luminance() > lumLimit ? "white" : "black";
      overlay.miterLimit = this.lineWidth();
      overlay.lineWidth = this.lineWidth() / scale;
      overlay.lineCap = "round";
      overlay.textAlign = "center";
      overlay.textBaseline = "middle";
      ctx.strokeText(label.text(), label.x(), label.y());
      ctx.fillStyle = bg.luminance() > lumLimit ? "black" : "white";
      ctx.fillText(label.text(), label.x(), label.y());
    });
  }
}