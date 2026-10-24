import { DirectionNode } from "parsegraph";
import {
  documentState,
  graphNodes,
  readGraph,
  writeGraph,
} from "./graphDocument";
import {
  applyJsonCommand,
  createJsonDraft,
  createStructuredJson,
} from "./structuredJson";
import {
  jsonKindAppearance,
  jsonNodeAppearance,
  jsonNodeKind,
} from "./structuredJsonAppearance";

const luminance = (hex) => {
  const values = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};

test("every JSON type has a distinct fill and readable text", () => {
  const fills = new Set();
  for (const kind of [
    "object",
    "array",
    "string",
    "number",
    "boolean",
    "null",
    "key",
    "slot",
  ]) {
    const colors = jsonKindAppearance(kind);
    fills.add(colors.backgroundColor);
    const [lighter, darker] = [
      luminance(colors.backgroundColor),
      luminance(colors.textColor),
    ].sort((a, b) => b - a);
    expect((lighter + 0.05) / (darker + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(colors.backgroundAlpha).toBe(1);
  }
  expect(fills.size).toBe(8);
});

test("typed colors survive native saves and layout buds keep their ordinary style", () => {
  const root = readGraph(
    writeGraph(
      createStructuredJson({ list: ["", 0, false, null, {}] }),
      null,
      undefined,
      1
    )
  );
  const roles = documentState(root).metadata.freeform.structuredJson.nodes;
  for (const node of graphNodes(root)) {
    const kind = roles[node.id()].kind;
    if (kind === "entry") {
      expect(jsonNodeKind(root, node)).toBeUndefined();
      expect(jsonNodeAppearance(root, node)).toBeUndefined();
    } else {
      expect(jsonNodeKind(root, node)).toBe(kind);
      expect(jsonNodeAppearance(root, node)).toBe(jsonKindAppearance(kind));
    }
  }
});

test("incomplete values use slot colors while retaining their semantic kind", () => {
  const number = createStructuredJson(2);
  const result = applyJsonCommand(number, number, {
    type: "setText",
    text: "-",
  });
  expect(jsonNodeKind(result.root, result.root)).toBe("number");
  expect(jsonNodeAppearance(result.root, result.root)).toBe(
    jsonKindAppearance("slot")
  );
  const draft = createJsonDraft();
  const nodes = graphNodes(draft);
  expect(
    jsonNodeAppearance(
      draft,
      nodes.find((node) => node.value() === "[key]")
    )
  ).toBe(jsonKindAppearance("slot"));
  expect(
    jsonNodeAppearance(
      draft,
      nodes.find((node) => node.value() === "[value]")
    )
  ).toBe(jsonKindAppearance("slot"));
});

test("type styling uses metadata without traversing the graph or inferring labels", () => {
  const root = createStructuredJson("{}");
  const traversal = jest.spyOn(root, "paintGroup").mockImplementation(() => {
    throw new Error("Unexpected graph walk");
  });
  expect(jsonNodeAppearance(root, root)).toBe(jsonKindAppearance("string"));
  expect(traversal).not.toHaveBeenCalled();
  traversal.mockRestore();
  const ordinary = new DirectionNode("[value]");
  expect(jsonNodeAppearance(ordinary, ordinary)).toBeUndefined();
  expect(jsonKindAppearance("__proto__")).toBeUndefined();
});
