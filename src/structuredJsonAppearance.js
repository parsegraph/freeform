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
  object: appearance("#c8def5", "#37648a", "#102f49"),
  array: appearance("#ddcff4", "#75549e", "#3b2359"),
  string: appearance("#c8e8ce", "#40734c", "#193e24"),
  number: appearance("#bde5e8", "#36747b", "#123a40"),
  boolean: appearance("#f2cad7", "#97516d", "#59243a"),
  null: appearance("#d6dce5", "#647184", "#303c4c"),
  key: appearance("#e9dfc5", "#8b7850", "#493c21"),
  slot: appearance("#ffe3b3", "#9e5e14", "#412800"),
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
