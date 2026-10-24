import { Alignment, Direction, DirectionNode, Fit } from "parsegraph";
import GraphStack from "./GraphStack";
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
  exportStructuredJson,
  inspectJsonSelection,
  isJsonSlotNode,
  isStructuredJson,
  jsonKeyboardTarget,
  structuredJsonStatus,
} from "./structuredJson";

const inward = (node) => node.neighbors().nodeAt(Direction.INWARD);
const forward = (node) => node.neighbors().nodeAt(Direction.FORWARD);
const down = (node) => node.neighbors().nodeAt(Direction.DOWNWARD);
const first = (root) => forward(inward(root));
const nodesOfKind = (root, kind) =>
  graphNodes(root).filter(
    (node) =>
      documentState(root).metadata.freeform.structuredJson.nodes[node.id()]
        .kind === kind
  );

test.each([{}, [], null, "", false, 0, { a: 1, b: [true, null, {}, [], ""] }])(
  "complete JSON round-trips including empty values: %j",
  (value) => {
    const root = createStructuredJson(value);
    expect(isStructuredJson(root)).toBe(true);
    expect(structuredJsonStatus(root)).toMatchObject({
      validStructure: true,
      complete: true,
      slotCount: 0,
    });
    expect(exportStructuredJson(root)).toEqual(value);
    expect(exportStructuredJson(readGraph(writeGraph(root)))).toEqual(value);
  }
);

test("new drafts have distinct key and value slots; an explicitly empty key and string are valid", () => {
  let root = createJsonDraft();
  expect(structuredJsonStatus(root).slotCount).toBe(2);
  const key = first(root);
  expect(inspectJsonSelection(root, inward(root))).toMatchObject({
    nodeId: key.id(),
    kind: "key",
    expected: "key",
    isSlot: true,
  });
  expect(() => exportStructuredJson(root)).toThrow("key slot");
  root = applyJsonCommand(root, key, { type: "setText", text: "" }).root;
  root = applyJsonCommand(root, down(first(root)), {
    type: "replace",
    kind: "string",
  }).root;
  expect(exportStructuredJson(root)).toEqual({ "": "" });
  expect(structuredJsonStatus(root).slotCount).toBe(0);
});

test("partial numeric input survives native saves and can be completed", () => {
  let root = createStructuredJson({ volume: 10 });
  const numberId = down(first(root)).id();
  root = applyJsonCommand(root, numberId, { type: "setText", text: "-" }).root;
  expect(inspectJsonSelection(root, numberId)).toMatchObject({
    kind: "number",
    text: "-",
    isSlot: true,
  });
  expect(structuredJsonStatus(root)).toMatchObject({
    validStructure: true,
    complete: false,
    slotCount: 1,
  });
  expect(() => exportStructuredJson(root)).toThrow('$["volume"]');
  root = readGraph(JSON.parse(JSON.stringify(writeGraph(root))));
  expect(inspectJsonSelection(root, numberId).text).toBe("-");
  root = applyJsonCommand(root, numberId, {
    type: "setText",
    text: "-1.5e2",
  }).root;
  expect(exportStructuredJson(root)).toEqual({ volume: -150 });
});

test.each(["", "01", "1.", "1e", "NaN", "Infinity", "1e999", "true", " 2"])(
  "number drafts are retained but never exported as %s",
  (text) => {
    const original = createStructuredJson(1);
    const { root } = applyJsonCommand(original, original, {
      type: "setText",
      text,
    });
    expect(inspectJsonSelection(root, root).text).toBe(text);
    expect(() => exportStructuredJson(root)).toThrow("finite JSON number");
    expect(exportStructuredJson(original)).toBe(1);
  }
);

