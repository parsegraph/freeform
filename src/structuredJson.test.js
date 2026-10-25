import {
  Alignment,
  CommitLayout,
  Direction,
  DirectionCaret,
  DirectionNode,
  Fit,
  SHRINK_SCALE,
} from "parsegraph";
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
const entryBuds = (container) => {
  const buds = [];
  let bud = container.neighbors().hasChild(Direction.INWARD)
    ? inward(container)
    : null;
  while (bud) {
    buds.push(bud);
    bud = bud.neighbors().hasChild(Direction.DOWNWARD) ? down(bud) : null;
  }
  return buds;
};
const effectiveScale = (node) => {
  let scale = 1;
  while (!node.neighbors().isRoot()) {
    scale *= node.scale();
    node = node.neighbors().parentNode();
  }
  return scale;
};
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

test("editing JSON preserves container and explicit paint groups without uncreasing their ordinary members", () => {
  let root = createStructuredJson({ service: { port: 3000 }, routes: ["/", "/health"] });
  const port = graphNodes(root).find((node) => node.value() === "3000");
  port.paintGroups().crease();
  const groups = () => graphNodes(root).filter((node) => node.paintGroups().isPaintGroup()).map((node) => node.id()).sort();
  const before = groups();
  expect(before.length).toBeGreaterThan(3);
  for (const text of ["3001", "8080"]) {
    root = applyJsonCommand(root, port.id(), { type: "setText", text }).root;
    expect(groups()).toEqual(before);
    root = readGraph(writeGraph(root));
    expect(groups()).toEqual(before);
  }
});

test("promoting an entry to the first position retains the new INWARD paint group", () => {
  for (const command of [{ type: "move", offset: 1 }, { type: "remove" }]) {
    const original = createStructuredJson([1, 2]);
    const root = applyJsonCommand(original, first(original), command).root;
    expect(inward(root).paintGroups().isPaintGroup()).toBe(true);
    expect(inward(readGraph(writeGraph(root))).paintGroups().isPaintGroup()).toBe(true);
  }
  const original = createStructuredJson([1, 2]);
  inward(original).paintGroups().uncrease();
  const edited = applyJsonCommand(original, first(original), { type: "setText", text: "10" }).root;
  expect(inward(edited).paintGroups().isPaintGroup()).toBe(false);
});

