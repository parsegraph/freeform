import { Alignment, Direction } from "parsegraph";
import { BORDER_THICKNESS, LINE_HEIGHT } from "./settings";

export default function paintNodeText(node, cb)
{
  const hasInward = node.neighbors().hasNode(Direction.INWARD);
  let worldX = node.layout().absoluteX();
  let worldY = node.layout().absoluteY();
  const worldScale = node.layout().absoluteScale();
  
  const lines = node.value().toString().split(/\n/g);

  const nodeSize = [0, 0];
  node.layout().size(nodeSize);

  let textAlign = "center";
  let textBaseline = "middle";
  if (hasInward) {
    const inwardVertical = node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL;
    if (inwardVertical) {
      textAlign = "center";
      textBaseline = "top";
      worldY -= (worldScale * nodeSize[1]) / 2 + BORDER_THICKNESS * 3;
    } else {
      textAlign = "left";
      textBaseline = "middle";
      worldX -= (worldScale * nodeSize[0]) / 2 + 3 * BORDER_THICKNESS;
      if (lines.length > 1) {
        worldY -= (-(lines.length - 1) * (worldScale * LINE_HEIGHT)) / 2;
      }
    }
} else {
    textAlign = "center";
    textBaseline = "middle";
    if (lines.length > 1) {
      worldY -= (-(lines.length - 1) * (worldScale * LINE_HEIGHT)) / 2
    }
}
lines.forEach((line) => {
    cb(line, worldX, worldY, textAlign, textBaseline);
    worldY += LINE_HEIGHT;
});
}