test("add, fill, reorder, clear, and remove array entries atomically", () => {
  let root = createStructuredJson([1, 2]);
  let result = applyJsonCommand(root, root, { type: "add" });
  root = result.root;
  const insertedId = result.selectedNode.id();
  expect(inspectJsonSelection(root, insertedId)).toMatchObject({
    kind: "slot",
    removeAction: "remove",
  });
  root = applyJsonCommand(root, insertedId, { type: "paste", text: "3" }).root;
  root = applyJsonCommand(root, insertedId, { type: "move", offset: -1 }).root;
  expect(exportStructuredJson(root)).toEqual([1, 3, 2]);
  expect(inspectJsonSelection(root, insertedId)).toMatchObject({
    canMoveEarlier: true,
    canMoveLater: true,
  });
  root = applyJsonCommand(root, insertedId, { type: "clear" }).root;
  expect(structuredJsonStatus(root).slotCount).toBe(1);
  root = applyJsonCommand(root, insertedId, { type: "remove" }).root;
  expect(exportStructuredJson(root)).toEqual([1, 2]);
});

test.each(["key", "value", "bud"])(
  "inserting after an object %s creates a member in place and retains every existing node",
  (selection) => {
    const original = createStructuredJson({ a: 1, b: { nested: [2, 3] } });
    const oldIds = graphNodes(original).map((node) => node.id());
    const node = {
      key: first(original),
      value: down(first(original)),
      bud: inward(original),
    }[selection];
    let { root, selectedNode } = applyJsonCommand(original, node, {
      type: "insertSibling",
    });
    const secondKey = forward(down(inward(root)));
    expect(selectedNode).toBe(secondKey);
    expect(inspectJsonSelection(root, selectedNode)).toMatchObject({
      kind: "key",
      isSlot: true,
      parentId: root.id(),
      keyNodeId: secondKey.id(),
      valueNodeId: down(secondKey).id(),
      previousNodeId: first(root).id(),
      nextNodeId: forward(down(down(inward(root)))).id(),
    });
    expect(graphNodes(root).map((node) => node.id())).toEqual(
      expect.arrayContaining(oldIds)
    );
    expect(graphNodes(root)).toHaveLength(oldIds.length + 3);
    root = applyJsonCommand(root, selectedNode, {
      type: "setText",
      text: "inserted",
    }).root;
    root = applyJsonCommand(root, down(forward(down(inward(root)))), {
      type: "paste",
      text: "true",
    }).root;
    expect(Object.keys(exportStructuredJson(root))).toEqual([
      "a",
      "inserted",
      "b",
    ]);
    expect(exportStructuredJson(root)).toEqual({
      a: 1,
      inserted: true,
      b: { nested: [2, 3] },
    });
    expect(exportStructuredJson(original)).toEqual({
      a: 1,
      b: { nested: [2, 3] },
    });
  }
);

test.each(["value", "bud"])(
  "inserting from an array %s targets its entry, including a nested container",
  (selection) => {
    const original = createStructuredJson([[1, 2], 3]);
    const node = selection === "value" ? first(original) : inward(original);
    const result = applyJsonCommand(original, node, { type: "insertSibling" });
    expect(
      inspectJsonSelection(result.root, result.selectedNode)
    ).toMatchObject({
      kind: "slot",
      parentId: original.id(),
      parentKind: "array",
      keyNodeId: null,
    });
    const { root } = applyJsonCommand(result.root, result.selectedNode, {
      type: "paste",
      text: "4",
    });
    expect(exportStructuredJson(root)).toEqual([[1, 2], 4, 3]);
  }
);

test("insert before creates a slot before the selected entry", () => {
  const original = createStructuredJson([1, 2]);
  const inserted = applyJsonCommand(original, forward(down(inward(original))), {
    type: "insertSibling",
    offset: -1,
  });
  const { root } = applyJsonCommand(inserted.root, inserted.selectedNode, {
    type: "paste",
    text: "0",
  });
  expect(exportStructuredJson(root)).toEqual([1, 0, 2]);
});

test.each([{}, [], { a: 1 }, [1]])(
  "inserting on the root container appends and selects an unfinished entry: %j",
  (value) => {
    const root = createStructuredJson(value);
    const before = inspectJsonSelection(root, root).entryCount;
    const result = applyJsonCommand(root, root, { type: "insertSibling" });
    expect(inspectJsonSelection(result.root, result.root).entryCount).toBe(
      before + 1
    );
    expect(
      inspectJsonSelection(result.root, result.selectedNode)
    ).toMatchObject({
      isSlot: true,
      canMoveLater: false,
      parentId: root.id(),
      kind: Array.isArray(value) ? "slot" : "key",
    });
  }
);