test("a configuration refactor preserves nested identities, validates drafts, and survives native history", () => {
  const input = {
    service: { name: "worker", port: 3000, enabled: true },
    routes: [{ path: "/old", method: "GET" }, { path: "/health", method: "GET" }],
    deprecated: "remove me",
  };
  const original = createStructuredJson(input);
  let root = original;
  const at = (path) => graphNodes(root).find((node) => inspectJsonSelection(root, node).path === path);
  const serviceKey = at('$["service"].key').id();
  const service = at('$["service"]').id();
  const nameKey = at('$["service"]["name"].key').id();
  const name = at('$["service"]["name"]').id();
  const port = at('$["service"]["port"]').id();
  const enabled = at('$["service"]["enabled"]').id();
  const routes = at('$["routes"]').id();
  const oldRoute = at('$["routes"][0]').id();
  const deprecated = at('$["deprecated"].key').id();
  const healthIds = graphNodes(root).filter((node) => inspectJsonSelection(root, node).path.startsWith('$["routes"][1]')).map((node) => node.id());
  const history = new GraphStack();
  history.save(root, root);
  const edit = (id, command) => {
    const changed = applyJsonCommand(root, id, command);
    history.save(changed.root, changed.selectedNode);
    root = readGraph(JSON.parse(JSON.stringify(writeGraph(changed.root))));
    return changed.selectedNode.id();
  };
  edit(serviceKey, { type: "setText", text: "app" });
  expect(at('$["app"]').id()).toBe(service);
  edit(name, { type: "setText", text: "api" });
  edit(port, { type: "setText", text: "1e" });
  expect(structuredJsonStatus(root)).toMatchObject({ validStructure: true, complete: false, slotCount: 1 });
  expect(() => exportStructuredJson(root)).toThrow(/finite JSON number/);
  edit(port, { type: "setText", text: "8080" });
  edit(enabled, { type: "replace", kind: "boolean", text: "false" });
  edit(nameKey, { type: "setText", text: "port" });
  expect(() => exportStructuredJson(root)).toThrow(/Duplicate key/);
  edit(nameKey, { type: "setText", text: "label" });
  const retryKey = edit(service, { type: "add" });
  edit(retryKey, { type: "setText", text: "retry" });
  edit(inspectJsonSelection(root, retryKey).valueNodeId, { type: "paste", text: '{"attempts":3,"delayMs":250}' });
  edit(retryKey, { type: "move", offset: -1 });
  const wrappedKey = edit(routes, { type: "wrap", kind: "object" });
  expect(structuredJsonStatus(root).complete).toBe(false);
  edit(wrappedKey, { type: "setText", text: "items" });
  const addedRoute = edit(oldRoute, { type: "insertSibling", offset: 1 });
  edit(addedRoute, { type: "paste", text: '{"path":"/v2","method":"POST"}' });
  edit(addedRoute, { type: "move", offset: -1 });
  edit(oldRoute, { type: "remove" });
  edit(deprecated, { type: "remove" });
  const expected = {
    app: { label: "api", port: 8080, retry: { attempts: 3, delayMs: 250 }, enabled: false },
    routes: { items: [{ path: "/v2", method: "POST" }, { path: "/health", method: "GET" }] },
  };
  expect(exportStructuredJson(root)).toEqual(expected);
  expect(Object.keys(exportStructuredJson(root).app)).toEqual(["label", "port", "retry", "enabled"]);
  expect(at('$["routes"]["items"]').id()).toBe(routes);
  expect(graphNodes(root).map((node) => node.id())).toEqual(expect.arrayContaining(healthIds));
  while (history.undoCount()) history.undo();
  expect(exportStructuredJson(history.widget())).toEqual(input);
  while (history.redoCount()) history.redo();
  expect(exportStructuredJson(history.widget())).toEqual(expected);
  expect(exportStructuredJson(original)).toEqual(input);
});

test("new vertical multislots reserve space along the spine without loosening their node fit", () => {
  const root = createStructuredJson({ items: [1, { nested: [2, 3] }], other: 4 });
  for (const bud of nodesOfKind(root, "entry")) {
    expect(bud.nodeFit()).toBe(Fit.EXACT);
    expect(bud.separationFit(Direction.DOWNWARD)).toBe(Fit.LOOSE);
    expect(bud.separationFit(Direction.UPWARD)).toBe(Fit.LOOSE);
    expect(bud.separationFit(Direction.FORWARD)).toBe(Fit.EXACT);
    expect(bud.separationFit(Direction.BACKWARD)).toBe(Fit.EXACT);
  }
});

test("semantic edits and reordering preserve tightened and dormant separation settings while new buds get defaults", () => {
  let root = createStructuredJson([1, 2]);
  const [firstBud, secondBud] = entryBuds(root);
  const firstId = first(root).id();
  new DirectionCaret(firstBud).tighten();
  firstBud.setSeparationFit(Direction.BACKWARD, Fit.LOOSE);
  secondBud.setSeparationFit(Direction.FORWARD, Fit.LOOSE);
  const directions = [Direction.DOWNWARD, Direction.UPWARD, Direction.FORWARD, Direction.BACKWARD];
  const settings = new Map(entryBuds(root).map((bud) => [
    bud.id(), directions.map((direction) => bud.separationFit(direction)),
  ]));
  root = applyJsonCommand(root, firstId, { type: "setText", text: "10" }).root;
  root = applyJsonCommand(root, firstId, { type: "move", offset: 1 }).root;
  root = applyJsonCommand(root, firstId, { type: "insertSibling", offset: 1 }).root;
  const buds = entryBuds(root);
  for (const bud of buds.filter((item) => settings.has(item.id()))) {
    expect(directions.map((direction) => bud.separationFit(direction))).toEqual(settings.get(bud.id()));
  }
  const added = buds.find((bud) => !settings.has(bud.id()));
  expect(directions.map((direction) => added.separationFit(direction)))
    .toEqual([Fit.LOOSE, Fit.LOOSE, Fit.EXACT, Fit.EXACT]);
  expect(added.nodeFit()).toBe(Fit.EXACT);
  expect(exportStructuredJson(applyJsonCommand(root, forward(added), {
    type: "replace", kind: "number", text: "3",
  }).root)).toEqual([2, 10, 3]);
});

