import Color from "parsegraph-color";

// These are screen-space accents, not font glyphs stretched to fit the box.
// In particular, a tall object never acquires a very wide brace.
export const JSON_BORDER_DEPTH = 8;
export const JSON_BORDER_LINE_WIDTH = 1.5;

export function jsonBorderGeometry(node, camera) {
  const layout = node.layout();
  const size = [0, 0];
  layout.size(size);
  const scale = layout.absoluteScale() * camera.scale();
  const width = size[0] * scale;
  const height = size[1] * scale;
  const x = (layout.absoluteX() + camera.x()) * camera.scale();
  const y = (layout.absoluteY() + camera.y()) * camera.scale();
  if (![width, height, x, y].every(Number.isFinite) || width < 12 || height < 12) return null;
  const inset = JSON_BORDER_LINE_WIDTH;
  return {
    left: x - width / 2 + inset,
    right: x + width / 2 - inset,
    top: y - height / 2 + inset,
    bottom: y + height / 2 - inset,
    depth: Math.min(JSON_BORDER_DEPTH, width / 6, height / 6),
    bend: Math.min(JSON_BORDER_DEPTH, height / 6),
  };
}

function side(ctx, geometry, kind, right) {
  const { left, top, bottom, depth, bend } = geometry;
  const edge = right ? geometry.right : left;
  const direction = right ? -1 : 1;
  const inner = edge + direction * depth;
  const stem = edge + direction * depth / 2;
  const middle = (top + bottom) / 2;
  ctx.moveTo(inner, top);
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

/** Draw during the immutable frame's text pass, never into the live overlay. */
export function drawJsonNodeBorder(ctx, node, camera, kind, style) {
  if (!["object", "array", "boolean"].includes(kind)) return false;
  const geometry = jsonBorderGeometry(node, camera);
  if (!geometry) return false;
  ctx.save();
  ctx.resetTransform();
  ctx.strokeStyle = Color.fromHex(style.borderColor).setA(style.borderAlpha).asRGBA();
  ctx.lineWidth = JSON_BORDER_LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  side(ctx, geometry, kind, false);
  side(ctx, geometry, kind, true);
  ctx.stroke();
  ctx.restore();
  return true;
}