test("root scalar and invalid insertion offsets fail without changing the graph", () => {
  const scalar = createStructuredJson(1);
  const root = createStructuredJson([1]);
  expect(inspectJsonSelection(scalar, scalar).canInsertSibling).toBe(false);
  expect(() =>
    applyJsonCommand(scalar, scalar, { type: "insertSibling" })
  ).toThrow("select an entry or a container");
  expect(() =>
    applyJsonCommand(root, first(root), { type: "insertSibling", offset: 0 })
  ).toThrow("insert before or after");
  expect(exportStructuredJson(scalar)).toBe(1);
  expect(exportStructuredJson(root)).toEqual([1]);
});

test("keyboard targets follow grammar relationships through layout buds", () => {
  const root = createStructuredJson({ a: [1], b: 2 });
  const firstKey = first(root);
  const array = down(firstKey);
  const secondKey = forward(down(inward(root)));
  expect(jsonKeyboardTarget(root, root, "enter")).toBe(firstKey);
  expect(jsonKeyboardTarget(root, inward(root), "enter")).toBe(array);
  expect(jsonKeyboardTarget(root, firstKey, "value")).toBe(array);
  expect(jsonKeyboardTarget(root, array, "enter")).toBe(first(array));
  expect(jsonKeyboardTarget(root, array, "container")).toBe(root);
  expect(jsonKeyboardTarget(root, first(array), "container")).toBe(array);
  expect(jsonKeyboardTarget(root, root, "container")).toBe(root);
  expect(jsonKeyboardTarget(root, down(firstKey), "next")).toBe(secondKey);
  expect(jsonKeyboardTarget(root, down(secondKey), "previous")).toBe(firstKey);
  expect(jsonKeyboardTarget(root, firstKey, "previous")).toBeNull();
  expect(jsonKeyboardTarget(root, secondKey, "next")).toBeNull();
  expect(jsonKeyboardTarget(root, down(secondKey), "enter")).toBeNull();
  const empty = createStructuredJson([]);
  expect(jsonKeyboardTarget(empty, empty, "enter")).toBeNull();
  const scalar = createStructuredJson(1);
  expect(jsonKeyboardTarget(scalar, scalar, "container")).toBeNull();
  expect(inspectJsonSelection(root, array)).toMatchObject({
    entryCount: 1,
    parentKind: "object",
    parentId: root.id(),
    keyNodeId: firstKey.id(),
    valueNodeId: array.id(),
  });
});

test("inserted slots and their selection survive native drafts and one undo/redo step", () => {
  const root = createStructuredJson({ a: 1, b: 2 });
  const stack = new GraphStack();
  stack.save(root, first(root));
  const result = applyJsonCommand(root, first(root), { type: "insertSibling" });
  stack.save(result.root, result.selectedNode);
  expect(stack.undoCount()).toBe(1);
  stack.undo();
  expect(exportStructuredJson(stack.widget())).toEqual({ a: 1, b: 2 });
  stack.redo();
  expect(stack.selectedNode()).toBe(result.selectedNode.id());
  expect(
    inspectJsonSelection(stack.widget(), stack.selectedNode())
  ).toMatchObject({
    kind: "key",
    isSlot: true,
    canMoveEarlier: true,
    canMoveLater: true,
  });
  const restored = readGraph(writeGraph(result.root));
  expect(structuredJsonStatus(restored)).toMatchObject({
    validStructure: true,
    slotCount: 2,
  });
  expect(inspectJsonSelection(restored, result.selectedNode.id()).isSlot).toBe(
    true
  );
});

test.each([
  ["number", "-"],
  ["number", "7"],
  ["boolean", "true"],
  ["string", "hi"],
])(
  "replacing a slot with initial %s text %s is one transaction",
  (kind, text) => {
    const root = createJsonDraft();
    const node = down(first(root));
    const stack = new GraphStack();
    stack.save(root, node);
    const result = applyJsonCommand(root, node, {
      type: "replace",
      kind,
      text,
    });
    stack.save(result.root, result.selectedNode);
    expect(
      inspectJsonSelection(result.root, result.selectedNode)
    ).toMatchObject({
      nodeId: node.id(),
      kind,
      text,
    });
    expect(stack.undoCount()).toBe(1);
    stack.undo();
    expect(
      inspectJsonSelection(stack.widget(), stack.selectedNode()).kind
    ).toBe("slot");
  }
);

