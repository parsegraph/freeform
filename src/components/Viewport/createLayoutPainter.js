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
  FONT_UPSCALE,
  INWARD_SEPARATION,
  LINE_HEIGHT,
  LINE_THICKNESS,
  nodeHasValue,
} from "../../settings";
import { WebGLBlockPainter } from "parsegraph-blockpainter";
import Color from "parsegraph-color";
import SpotlightPainter from "parsegraph-spotlightpainter";
import Rect from "parsegraph-rect";
import { Font, Label, GlyphPainter, GL_TEXTURE_SIZE } from 'parsegraph-glyphpainter';

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
  if (!painters.has(pg)) {
    painters.set(pg, {});
  }
  let painterData = painters.get(pg);
  let { painter, spotlightPainter, glyphPainter } = painterData;
  if (!painter || painter.glProvider() !== glProvider) {
    painter = new WebGLBlockPainter(glProvider);
    painterData.painter = painter;
  } else {
    painter.clear();
  }
  if (!spotlightPainter || spotlightPainter._window !== glProvider) {
    spotlightPainter = new SpotlightPainter(glProvider);
    painterData.spotlightPainter = spotlightPainter;
  } else {
    spotlightPainter.clear();
  }
  if (!glyphPainter || glyphPainter._window !== glProvider) {
    glyphPainter = new GlyphPainter(glProvider, new Font(FONT_UPSCALE * FONT_SIZE, "sans-serif", "normal"));
    painterData.glyphPainter = glyphPainter;
  } else {
    glyphPainter.clear();
  }

  const b = new Rect();

  let numBlocks = 0;
  const glyphCounts = {};
  const label = new Label(glyphPainter.font());
  pg.siblings().forEach((node) => {
    paintNodeLines(node, BORDER_THICKNESS, () => {
      ++numBlocks;
    });
    paintNodeBounds(node, () => {
      ++numBlocks;
      if (nodeHasValue(node)) {
        label.setText("" + node.value());
        label.glyphCount(glyphCounts, Math.pow(GL_TEXTURE_SIZE / glyphPainter.font().pageTextureSize(), 2));
      }
    });
  });

  painter.initBuffer(numBlocks);
  glyphPainter.initBuffer(glyphCounts);

  pg.siblings().forEach((node) => {
    const style = getNodeStyle(node);

    paintNodeLines(node, LINE_THICKNESS / 2, (x, y, w, h) => {
      b.include(x, y, w, h);
      painter.setBorderColor(
        Color.fromHex(style.lineColor).setA(style.lineAlpha)
      );
      painter.setBackgroundColor(
        Color.fromHex(style.lineColor).setA(style.lineAlpha)
      );
      painter.drawBlock(x, y, w, h, 0, 0);
    });
    paintNodeBounds(node, (x, y, w, h) => {
      b.include(x, y, w, h);
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
        if (nodeHasValue(node)) {
          label.setText("" + node.value());
          let maxAscent = 0;
          const scale = node.layout().groupScale();
          let maxDescent = scale*12;
          label.lineAt(0).glyphs().forEach(({ascent, descent}) => {
            maxAscent = Math.max(ascent, maxAscent);
            maxDescent = Math.max(descent, maxDescent);
          });
          glyphPainter.setColor(Color.fromHex(style.textColor).setA(style.textAlpha));
          if (!node.neighbors().hasNode(Direction.INWARD)) {
            label.paint(
              x - (scale/FONT_UPSCALE)*label.width()/2,
              y - (scale/FONT_UPSCALE)*label.height()/2,
              scale/FONT_UPSCALE,
              (glyph, x, y, scale) => {
                glyphPainter.drawGlyph(glyph, x, y, scale);
            });
          } else if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
            label.paint(
              x - (scale/FONT_UPSCALE)*label.width()/2,
              y - h/2 + scale*INWARD_SEPARATION/4,
              scale/FONT_UPSCALE,
              (glyph, x, y, scale) => {
                glyphPainter.drawGlyph(glyph, x, y, scale);
            });
          } else {
            label.paint(
              x - w/2 + scale*INWARD_SEPARATION/4,
              y - (scale/FONT_UPSCALE)*label.height()/2,
              scale/FONT_UPSCALE,
              (glyph, x, y, scale) => {
                glyphPainter.drawGlyph(glyph, x, y, scale);
            });
          }
        }
      } else {
        painter.drawBlock(x, y, w, h, w, BORDER_THICKNESS * scale);
      }
      const radius = (w + h) / 2 / 2;
      spotlightPainter.drawSpotlight(x, y, 5*radius, painter.backgroundColor());
    });
  });

  if (bounds) {
    bounds.set(pg, {dirty: false, bounds: b});
  }
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