test("draft reconstruction retains live separation and focus settings instead of stale capability records", () => {
  const original = createStructuredJson([1, 2]);
  const selected = first(original);
  const budId = inward(original).id();
  new DirectionCaret(inward(original)).tighten();
  original.setFocus(Direction.INWARD);
  selected.setFocus();
  let root = readGraph(JSON.parse(JSON.stringify(writeGraph(original))));
  root = applyJsonCommand(root, selected.id(), { type: "setText", text: "10" }).root;
  expect(inward(root).id()).toBe(budId);
  expect(inward(root).separationFit(Direction.DOWNWARD)).toBe(Fit.EXACT);
  expect(inward(root).separationFit(Direction.UPWARD)).toBe(Fit.EXACT);
  expect(root.focusDirections()).toEqual([Direction.INWARD]);
  expect(first(root).focusDirections()).toEqual([]);
  let saved = writeGraph(root);
  expect(saved.capabilities["focus/1"].nodeDirections).toEqual({
    [root.id()]: ["inward"], [selected.id()]: [],
  });
  expect(saved.capabilities["separation/1"].nodeDirections).not.toHaveProperty(budId);
  root.clearFocus();
  root = applyJsonCommand(root, selected.id(), { type: "setText", text: "11" }).root;
  saved = writeGraph(root);
  expect(saved.capabilities["focus/1"].nodeDirections).toEqual({ [selected.id()]: [] });
  const restored = readGraph(JSON.parse(JSON.stringify(saved)));
  expect(restored.focusDirections()).toBeUndefined();
  expect(first(restored).focusDirections()).toEqual([]);
  expect(inward(restored).separationFit(Direction.DOWNWARD)).toBe(Fit.EXACT);
  expect(exportStructuredJson(restored)).toEqual([11, 2]);
});

test("wrapping keeps focus intent except directions that become parent-facing", () => {
  const original = createStructuredJson(1);
  original.setFocus(Direction.BACKWARD, Direction.DOWNWARD);
  const { root } = applyJsonCommand(original, original, { type: "wrap", kind: "array" });
  expect(root.focusDirections()).toBeUndefined();
  expect(first(root).id()).toBe(original.id());
  expect(first(root).focusDirections()).toEqual([Direction.DOWNWARD]);
  const restored = readGraph(writeGraph(root));
  expect(first(restored).focusDirections()).toEqual([Direction.DOWNWARD]);
  expect(exportStructuredJson(restored)).toEqual([1]);
});

test("loose vertical multislot separation prevents exact-contour prongs from interlocking", () => {
  const root = createStructuredJson({ long: 1, short: 2 });
  // Loose-fit child contours are already rectangular. Exact contours expose
  // the interlocking case without changing the JSON topology or centering.
  graphNodes(root).forEach((node) => node.setNodeFit(Fit.EXACT));
  const buds = entryBuds(root);
  const keys = buds.map(forward);
  const values = keys.map(down);
  const sizes = new Map([
    [keys[0], [100, 10]], [keys[1], [20, 10]],
    [values[0], [10, 100]], [values[1], [10, 100]],
  ]);
  const commit = () => {
    const layout = new CommitLayout(root, {
      size: (node, out) => {
        const size = sizes.get(node) ?? [10, 10];
        out[0] = size[0]; out[1] = size[1];
      },
    });
    let steps = 0;
    while (layout.crank()) expect(++steps).toBeLessThan(10000);
  };
  const spacing = () => buds[1].layout().absoluteY() - buds[0].layout().absoluteY();
  commit();
  const looseSpacing = spacing();
  const prongPositions = [...keys, ...values].map((node) => [node.neighbors().parentX(), node.neighbors().parentY()]);
  buds.forEach((bud) => new DirectionCaret(bud).tighten());
  commit();
  expect(looseSpacing).toBeGreaterThan(spacing());
  expect([...keys, ...values].map((node) => [node.neighbors().parentX(), node.neighbors().parentY()]))
    .toEqual(prongPositions);
  expect(buds.every((bud) => bud.nodeFit() === Fit.EXACT)).toBe(true);
});

