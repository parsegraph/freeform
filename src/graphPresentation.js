import {
  createPresentationPainter,
  createTextMeasurer,
  Alignment,
  Direction,
} from "parsegraph";
import Color from "parsegraph-color";
import { nodeLabel, presentationStyle } from "./graphDocument";

export const presentationFont = (text) =>
  `normal ${text.fontSize}px ${text.fontFamily}`;

export function createDocumentLayout(presentation, ctx) {
  const measure = createTextMeasurer((line, text) => {
    ctx.save();
    ctx.resetTransform();
    ctx.font = presentationFont(text);
    const width = ctx.measureText(line).width;
    ctx.restore();
    return width;
  });
  return createPresentationPainter(presentation, (value, text) =>
    typeof value === "string" || typeof value === "number"
      ? measure(value, text)
      : [0, 0]
  );
}

export function drawDocumentLabel(ctx, node, camera, presentation, appearance) {
  const label = nodeLabel(node, presentation);
  if (label === null) return;
  const layout = node.layout();
  const size = [0, 0];
  layout.size(size);
  const style = presentationStyle(presentation, node);
  const lines = label.split("\n");
  const lineHeight = presentation.text.lineHeight;
  let x = 0;
  let y = (-lines.length * lineHeight) / 2 + lineHeight / 2;
  let align = "center";
  if (node.neighbors().hasNode(Direction.INWARD)) {
    if (
      node.neighbors().getAlignment(Direction.INWARD) ===
      Alignment.INWARD_VERTICAL
    ) {
      y = -size[1] / 2 + style.paddingY + lineHeight / 2;
    } else {
      x = -size[0] / 2 + style.paddingX;
      align = "left";
    }
  }
  ctx.save();
  ctx.resetTransform();
  ctx.scale(camera.scale(), camera.scale());
  ctx.translate(camera.x(), camera.y());
  ctx.translate(layout.absoluteX(), layout.absoluteY());
  ctx.scale(layout.absoluteScale(), layout.absoluteScale());
  ctx.font = presentationFont(presentation.text);
  ctx.fillStyle = Color.fromHex(appearance.textColor)
    .setA(appearance.textAlpha)
    .asRGBA();
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  ctx.restore();
}
