import Color from "parsegraph-color";

// These are screen-space outlines, not font glyphs stretched to fit the box.
// In particular, a tall object never acquires a very wide brace.
export const JSON_BORDER_DEPTH = 32;
export const JSON_BORDER_BEND = 8;
// World-space clearance protects labels/children when zoomed out, where a
// fixed screen-space border could otherwise consume their entire background.
export const JSON_BORDER_PADDING = 8;
export const JSON_BORDER_LINE_WIDTH = 1.5;

export function hasJsonNodeBorder(kind) {
  return kind === "object" || kind === "array" || kind === "boolean";
}

export function jsonBorderGeometry(node, camera) {
  const layout = node.layout();
  const size = [0, 0];
  layout.size(size);
  const scale = layout.absoluteScale() * camera.scale();
  const width = size[0] * scale;
  const height = size[1] * scale;
  const x = (layout.absoluteX() + camera.x()) * camera.scale();
  const y = (layout.absoluteY() + camera.y()) * camera.scale();
  if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  // This is the node's only outline, so keep it at small zoom levels too.
  const lineWidth = Math.min(JSON_BORDER_LINE_WIDTH, width / 8, height / 8);
  const inset = lineWidth / 2;
  return {
    left: x - width / 2 + inset,
    right: x + width / 2 - inset,
    top: y - height / 2 + inset,
    bottom: y + height / 2 - inset,
    depth: Math.min(JSON_BORDER_DEPTH, width / 3, height * 2 / 3, JSON_BORDER_PADDING * scale),
    bend: Math.min(JSON_BORDER_BEND, height / 6),
    lineWidth,
  };
}

function side(ctx, geometry, kind, right, reverse = false) {
  const { left, depth } = geometry;
  const top = reverse ? geometry.bottom : geometry.top;
  const bottom = reverse ? geometry.top : geometry.bottom;
  const bend = geometry.bend * (reverse ? -1 : 1);
  const edge = right ? geometry.right : left;
  const direction = right ? -1 : 1;
  const inner = edge + direction * depth;
  const stem = edge + direction * depth / 2;
  const middle = (top + bottom) / 2;
  if (kind === "object") {
    ctx.quadraticCurveTo(stem, top, stem, top + bend);
    ctx.lineTo(stem, middle - bend);
    ctx.quadraticCurveTo(stem, middle, edge, middle);
    ctx.quadraticCurveTo(stem, middle, stem, middle + bend);
    ctx.lineTo(stem, bottom - bend);
    ctx.quadraticCurveTo(stem, bottom, inner, bottom);
  } else if (kind === "array") {
    ctx.lineTo(edge, top);
    ctx.lineTo(edge, bottom);
    ctx.lineTo(inner, bottom);
  } else {
    ctx.lineTo(edge, middle);
    ctx.lineTo(inner, bottom);
  }
}

// Share the contour with the selection overlay without sharing stroke width:
// document borders can shrink, but the editor's selection must stay legible.
export function traceJsonNodeBorder(ctx, geometry, kind) {
  ctx.beginPath();
  ctx.moveTo(geometry.left + geometry.depth, geometry.top);
  side(ctx, geometry, kind, false);
  ctx.lineTo(geometry.right - geometry.depth, geometry.bottom);
  side(ctx, geometry, kind, true, true);
  ctx.closePath();
}

/** Live selection/hover use the same contour as the GPU fill and outline. */
export function drawJsonNodeBorder(ctx, node, camera, kind, style) {
  if (!hasJsonNodeBorder(kind)) return false;
  const geometry = jsonBorderGeometry(node, camera);
  if (!geometry) return false;
  ctx.save();
  ctx.resetTransform();
  ctx.strokeStyle = Color.fromHex(style.borderColor).setA(style.borderAlpha).asRGBA();
  ctx.lineWidth = geometry.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  traceJsonNodeBorder(ctx, geometry, kind);
  ctx.stroke();
  ctx.restore();
  return true;
}
