import {
  Alignment,
  Axis,
  Direction,
  paintNodeBounds,
  paintNodeLines,
} from "parsegraph";
import {
  BORDER_ROUNDEDNESS,
  BORDER_THICKNESS,
  BUD_SIZE,
  FONT_SIZE,
  INWARD_SEPARATION,
  LINE_HEIGHT,
  LINE_THICKNESS,
  nodeHasValue,
} from "../../settings";
import { WebGLBlockPainter } from "parsegraph-blockpainter";
import Color from "parsegraph-color";

const getNodeSize = (node, size, ctx) => {
  size[0] = FONT_SIZE;
  if (nodeHasValue(node)) {
    size[1] = 0;
    node
      .value()
      .toString()
      .split("\n")
      .forEach((line) => {
        size[1] += LINE_HEIGHT;
        ctx.resetTransform();
        ctx.font = `${FONT_SIZE}px sans-serif`;
        const { width } = ctx.measureText(line);
        size[0] = Math.max(size[0], width + 6 * BORDER_THICKNESS);
      });
    size[1] = Math.max(size[1], LINE_HEIGHT);
    size[1] += LINE_HEIGHT / 2;
  } else {
    size[0] = FONT_SIZE * BUD_SIZE;
    size[1] = FONT_SIZE * BUD_SIZE;
  }

  if (node.neighbors().hasNode(Direction.INWARD)) {
    const child = node.neighbors().nodeAt(Direction.INWARD);
    const childSize = [0, 0];
    child.layout().extentSize(childSize);

    if (
      node.neighbors().getAlignment(Direction.INWARD) ===
      Alignment.INWARD_VERTICAL
    ) {
      if (!nodeHasValue(node)) {
        size[0] = 4 * BORDER_THICKNESS;
        size[1] = 4 * BORDER_THICKNESS;
      }
      // Vertically aligned inward node.
      size[0] = Math.max(
        size[0],
        2 * BORDER_THICKNESS + child.scale() * childSize[0]
      );
      size[0] += LINE_HEIGHT / 8;
      size[1] += (INWARD_SEPARATION / 2 + childSize[1]) * child.scale();
    } else {
      if (!nodeHasValue(node)) {
        size[0] = BORDER_THICKNESS;
        size[1] = BORDER_THICKNESS;
      }
      // Default is horizontal
      size[0] += (INWARD_SEPARATION / 2 + childSize[0]) * child.scale();
      size[1] = Math.max(
        size[1],
        BORDER_THICKNESS + child.scale() * childSize[1]
      );
      size[1] += LINE_HEIGHT / 4;
    }
  }
};

const getSeparation = (node, axis) => {
  if (axis === Axis.Z) {
    return INWARD_SEPARATION / 2;
  }
  return FONT_SIZE / 2;
};

const paint = (pg, painters, bounds, glProvider, getNodeStyle) => {
  let painter = painters.get(pg);
  if (!painter || painter.glProvider() !== glProvider) {
    painter = new WebGLBlockPainter(glProvider);
    painters.set(pg, painter);
  } else {
    painter.clear();
  }

  if (bounds && bounds.has(pg)) {
    bounds.get(pg).dirty = true;
  }

  let numBlocks = 0;
  pg.siblings().forEach((node) => {
    paintNodeLines(node, BORDER_THICKNESS, () => {
      ++numBlocks;
    });
    paintNodeBounds(node, () => {
      ++numBlocks;
    });
  });

  painter.initBuffer(numBlocks);

  pg.siblings().forEach((node) => {
    const style = getNodeStyle(node);
    paintNodeLines(node, LINE_THICKNESS / 2, (x, y, w, h) => {
      painter.setBorderColor(
        Color.fromHex(style.lineColor).setA(style.lineAlpha)
      );
      painter.setBackgroundColor(
        Color.fromHex(style.lineColor).setA(style.lineAlpha)
      );
      painter.drawBlock(x, y, w, h, 0, 0);
    });
    paintNodeBounds(node, (x, y, w, h) => {
      painter.setBackgroundColor(
        Color.fromHex(style.backgroundColor).setA(style.backgroundAlpha)
      );
      painter.setBorderColor(
        Color.fromHex(style.borderColor).setA(style.borderAlpha)
      );
      const scale = node.layout().groupScale();
      if (nodeHasValue(node) || node.neighbors().hasNode(Direction.INWARD)) {
        painter.drawBlock(
          x,
          y,
          w,
          h,
          BORDER_ROUNDEDNESS * scale,
          BORDER_THICKNESS * scale
        );
      } else {
        painter.drawBlock(x, y, w, h, w, BORDER_THICKNESS * scale);
      }
    });
  });
};

const createLayoutPainter = (
  painters,
  bounds,
  glProvider,
  ctx,
  getNodeStyle
) => {
  if (!getNodeStyle) {
    throw new Error("getNodeStyle is not defined");
  }
  if (!ctx) {
    throw new Error("ctx is not defined");
  }
  return {
    size: (node, size) => getNodeSize(node, size, ctx),
    getSeparation,
    paint: (pg) => paint(pg, painters, bounds, glProvider, getNodeStyle),
  };
};

export { createLayoutPainter };
