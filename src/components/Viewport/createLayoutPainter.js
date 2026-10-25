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
  FONT_UPSCALE,
  INWARD_SEPARATION,
  LINE_THICKNESS,
  nodeHasValue,
} from "../../settings";
import { WebGLBlockPainter } from "parsegraph-blockpainter";
import TypedBlockPainter from "./TypedBlockPainter";
import Color from "parsegraph-color";
import SpotlightPainter from "parsegraph-spotlightpainter";
import Rect from "parsegraph-rect";
import { Label, GlyphPainter, GL_TEXTURE_SIZE } from 'parsegraph-glyphpainter';
import { createDocumentLayout } from "../../graphPresentation";
import { createLegacyLayout } from "../../graphLayout";
import { presentationStyle } from "../../graphDocument";
import { hasJsonNodeBorder, JSON_BORDER_PADDING } from "../../structuredJsonBorders";
import { measureBenchmark } from "../../benchmark";
import { recordInteractionGroup } from "../../interactionBenchmark";

const paint = (pg, painters, bounds, glProvider, getNodeStyle, presentation, glyphFont, getNodeShape) => {
  if (!painters.has(pg)) {
    painters.set(pg, {});
  }
  let painterData = painters.get(pg);
  let { painter, spotlightPainter, glyphPainter } = painterData;
  const Painter = getNodeShape ? TypedBlockPainter : WebGLBlockPainter;
  if (!painter || painter.glProvider() !== glProvider || painterData.painterType !== Painter) {
    painter?.clear();
    painter = new Painter(glProvider);
    painterData.painter = painter;
    painterData.painterType = Painter;
  } else {
    painter.clear();
  }
  painterData.typedShapes = !!getNodeShape;
  if (!spotlightPainter || spotlightPainter._window !== glProvider) {
    spotlightPainter = new SpotlightPainter(glProvider);
    painterData.spotlightPainter = spotlightPainter;
  } else {
    spotlightPainter.clear();
  }
  if (!glyphPainter || glyphPainter._window !== glProvider || glyphPainter.font() !== glyphFont) {
    glyphPainter = new GlyphPainter(glProvider, glyphFont);
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
      if (!presentation && nodeHasValue(node) && node.value() !== "") {
        label.setText("" + node.value());
        label.glyphCount(glyphCounts, Math.pow(GL_TEXTURE_SIZE / glyphPainter.font().pageTextureSize(), 2));
      }
    });
  });

  painter.initBuffer(numBlocks);
  glyphPainter.initBuffer(glyphCounts);

  pg.siblings().forEach((node) => {
    const style = getNodeStyle(node);
    const kind = getNodeShape?.(node);
    const sidePadding = hasJsonNodeBorder(kind) ? JSON_BORDER_PADDING : 0;

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
      const background = Color.fromHex(style.backgroundColor).setA(style.backgroundAlpha);
      painter.setBackgroundColor(background);
      painter.setBorderColor(
        Color.fromHex(style.borderColor).setA(style.borderAlpha)
      );
      const scale = node.layout().groupScale();
      if (presentation || nodeHasValue(node) || node.neighbors().hasNode(Direction.INWARD)) {
        painter.drawBlock(
          x,
          y,
          w,
          h,
          Math.min(BORDER_ROUNDEDNESS * scale, w / 2, h / 2),
          Math.min(BORDER_THICKNESS * scale, w / 2, h / 2),
          kind,
          scale
        );
        if (!presentation && nodeHasValue(node) && node.value() !== "") {
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
              x - w/2 + scale*(INWARD_SEPARATION/4 + sidePadding),
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
  getNodeStyle,
  presentation,
  benchmark,
  glyphFont,
  getNodeShape
) => {
  if (!getNodeStyle) {
    throw new Error("getNodeStyle is not defined");
  }
  if (!ctx) {
    throw new Error("ctx is not defined");
  }
  const geometry = presentation
    ? createDocumentLayout(presentation, ctx)
    : createLegacyLayout(ctx);
  const shaped = (node) => hasJsonNodeBorder(getNodeShape?.(node));
  const square = (node) => presentation && presentationStyle(presentation, node).square;
  const paddedGeometry = !getNodeShape ? geometry : {
    ...geometry,
    size: (node, size) => {
      geometry.size(node, size);
      if (!shaped(node)) return;
      size[0] += 2 * JSON_BORDER_PADDING;
      if (square(node)) size[1] += 2 * JSON_BORDER_PADDING;
    },
    getSeparation: (node, axis, ...args) => {
      const separation = geometry.getSeparation(node, axis, ...args);
      if (axis !== Axis.Z || !shaped(node)) return separation;
      const vertical = node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL;
      return separation + (!vertical || square(node) ? 2 * JSON_BORDER_PADDING : 0);
    },
  };
  const painter = {
    ...paddedGeometry,
    paint: (pg) => recordInteractionGroup(pg, "repaint", () =>
      paint(pg, painters, bounds, glProvider, getNodeStyle, presentation, glyphFont, getNodeShape)
    ),
  };
  if (!benchmark) return painter;
  return {
    size: (...args) =>
      measureBenchmark(benchmark, "Node sizing", () => painter.size(...args)),
    getSeparation: (...args) =>
      measureBenchmark(benchmark, "Node separation", () =>
        painter.getSeparation(...args)
      ),
    paint: (...args) =>
      measureBenchmark(benchmark, "Paint preparation", () =>
        painter.paint(...args)
      ),
  };
};

export { createLayoutPainter };
