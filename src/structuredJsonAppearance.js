import { documentState } from "./graphDocument";
import { isJsonSlotNode } from "./structuredJson";

function appearance(backgroundColor, borderColor, textColor) {
  return Object.freeze({
    backgroundColor,
    backgroundAlpha: 1,
    borderColor,
    borderAlpha: 1,
    textColor,
    textAlpha: 1,
    lineColor: borderColor,
    lineAlpha: 1,
  });
}

// Shared by the graph, its temporary text editor, and the type-choice buttons.
// Labels and border shapes still carry meaning when colors are indistinguishable.
const PALETTE = Object.freeze({
  object: appearance("#e5edf5", "#6b86a0", "#253d55"),
  array: appearance("#eee8f3", "#9580a9", "#493756"),
  string: appearance("#e5eee5", "#76927b", "#304b36"),
  number: appearance("#e0edef", "#6e959b", "#2d4e55"),
  boolean: appearance("#f1e5eb", "#a28190", "#593849"),
  null: appearance("#e9ecef", "#8c969f", "#46515b"),
  key: appearance("#eeeae1", "#a0957b", "#544a35"),
  slot: appearance("#fff1d6", "#b28a43", "#6b4c1c"),
});

export function jsonKindAppearance(kind) {
  return Object.prototype.hasOwnProperty.call(PALETTE, kind)
    ? PALETTE[kind]
    : undefined;
}

/** Constant-time lookup: ordinary graphs and organizing buds have no type color. */
export function jsonNodeKind(root, node) {
  const metadata = documentState(root)?.metadata?.freeform?.structuredJson;
  if (metadata?.version !== 1 || !node || !metadata.nodes) return undefined;
  const id = node.id();
  if (!Object.prototype.hasOwnProperty.call(metadata.nodes, id))
    return undefined;
  const kind = metadata.nodes[id]?.kind;
  return jsonKindAppearance(kind) ? kind : undefined;
}

export function jsonNodeAppearance(root, node) {
  const kind = jsonNodeKind(root, node);
  if (!kind) return undefined;
  return jsonKindAppearance(isJsonSlotNode(root, node) ? "slot" : kind);
}

export function jsonKindCssVariables(kind) {
  const colors = jsonKindAppearance(kind);
  return colors
    ? {
        "--json-type-background": colors.backgroundColor,
        "--json-type-border": colors.borderColor,
        "--json-type-text": colors.textColor,
      }
    : undefined;
}
