let ctx;

onmessage = (e) => {
    switch(e.data.event) {
    case "init":
        init(e.data);
        break;
    case "text":
        text(e.data)
        break;
    case "render":
        render(e.data);
        break;
    }
};

function init({width, height}) {
    const canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext("2d");
}

function text({x, y, text, font, fillStyle}) {
    if (!ctx) {
        throw new Error("Not initialized");
    }
    ctx.font = font;
    ctx.fillStyle = fillStyle;
    ctx.fillText(text, x, y);
}

function render() {
    if (!canvas) {
        throw new Error("Not initialized");
    }
    postMessage(ctx.transferToImageBitmap());
}

/*function renderText()
{
    const pg = paintGroup;
    const ctx = this.ctx();

    if (pg.layout().needsCommit() || pg.layout().needsAbsolutePos()) {
      pg.neighbors().root().invalidate();
      return true;
    }

    let bounds = this._bounds.get(pg).bounds;
    if (bounds.isNaN()) {
      throw new Error("bounds must not be NaN");
    }

    const b = bounds.clone();
    b.scale(pg.scale());
    b.translate(pg.layout().absoluteX(), pg.layout().absoluteY());

    const cam = this.camera();
    if (!cam.containsAny(b)) {
      return false;
    }

    ctx.save();
    ctx.translate(pg.layout().absoluteX(), pg.layout().absoluteY());
    ctx.scale(pg.layout().absoluteScale(), pg.layout().absoluteScale());
    // eslint-disable-next-line no-loop-func
    let dirty = false;
    pg.siblings().forEach((node) => {
      if (node.layout().needsAbsolutePos()) {
        dirty = true;
        return;
      }
      if (!nodeHasValue(node)) {
        return;
      }
      const lines = node.value().toString().split("\n");
      if (node.layout().absoluteScale() * cam.scale() < TEXT_IS_VISIBLE_SCALE) {
        return;
      }
      ++renderData.j;
      ctx.fillStyle = borderColor.asRGBA();
      ctx.save();
      if (node.neighbors().hasNode(Direction.INWARD)) {
        const nodeSize = [0, 0];
        node.layout().size(nodeSize);
        const scale = node.layout().groupScale();
        if (
          node.neighbors().getAlignment(Direction.INWARD) ===
          Alignment.INWARD_VERTICAL
        ) {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.translate(
            node.layout().groupX(),
            node.layout().groupY() - (scale * nodeSize[1]) / 2 + BORDER_THICKNESS * 3
          );
        } else {
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.translate(
            node.layout().groupX() -
              (scale * nodeSize[0]) / 2 +
              3 * BORDER_THICKNESS,
            node.layout().groupY()
          );
          if (lines.length > 1) {
            ctx.translate(
              0,
              (-(lines.length - 1) * (scale * LINE_HEIGHT)) / 2
            );
          }
        }
      } else {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.translate(node.layout().groupX(), node.layout().groupY());
        if (lines.length > 1) {
          ctx.translate(
            0,
            (-(lines.length - 1) * (node.layout().groupScale() * LINE_HEIGHT)) /
              2
          );
        }
      }
      ctx.font = `${FONT_SIZE}px sans-serif`;
      const style = this.viewport().getNodeStyle(node);
      ctx.scale(node.layout().groupScale(), node.layout().groupScale());
      ctx.fillStyle = Color.fromHex(style.textColor)
        .setA(style.textAlpha)
        .asRGBA();
      lines.forEach((line) => {
        ctx.fillText(line, 0, 0);
        ctx.translate(0, LINE_HEIGHT);
      });
      ctx.restore();
    });
    ctx.restore();

    return dirty;
  }*/
