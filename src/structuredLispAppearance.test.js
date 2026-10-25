import { DirectionNode } from "parsegraph";
import {
  documentState,
  graphNodes,
  readGraph,
  writeGraph,
} from "./graphDocument";
import {
  applyLispCommand,
  createLispDraft,
  createStructuredLisp,
} from "./structuredLisp";
import {
  lispKindAppearance,
  lispKindCssVariables,
  lispNodeAppearance,
  lispNodeKind,
} from "./structuredLispAppearance";

const luminance = (hex) => {
  const values = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};

test("Lisp kinds have readable colors shared by graph and inspector", () => {
  for (const kind of [
    "document",
    "list",
    "vector",
    "bytevector",
    "symbol",
    "string",
    "number",
    "boolean",
    "character",
    "quote",
    "quasiquote",
    "unquote",
    "unquote-splicing",
    "datum-comment",
    "dotted-tail",
    "comment",
    "block-comment",
    "slot",
  ]) {
    const colors = lispKindAppearance(kind);
    const [lighter, darker] = [
      luminance(colors.backgroundColor),
      luminance(colors.textColor),
    ].sort((a, b) => b - a);
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(colors.backgroundAlpha).toBe(1);
    expect(lispKindCssVariables(kind)).toEqual({
      "--json-type-background": colors.backgroundColor,
      "--json-type-border": colors.borderColor,
      "--json-type-text": colors.textColor,
    });
  }
});

test("native saves preserve every semantic color while multislot buds remain uncolored", () => {
  const source =
    '\'(a . b) `(,x ,@xs) #;(ignored) #u8(1) #("s" 2 #t #\\space) ;line\n#|block|#';
  const root = readGraph(writeGraph(createStructuredLisp(source)));
  const roles = documentState(root).metadata.freeform.structuredLisp.nodes;
  for (const node of graphNodes(root)) {
    const kind = roles[node.id()].kind;
    if (kind === "entry" || kind === "line") {
      expect(lispNodeKind(root, node)).toBeUndefined();
      expect(lispNodeAppearance(root, node)).toBeUndefined();
    } else {
      expect(lispNodeKind(root, node)).toBe(kind);
      expect(lispNodeAppearance(root, node)).toBe(lispKindAppearance(kind));
    }
  }
});

test("partial raw tokens use slot colors without losing their semantic kind", () => {
  const initial = createStructuredLisp('"complete"');
  const string = graphNodes(initial).find(
    (node) => node.value() === '"complete"'
  );
  const { root, selectedNode } = applyLispCommand(initial, string, {
    type: "setText",
    text: '"unfinished',
  });
  expect(lispNodeKind(root, selectedNode)).toBe("string");
  expect(lispNodeAppearance(root, selectedNode)).toBe(
    lispKindAppearance("slot")
  );
  const draft = createLispDraft();
  const slot = graphNodes(draft).find(
    (node) => lispNodeKind(draft, node) === "slot"
  );
  expect(lispNodeAppearance(draft, slot)).toBe(lispKindAppearance("slot"));
});

test("appearance lookup never walks the graph or infers a type from a label", () => {
  const root = createStructuredLisp('"()"');
  const string = graphNodes(root).find((node) => node.value() === '"()"');
  const traversal = jest.spyOn(root, "paintGroup").mockImplementation(() => {
    throw new Error("Unexpected graph walk");
  });
  expect(lispNodeAppearance(root, string)).toBe(lispKindAppearance("string"));
  expect(traversal).not.toHaveBeenCalled();
  traversal.mockRestore();
  const ordinary = new DirectionNode("()");
  expect(lispNodeAppearance(ordinary, ordinary)).toBeUndefined();
  expect(lispKindAppearance("__proto__")).toBeUndefined();
  expect(lispKindCssVariables("entry")).toBeUndefined();
});