test("initial replacement text rejects non-text and container values", () => {
  const root = createStructuredJson(1);
  expect(() =>
    applyJsonCommand(root, root, { type: "replace", kind: "number", text: 2 })
  ).toThrow("text must be a string");
  expect(() =>
    applyJsonCommand(root, root, { type: "replace", kind: "array", text: "[]" })
  ).toThrow("only scalar text values");
  expect(exportStructuredJson(root)).toBe(1);
});

test("wrapping preserves the original subtree and its identities", () => {
  const original = createStructuredJson({ nested: [1, 2] });
  const originalIds = graphNodes(original).map((node) => node.id());
  let { root, selectedNode } = applyJsonCommand(original, original, {
    type: "wrap",
    kind: "array",
  });
  expect(exportStructuredJson(root)).toEqual([{ nested: [1, 2] }]);
  expect(selectedNode).toBe(root);
  expect(graphNodes(root).map((node) => node.id())).toEqual(
    expect.arrayContaining(originalIds)
  );
  const wrapped = applyJsonCommand(root, root, {
    type: "wrap",
    kind: "object",
  });
  root = wrapped.root;
  expect(inspectJsonSelection(root, wrapped.selectedNode)).toMatchObject({
    kind: "key",
    isSlot: true,
  });
  root = applyJsonCommand(root, wrapped.selectedNode, {
    type: "setText",
    text: "items",
  }).root;
  expect(exportStructuredJson(root)).toEqual({ items: [{ nested: [1, 2] }] });
  expect(exportStructuredJson(original)).toEqual({ nested: [1, 2] });
});

test("member key deletion removes the member, while a value can be cleared independently", () => {
  let root = createStructuredJson({ a: 1, b: 2 });
  expect(inspectJsonSelection(root, first(root)).removeAction).toBe("remove");
  expect(inspectJsonSelection(root, down(first(root))).removeAction).toBe(
    "clear"
  );
  root = applyJsonCommand(root, down(first(root)), { type: "clear" }).root;
  expect(nodesOfKind(root, "key")).toHaveLength(2);
  expect(structuredJsonStatus(root).slotCount).toBe(1);
  root = applyJsonCommand(root, first(root), { type: "remove" }).root;
  expect(exportStructuredJson(root)).toEqual({ b: 2 });
});

test("duplicate keys remain visible and prevent lossy export", () => {
  const root = createStructuredJson({ a: 1, b: 2 });
  const secondKey = forward(down(inward(root)));
  const changed = applyJsonCommand(root, secondKey, {
    type: "setText",
    text: "a",
  }).root;
  expect(structuredJsonStatus(changed)).toMatchObject({
    validStructure: true,
    complete: false,
    slotCount: 0,
  });
  expect(() => exportStructuredJson(changed)).toThrow("Duplicate key");
  expect(exportStructuredJson(root)).toEqual({ a: 1, b: 2 });
});

test("special property names are ordinary JSON data", () => {
  const input = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":0,"toString":"x"}'
  );
  const output = exportStructuredJson(createStructuredJson(input));
  expect(Object.keys(output)).toEqual(["__proto__", "constructor", "toString"]);
  expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
  expect(output).toEqual(input);
  expect({}.polluted).toBeUndefined();
});

test("unexpected connections and untracked nodes are rejected rather than omitted", () => {
  const root = createStructuredJson({ a: 1 });
  root.connect(Direction.FORWARD, new DirectionNode("lost content"));
  expect(structuredJsonStatus(root)).toMatchObject({
    validStructure: false,
    complete: false,
  });
  expect(() => exportStructuredJson(root)).toThrow("Unexpected connection");
  expect(() => applyJsonCommand(root, root, { type: "add" })).toThrow(
    "Unexpected connection"
  );
});

