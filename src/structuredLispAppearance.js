import { documentState } from "./graphDocument";
import { isLispSlotNode } from "./structuredLisp";

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

const prefix = appearance("#f3e9df", "#ab8970", "#63452e");
const comment = appearance("#e9ede8", "#8c9988", "#4a5646");
const PALETTE = Object.freeze({
  document: appearance("#e9ecef", "#8c969f", "#46515b"),
  list: appearance("#e5edf5", "#6b86a0", "#253d55"),
  vector: appearance("#eee8f3", "#9580a9", "#493756"),
  bytevector: appearance("#e4ecef", "#7f919e", "#334d5c"),
  symbol: appearance("#eeeae1", "#a0957b", "#544a35"),
  string: appearance("#e5eee5", "#76927b", "#304b36"),
  number: appearance("#e0edef", "#6e959b", "#2d4e55"),
  boolean: appearance("#f1e5eb", "#a28190", "#593849"),
  character: appearance("#f1efdf", "#a29b72", "#57522d"),
  quote: prefix,
  quasiquote: prefix,
  unquote: prefix,
  "unquote-splicing": prefix,
  "dotted-tail": prefix,
  "datum-comment": comment,
  comment,
  "block-comment": comment,
  slot: appearance("#fff1d6", "#b28a43", "#6b4c1c"),
});

export function lispKindAppearance(kind) {
  return Object.prototype.hasOwnProperty.call(PALETTE, kind)
    ? PALETTE[kind]
    : undefined;
}

/** Metadata lookup only: organizing buds and ordinary graphs remain uncolored. */
export function lispNodeKind(root, node) {
  const metadata = documentState(root)?.metadata?.freeform?.structuredLisp;
  if (metadata?.version !== 1 || !node || !metadata.nodes) return undefined;
  if (!Object.prototype.hasOwnProperty.call(metadata.nodes, node.id()))
    return undefined;
  const kind = metadata.nodes[node.id()]?.kind;
  return lispKindAppearance(kind) ? kind : undefined;
}

export function lispNodeAppearance(root, node) {
  const kind = lispNodeKind(root, node);
  if (!kind) return undefined;
  return lispKindAppearance(isLispSlotNode(root, node) ? "slot" : kind);
}

// The inspector shares the established structured-editor controls and styles.
export function lispKindCssVariables(kind) {
  const colors = lispKindAppearance(kind);
  return colors
    ? {
        "--json-type-background": colors.backgroundColor,
        "--json-type-border": colors.borderColor,
        "--json-type-text": colors.textColor,
      }
    : undefined;
}