test("container contents shrink once per nesting level, with equally sized siblings and key/value pairs", () => {
  const root = createStructuredJson([1, { items: [2, 3] }, 4]);
  const outerBuds = entryBuds(root);
  expect(root.scale()).toBe(1);
  expect(outerBuds.map((bud) => bud.scale())).toEqual([SHRINK_SCALE, 1, 1]);
  outerBuds.forEach((bud) => {
    expect(forward(bud).scale()).toBe(1);
    expect(effectiveScale(forward(bud))).toBeCloseTo(SHRINK_SCALE);
  });
  const object = forward(outerBuds[1]);
  const key = first(object);
  const array = down(key);
  expect(key.scale()).toBe(1);
  expect(array.scale()).toBe(1);
  expect(effectiveScale(key)).toBeCloseTo(SHRINK_SCALE ** 2);
  expect(effectiveScale(array)).toBeCloseTo(SHRINK_SCALE ** 2);
  expect(entryBuds(array).map((bud) => bud.scale())).toEqual([SHRINK_SCALE, 1]);
  entryBuds(array).forEach((bud) => {
    expect(effectiveScale(forward(bud))).toBeCloseTo(SHRINK_SCALE ** 3);
  });
  expect(effectiveScale(down(first(createJsonDraft())))).toBeCloseTo(
    SHRINK_SCALE
  );
  expect(exportStructuredJson(root)).toEqual([1, { items: [2, 3] }, 4]);
});

test("repeated text edits and changing the first entry keep one shared content shrink", () => {
  let root = createStructuredJson([1, 2, 3]);
  const originalFirstId = first(root).id();
  const expectUniformContents = () => {
    const buds = entryBuds(root);
    expect(buds.map((bud) => bud.scale())).toEqual([
      SHRINK_SCALE,
      ...buds.slice(1).map(() => 1),
    ]);
    buds.forEach((bud) => {
      expect(effectiveScale(forward(bud))).toBeCloseTo(SHRINK_SCALE);
    });
  };
  for (const text of ["10", "11", "12"]) {
    root = applyJsonCommand(root, originalFirstId, {
      type: "setText",
      text,
    }).root;
    expectUniformContents();
  }
  const inserted = applyJsonCommand(root, originalFirstId, {
    type: "insertSibling",
    offset: -1,
  });
  root = inserted.root;
  const insertedId = inserted.selectedNode.id();
  expectUniformContents();
  root = applyJsonCommand(root, insertedId, { type: "move", offset: 1 }).root;
  expectUniformContents();
  root = applyJsonCommand(root, originalFirstId, { type: "remove" }).root;
  expectUniformContents();
  root = applyJsonCommand(root, insertedId, { type: "remove" }).root;
  expectUniformContents();
  expect(exportStructuredJson(root)).toEqual([2, 3]);
});

test("adding to an empty container, pasting, and wrapping apply each new nesting scale", () => {
  const added = applyJsonCommand(createStructuredJson([]), undefined, {
    type: "add",
  });
  expect(effectiveScale(added.selectedNode)).toBeCloseTo(SHRINK_SCALE);
  let root = applyJsonCommand(added.root, added.selectedNode, {
    type: "paste",
    text: '{"items":[1,2]}',
  }).root;
  const object = first(root);
  const array = down(first(object));
  expect(effectiveScale(object)).toBeCloseTo(SHRINK_SCALE);
  expect(effectiveScale(first(array))).toBeCloseTo(SHRINK_SCALE ** 3);
  const originalId = root.id();
  root.setScale(0.5);
  root = applyJsonCommand(root, root, { type: "wrap", kind: "array" }).root;
  expect(first(root).id()).toBe(originalId);
  expect(first(root).scale()).toBe(0.5);
  expect(effectiveScale(first(root))).toBeCloseTo(SHRINK_SCALE * 0.5);
  const wrappedObject = first(first(root));
  const wrappedArray = down(first(wrappedObject));
  expect(effectiveScale(first(wrappedArray))).toBeCloseTo(
    SHRINK_SCALE ** 4 * 0.5
  );
  expect(exportStructuredJson(root)).toEqual([[{ items: [1, 2] }]]);
});