test("unknown metadata versions, dangling roles, and malformed kinds are rejected", () => {
  let root = createStructuredJson([]);
  documentState(root).metadata.freeform.structuredJson.version = 2;
  expect(isStructuredJson(root)).toBe(true);
  expect(() => inspectJsonSelection(root, root)).toThrow("Unsupported");
  root = createStructuredJson([]);
  documentState(root).metadata.freeform.structuredJson.nodes.missing = {
    kind: "slot",
  };
  expect(() => exportStructuredJson(root)).toThrow("missing graph node");
  root = createStructuredJson([]);
  documentState(root).metadata.freeform.structuredJson.nodes[root.id()].kind =
    "mystery";
  expect(() => exportStructuredJson(root)).toThrow("Unknown value kind");
});

test("failed commands leave the original graph untouched", () => {
  const root = createStructuredJson({ a: 1 });
  const before = writeGraph(root);
  expect(() =>
    applyJsonCommand(root, root, { type: "paste", text: '{"a":' })
  ).toThrow("incomplete or invalid");
  expect(() =>
    applyJsonCommand(root, first(root), { type: "replace", kind: "array" })
  ).toThrow("key must remain a string");
  expect(writeGraph(root)).toEqual(before);
});

test("draft roles, selection, opaque metadata, and undo/redo survive serialization", () => {
  const root = createStructuredJson({ a: 1 });
  documentState(root).metadata.other = { retained: true };
  const stack = new GraphStack();
  stack.save(root, root);
  const changed = applyJsonCommand(root, down(first(root)), { type: "clear" });
  stack.save(changed.root, changed.selectedNode);
  expect(stack.undoCount()).toBe(1);
  expect(documentState(changed.root).metadata.other).toEqual({
    retained: true,
  });
  stack.undo();
  expect(exportStructuredJson(stack.widget())).toEqual({ a: 1 });
  stack.redo();
  const draft = stack.widget();
  expect(inspectJsonSelection(draft, stack.selectedNode())).toMatchObject({
    kind: "slot",
    isSlot: true,
  });
  expect(structuredJsonStatus(draft).slotCount).toBe(1);
});

test("semantic edits preserve surviving node scale, fit, and edge alignment", () => {
  const root = createStructuredJson({ a: [1, 2] });
  const key = first(root);
  const array = down(key);
  array.setScale(0.5);
  array.setNodeFit(Fit.EXACT);
  key.neighbors().align(Direction.DOWNWARD, Alignment.POSITIVE);
  const result = applyJsonCommand(root, key, {
    type: "setText",
    text: "renamed",
  });
  const nextKey = first(result.root);
  const nextArray = down(nextKey);
  expect(nextArray.id()).toBe(array.id());
  expect(nextArray.scale()).toBe(0.5);
  expect(nextArray.nodeFit()).toBe(Fit.EXACT);
  expect(nextKey.neighbors().getAlignment(Direction.DOWNWARD)).toBe(
    Alignment.POSITIVE
  );
  expect(exportStructuredJson(result.root)).toEqual({ renamed: [1, 2] });
});

test("slot paint hints distinguish placeholders and scalar drafts from complete empty values", () => {
  const draft = createJsonDraft();
  expect(isJsonSlotNode(draft, first(draft))).toBe(true);
  expect(isJsonSlotNode(draft, down(first(draft)))).toBe(true);
  expect(isJsonSlotNode(draft, inward(draft))).toBe(false);
  for (const value of ["", {}, [], null, false, 0]) {
    const root = createStructuredJson(value);
    expect(isJsonSlotNode(root, root)).toBe(false);
  }
  const number = createStructuredJson(1);
  const partial = applyJsonCommand(number, number, {
    type: "setText",
    text: "-",
  }).root;
  expect(isJsonSlotNode(partial, partial)).toBe(true);
  const boolean = createStructuredJson(true);
  const partialBoolean = applyJsonCommand(boolean, boolean, {
    type: "setText",
    text: "tru",
  }).root;
  expect(isJsonSlotNode(partialBoolean, partialBoolean)).toBe(true);
  const ordinary = new DirectionNode("[value]");
  expect(isJsonSlotNode(ordinary, ordinary)).toBe(false);
  expect(isJsonSlotNode(draft, ordinary)).toBe(false);
});
