import { Alignment, Axis, Direction } from "parsegraph";
import {
  BORDER_THICKNESS,
  BUD_SIZE,
  FONT_SIZE,
  INWARD_SEPARATION,
  LINE_HEIGHT,
  NODE_SEPARATION,
  nodeHasValue,
} from "./settings";

// Shared geometry for the interactive viewport and offline template previews.
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
  return NODE_SEPARATION;
};

export function createLegacyLayout(ctx) {
  return { size: (node, size) => getNodeSize(node, size, ctx), getSeparation };
}