test("manual scales retain their adjustment when entry buds gain or lose the first position", () => {
  let root = createStructuredJson([1, 2]);
  const [firstBud, secondBud] = entryBuds(root);
  const firstId = first(root).id();
  firstBud.setScale(0.5);
  secondBud.setScale(0.6);
  first(root).setScale(0.4);
  root = applyJsonCommand(root, firstId, { type: "setText", text: "10" }).root;
  expect(inward(root).scale()).toBe(0.5);
  expect(down(inward(root)).scale()).toBe(0.6);
  expect(first(root).scale()).toBe(0.4);
  root = applyJsonCommand(root, firstId, { type: "move", offset: 1 }).root;
  expect(inward(root).id()).toBe(secondBud.id());
  expect(inward(root).scale()).toBeCloseTo(0.6 * SHRINK_SCALE);
  expect(down(inward(root)).id()).toBe(firstBud.id());
  expect(down(inward(root)).scale()).toBeCloseTo(0.5 / SHRINK_SCALE);
  expect(forward(down(inward(root))).scale()).toBe(0.4);
  root = applyJsonCommand(root, firstId, { type: "move", offset: -1 }).root;
  expect(inward(root).scale()).toBeCloseTo(0.5);
  expect(down(inward(root)).scale()).toBeCloseTo(0.6);
  expect(first(root).scale()).toBe(0.4);
});

test("native saves and undo/redo retain nested shrink and remain stable after another edit", () => {
  const original = createStructuredJson([[1], 2]);
  const stack = new GraphStack();
  stack.save(original, first(original));
  const changed = applyJsonCommand(original, first(original), {
    type: "move",
    offset: 1,
  });
  stack.save(changed.root, changed.selectedNode);
  stack.undo();
  const undone = stack.widget();
  expect(effectiveScale(first(first(undone)))).toBeCloseTo(SHRINK_SCALE ** 2);
  stack.redo();
  let restored = readGraph(
    JSON.parse(JSON.stringify(writeGraph(stack.widget())))
  );
  let array = forward(down(inward(restored)));
  expect(array.id()).toBe(first(original).id());
  expect(effectiveScale(array)).toBeCloseTo(SHRINK_SCALE);
  expect(effectiveScale(first(array))).toBeCloseTo(SHRINK_SCALE ** 2);
  restored = applyJsonCommand(restored, first(array), {
    type: "setText",
    text: "3",
  }).root;
  array = forward(down(inward(restored)));
  expect(effectiveScale(first(array))).toBeCloseTo(SHRINK_SCALE ** 2);
  expect(exportStructuredJson(restored)).toEqual([2, [3]]);
});

test("legacy drafts acquire the content shrink once while retaining manual scale adjustments", () => {
  let root = createStructuredJson({ items: [1, 2] });
  delete documentState(root).metadata.freeform.structuredJson.innerScale;
  const array = down(first(root));
  inward(root).setScale(0.5);
  inward(array).setScale(1);
  first(array).setScale(0.5);
  const numberId = first(array).id();
  root = readGraph(JSON.parse(JSON.stringify(writeGraph(root))));
  root = applyJsonCommand(root, numberId, { type: "setText", text: "3" }).root;
  expect(documentState(root).metadata.freeform.structuredJson.innerScale).toBe(
    SHRINK_SCALE
  );
  expect(inward(root).scale()).toBeCloseTo(0.5 * SHRINK_SCALE);
  expect(inward(down(first(root))).scale()).toBe(SHRINK_SCALE);
  expect(first(down(first(root))).scale()).toBe(0.5);
  root = readGraph(JSON.parse(JSON.stringify(writeGraph(root))));
  root = applyJsonCommand(root, numberId, { type: "setText", text: "4" }).root;
  expect(inward(root).scale()).toBeCloseTo(0.5 * SHRINK_SCALE);
  expect(inward(down(first(root))).scale()).toBe(SHRINK_SCALE);
  expect(first(down(first(root))).scale()).toBe(0.5);
  expect(exportStructuredJson(root)).toEqual({ items: [4, 2] });
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
