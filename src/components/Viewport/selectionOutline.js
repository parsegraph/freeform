import { Direction } from "parsegraph";
import { BORDER_ROUNDEDNESS, nodeHasValue } from "../../settings";
import {
  hasJsonNodeBorder,
  jsonBorderGeometry,
  traceJsonNodeBorder,
} from "../../structuredJsonBorders";

const GAP = 2;
const MIN_SIZE = 12;
const LINE_WIDTH = 2.5;
const HALO_WIDTH = 5.5;

// This belongs to the live overlay, not the graph's appearance or cached frame.
// All distances are CSS pixels so nested nodes and wide zooms retain a caret.
export function drawSelectionOutline(ctx, node, camera, kind) {
  if (!node) return false;
  const layout = node.layout();
  const size = [0, 0];
  layout.size(size);
  const scale = layout.absoluteScale() * camera.scale();
  const width = size[0] * scale;
  const height = size[1] * scale;
  const x = (layout.absoluteX() + camera.x()) * camera.scale();
  const y = (layout.absoluteY() + camera.y()) * camera.scale();
  if (
    ![x, y, width, height, scale].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    scale <= 0
  )
    return false;

  const tiny = width < MIN_SIZE || height < MIN_SIZE;
  const geometry =
    !tiny && hasJsonNodeBorder(kind) ? jsonBorderGeometry(node, camera) : null;
  ctx.save();
  ctx.resetTransform();
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (geometry) {
    traceJsonNodeBorder(
      ctx,
      {
        ...geometry,
        left: geometry.left - GAP,
        right: geometry.right + GAP,
        top: geometry.top - GAP,
        bottom: geometry.bottom + GAP,
      },
      kind
    );
  } else {
    ctx.beginPath();
    const bud =
      !nodeHasValue(node) && !node.neighbors().hasNode(Direction.INWARD);
    if (!tiny && bud) {
      ctx.arc(x, y, width / 2 + GAP, 0, Math.PI * 2);
    } else {
      const w = Math.max(MIN_SIZE, width) + 2 * GAP;
      const h = Math.max(MIN_SIZE, height) + 2 * GAP;
      const radius = tiny ? 3 : (BORDER_ROUNDEDNESS * scale) / 2.13 + GAP;
      ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(radius, w / 2, h / 2));
    }
  }
  // A light halo separates the dark outline from arbitrary document colors.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = HALO_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = "#245d50";
  ctx.lineWidth = LINE_WIDTH;
  ctx.stroke();
  ctx.restore();
  return true;
}
