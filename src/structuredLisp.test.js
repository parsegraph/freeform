import { Alignment, AxisOverlap, Bidi, CommitLayout, Direction, DirectionCaret, DirectionNode, Fit, SHRINK_SCALE } from "parsegraph";
import GraphStack from "./GraphStack";
import { DEFAULT_LAYOUT_DIRECTION } from "./settings";
import { documentState, graphNodes, readGraph, writeGraph } from "./graphDocument";
import { readLisp } from "./lispReader";
import * as reader from "./lispReader";
import {
  createStructuredLisp, createLispDraft, isStructuredLisp, structuredLispStatus,
  inspectLispSelection, applyLispCommand, lispKeyboardTarget, exportStructuredLisp,
  isLispSlotNode, upgradeLispLayout,
} from "./structuredLisp";

const inward = (node) => node.neighbors().nodeAt(Direction.INWARD);
const forward = (node) => node.neighbors().nodeAt(Direction.FORWARD);
const down = (node) => node.neighbors().nodeAt(Direction.DOWNWARD);
const first = inward;
const kindNodes = (root, kind) => graphNodes(root).filter((node) =>
  documentState(root).metadata.freeform.structuredLisp.nodes[node.id()].kind === kind);
const roundTrip = (root) => readGraph(JSON.parse(JSON.stringify(writeGraph(root))));

test("layout upgrade resolves ordinary graph selections with legacy numeric IDs", () => {
  const root = new DirectionNode("ordinary"); root.setId(1);
  const selected = new DirectionNode("selected"); selected.setId(7);
  root.connect(Direction.FORWARD, selected);
  for (const selection of [7, "7", selected]) {
    const upgraded = upgradeLispLayout(root, selection);
    expect(upgraded.root).toBe(root);
    expect(upgraded.selectedNode).toBe(selected);
    expect(upgraded.selectedNode.id()).toBe(7);
  }
  for (const selection of [null, undefined, 99, {}, false])
    expect(upgradeLispLayout(root, selection).selectedNode).toBe(root);
});
const commit = (root, defaultDirection = DEFAULT_LAYOUT_DIRECTION) => {
  const job = new CommitLayout(root, { size: (node, out) => {
    const lines = String(node.value() || "").split("\n");
    out[0] = Math.max(8, ...lines.map((line) => line.length * 6));
    out[1] = lines.length * 12;
  } }, defaultDirection);
  let steps = 0;
  while (job.crank()) expect(++steps).toBeLessThan(10000);
};
const absoluteScales = (root) => {
  commit(root);
  return new Map(graphNodes(root).map((node) => [node.id(), node.layout().absoluteScale()]));
};

test("Lisp rebuilds and native history preserve nested bidi scopes without changing source order", () => {
  let root = createStructuredLisp("(outer (inner leaf) tail)");
  expect(documentState(root)).toMatchObject({ version: 2, sourceVersion: 2 });
  expect(documentState(root).metadata.freeform.structuredLisp.version).toBe(1);
  expect(graphNodes(root).every((node) => node.bidi() === Bidi.INHERIT)).toBe(true);
  const outer = first(root);
  const nested = forward(first(outer));
  const tail = forward(nested);
  outer.setBidi(Bidi.RTL);
  nested.setBidi(Bidi.LTR);
  const originalBidi = Object.fromEntries(graphNodes(root).map((node) => [node.id(), node.bidi()]));
  const assertBidi = (graph) => {
    expect(Object.fromEntries(graphNodes(graph).map((node) => [node.id(), node.bidi()])))
      .toMatchObject(originalBidi);
    expect(graphNodes(graph).filter((node) => !(node.id() in originalBidi))
      .every((node) => node.bidi() === Bidi.INHERIT)).toBe(true);
  };
  const geometry = (graph, defaultDirection) => {
    commit(graph, defaultDirection);
    const byId = new Map(graphNodes(graph).map((node) => [node.id(), node]));
    expect(graph.effectiveBidi()).toBe(defaultDirection);
    expect(byId.get(outer.id()).effectiveBidi()).toBe(Bidi.RTL);
    const inner = byId.get(nested.id());
    expect(inner.effectiveBidi()).toBe(Bidi.LTR);
    expect(forward(first(inner)).effectiveBidi()).toBe(Bidi.LTR);
    expect(forward(first(inner)).layout().absoluteX()).toBeGreaterThan(first(inner).layout().absoluteX());
    return Object.fromEntries(graphNodes(graph).map((node) => [node.id(), {
      parent: node.neighbors().isRoot() ? null : node.neighbors().parentNode().id(),
      direction: node.neighbors().parentDirection(), bidi: node.bidi(),
      resolved: node.effectiveBidi(), x: node.layout().absoluteX(),
      y: node.layout().absoluteY(), scale: node.layout().absoluteScale(),
    }]));
  };
  const history = new GraphStack(); history.save(root);
  root = applyLispCommand(root, tail.id(), { type: "setText", text: "changed" }).root;
  root = applyLispCommand(root, tail.id(), { type: "wrap", kind: "quote" }).root;
  assertBidi(root);
  expect(exportStructuredLisp(root)).toBe("(outer (inner leaf) 'changed)");
  history.save(root);
  for (const direction of [Bidi.LTR, Bidi.RTL]) {
    const before = geometry(root, direction);
    const saved = writeGraph(root);
    expect(saved.version).toBe(2);
    expect(saved.nodes.every((node) => "bidi" in node && !("rightToLeft" in node))).toBe(true);
    const restored = roundTrip(root);
    assertBidi(restored);
    expect(geometry(restored, direction)).toEqual(before);
  }
  history.undo(); assertBidi(history.widget());
  expect(exportStructuredLisp(history.widget())).toBe("(outer (inner leaf) tail)");
  history.redo(); assertBidi(history.widget());
  expect(exportStructuredLisp(history.widget())).toBe("(outer (inner leaf) 'changed)");
});

test.each([
  "", "() #() #u8()", "(define (square x) (* x x)) (square 12)",
  '; heading\n(define text "a\\x41;\\n") ; trailing',
  "#| outer #| nested |# comment |# '(a . #;ignored b)",
  "`(a ,b ,@c) #; (discard me) |escaped symbol| #\\space",
  "#U8(0 #xFF #e2.0 6/2) #e#xFF 1/3 1.20e+3 2-3i -i +inf.0",
])("structured Scheme preserves data, comments, and literal spellings: %s", (source) => {
  const root = createStructuredLisp(source);
  expect(isStructuredLisp(root)).toBe(true);
  expect(structuredLispStatus(root)).toMatchObject({ complete: true, validStructure: true, slotCount: 0 });
  expect(readLisp(exportStructuredLisp(root))).toEqual(readLisp(source));
  expect(exportStructuredLisp(roundTrip(root))).toBe(exportStructuredLisp(root));
  expect(Object.keys(documentState(root).metadata.freeform.structuredLisp).sort())
    .toEqual(["innerScale", "layout", "nodes", "version"]);
});

test("the graph's literal text is authoritative and is never evaluated", () => {
  const root = createStructuredLisp('(system "erase everything")');
  const string = kindNodes(root, "string")[0];
  expect(string.value()).toBe('"erase everything"');
  string.setValue('"just data"');
  expect(exportStructuredLisp(root)).toBe('(system "just data")');
  expect(() => createStructuredLisp('#.(system "run")')).toThrow(/Unsupported.*reader/);
});

test("new drafts have a navigable, editable slot with a stable identity", () => {
  let root = createLispDraft();
  const selected = first(root);
  expect(structuredLispStatus(root)).toMatchObject({ complete: false, slotCount: 1 });
  expect(inspectLispSelection(root, inward(root))).toMatchObject({ nodeId: selected.id(), kind: "slot", text: "", canEdit: true });
  expect(isLispSlotNode(root, selected)).toBe(true);
  expect(() => exportStructuredLisp(root)).toThrow(/draft/);
  root = applyLispCommand(root, selected, { type: "setText", text: "greeting" }).root;
  expect(first(root).id()).toBe(selected.id());
  expect(exportStructuredLisp(root)).toBe("greeting");
  const wrapped = applyLispCommand(root, selected.id(), { type: "wrap", kind: "quote" });
  expect(lispKeyboardTarget(wrapped.root, wrapped.selectedNode, "enter").id()).toBe(selected.id());
  expect(exportStructuredLisp(wrapped.root)).toBe("'greeting");
});

test("incomplete raw literal edits survive native drafts and block source export until fixed", () => {
  let root = createStructuredLisp("#x123");
  const id = first(root).id();
  root = applyLispCommand(root, id, { type: "setText", text: "#x" }).root;
  expect(first(root).value()).toBe("#x");
  expect(inspectLispSelection(root, id)).toMatchObject({ kind: "number", isSlot: true, text: "#x" });
  expect(isLispSlotNode(root, first(root))).toBe(true);
  expect(structuredLispStatus(root)).toMatchObject({ validStructure: true, complete: false, slotCount: 1 });
  root = roundTrip(root);
  expect(() => exportStructuredLisp(root)).toThrow(/draft/);
  root = applyLispCommand(root, id, { type: "setText", text: "#xFF" }).root;
  expect(exportStructuredLisp(root)).toBe("#xFF");
});

test("scalar types remain deliberate instead of silently turning invalid strings into symbols", () => {
  const root = createStructuredLisp('"old"');
  const changed = applyLispCommand(root, first(root), { type: "setText", text: "unquoted" });
  expect(inspectLispSelection(changed.root, changed.selectedNode)).toMatchObject({ kind: "string", isSlot: true });
  expect(() => exportStructuredLisp(changed.root)).toThrow(/complete string/);
  expect(exportStructuredLisp(applyLispCommand(changed.root, changed.selectedNode, {
    type: "replace", kind: "symbol", text: "unquoted",
  }).root)).toBe("unquoted");
});

test("paint hints reuse literal validation until a node's text or type changes", () => {
  const root = createStructuredLisp("1");
  const node = first(root);
  const validate = jest.spyOn(reader, "lispScalarProblem");
  try {
    expect(isLispSlotNode(root, node)).toBe(false);
    expect(isLispSlotNode(root, node)).toBe(false);
    expect(validate).toHaveBeenCalledTimes(1);
    node.setValue("unfinished");
    expect(isLispSlotNode(root, node)).toBe(true);
    expect(validate).toHaveBeenCalledTimes(2);
    documentState(root).metadata.freeform.structuredLisp.nodes[node.id()].kind = "symbol";
    expect(isLispSlotNode(root, node)).toBe(false);
    expect(validate).toHaveBeenCalledTimes(3);
  } finally { validate.mockRestore(); }
});

test("removing a prefix operand leaves a fillable slot instead of an unreachable missing operand", () => {
  const root = createStructuredLisp("'datum");
  const operand = kindNodes(root, "symbol")[0];
  expect(inspectLispSelection(root, operand)).toMatchObject({ removeAction: "clear", canInsertSibling: false });
  expect(() => applyLispCommand(root, operand, { type: "insertSibling", offset: 1 })).toThrow(/one operand/);
  const changed = applyLispCommand(root, operand, { type: "remove" });
  expect(changed.selectedNode.id()).toBe(operand.id());
  expect(structuredLispStatus(changed.root)).toMatchObject({ complete: false, slotCount: 1 });
  expect(lispKeyboardTarget(changed.root, first(changed.root), "enter")).toBe(changed.selectedNode);
  expect(exportStructuredLisp(applyLispCommand(changed.root, changed.selectedNode, {
    type: "setText", text: "replacement",
  }).root)).toBe("'replacement");
});

test("adding, moving, removing, and pasting forms changes their graph order", () => {
  let root = createStructuredLisp("(a b)");
  const listId = first(root).id();
  const aId = first(first(root)).id();
  let changed = applyLispCommand(root, aId, { type: "insertSibling", offset: 1 });
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "paste", text: "(c d)" }).root;
  expect(exportStructuredLisp(root)).toBe("(a (c d) b)");
  root = applyLispCommand(root, aId, { type: "move", offset: 1 }).root;
  expect(exportStructuredLisp(root)).toBe("((c d) a b)");
  root = applyLispCommand(root, aId, { type: "remove" }).root;
  expect(exportStructuredLisp(root)).toBe("((c d) b)");
  changed = applyLispCommand(root, listId, { type: "add" });
  expect(inspectLispSelection(changed.root, changed.selectedNode).kind).toBe("slot");
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "replace", kind: "boolean" }).root;
  expect(exportStructuredLisp(root)).toBe("((c d) b #f)");
  expect(() => applyLispCommand(root, first(root), { type: "paste", text: "a b" })).toThrow(/one form/);
  root = applyLispCommand(root, root, { type: "paste", text: "; new\n1 2" }).root;
  expect(readLisp(exportStructuredLisp(root))).toEqual(readLisp("; new\n1 2"));
  root = applyLispCommand(root, root, { type: "clear" }).root;
  expect(exportStructuredLisp(root)).toBe("");
});

test("dotted tails have one editable operand and stay last when adding list entries", () => {
  let root = createStructuredLisp("(a)");
  const listId = first(root).id();
  expect(inspectLispSelection(root, listId).canAddTail).toBe(true);
  let changed = applyLispCommand(root, listId, { type: "addTail" });
  expect(structuredLispStatus(changed.root).complete).toBe(false);
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "setText", text: "rest" }).root;
  expect(exportStructuredLisp(root)).toBe("(a . rest)");
  changed = applyLispCommand(root, listId, { type: "add" });
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "setText", text: "b" }).root;
  expect(exportStructuredLisp(root)).toBe("(a b . rest)");
  expect(inspectLispSelection(root, listId)).toMatchObject({ canAddTail: false, canRemoveTail: true });
  const tail = kindNodes(root, "dotted-tail")[0];
  expect(() => applyLispCommand(root, tail, { type: "move", offset: -1 })).toThrow();
  root = applyLispCommand(root, tail, { type: "removeTail" }).root;
  expect(exportStructuredLisp(root)).toBe("(a b)");
});

test("bytevector slots accept bounded exact numbers and comments rather than arbitrary data", () => {
  let root = createStructuredLisp("#u8(1)");
  const bytevector = first(root);
  const changed = applyLispCommand(root, bytevector, { type: "add" });
  expect(inspectLispSelection(changed.root, changed.selectedNode)).toMatchObject({ expected: "byte", allowedKinds: ["number", "comment", "block-comment", "datum-comment", "slot"] });
  expect(() => applyLispCommand(changed.root, changed.selectedNode, { type: "replace", kind: "string" })).toThrow(/does not accept/);
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "setText", text: "256" }).root;
  expect(inspectLispSelection(root, changed.selectedNode).kind).toBe("number");
  expect(() => exportStructuredLisp(root)).toThrow(/0 to 255/);
  root = applyLispCommand(root, changed.selectedNode, { type: "setText", text: "#xFF" }).root;
  expect(exportStructuredLisp(root)).toBe("#u8(1 #xFF)");
});

test("keyboard targets traverse semantic children and comments without exposing organizing buds", () => {
  const root = createStructuredLisp("; lead\n'(a b) c");
  const quote = kindNodes(root, "quote")[0];
  const list = kindNodes(root, "list")[0];
  const a = first(list);
  const b = forward(a);
  expect(lispKeyboardTarget(root, root, "enter")).toBe(quote);
  expect(lispKeyboardTarget(root, quote, "enter")).toBe(list);
  expect(lispKeyboardTarget(root, a, "next")).toBe(b);
  expect(lispKeyboardTarget(root, b, "previous")).toBe(a);
  expect(lispKeyboardTarget(root, a, "container")).toBe(list);
  expect(lispKeyboardTarget(root, a, "enter")).toBeNull();
});

test("direct Scheme rows contain only forms and shrink once per nesting boundary", () => {
  const root = createStructuredLisp("(a (b c))");
  expect(inward(root).scale()).toBe(SHRINK_SCALE);
  expect(inward(first(root)).scale()).toBe(SHRINK_SCALE);
  expect(kindNodes(root, "entry")).toHaveLength(0);
  expect(kindNodes(root, "line")).toHaveLength(0);
  expect(graphNodes(root)).toHaveLength(6);
  for (const node of graphNodes(root).filter((node) => node !== root)) {
    expect(node.nodeFit()).toBe(Fit.EXACT);
    expect(node.separationFit(Direction.DOWNWARD)).toBe(Fit.LOOSE);
    expect(node.separationFit(Direction.FORWARD)).toBe(Fit.EXACT);
    if (node.neighbors().hasChild(Direction.FORWARD)) {
      expect(node.neighbors().getAlignment(Direction.FORWARD)).toBe(Alignment.NONE);
    }
  }
});

test("semantic rebuilds preserve visual adjustments, explicit focus, and document metadata through history", () => {
  let root = createStructuredLisp("(a b)");
  const list = first(root);
  const a = first(list);
  new DirectionCaret(a).tighten();
  list.setScale(0.5);
  a.setScale(0.6); a.setNodeFit(Fit.EXACT); a.setFocus();
  root.setFocus(Direction.INWARD);
  documentState(root).metadata.other = { retained: true };
  const stack = new GraphStack();
  stack.save(root, a);
  root = roundTrip(root);
  const changed = applyLispCommand(root, a.id(), { type: "setText", text: "updated" });
  stack.save(changed.root, changed.selectedNode);
  stack.undo();
  expect(exportStructuredLisp(stack.widget())).toBe("(a b)");
  stack.redo();
  root = roundTrip(stack.widget());
  expect(exportStructuredLisp(root)).toBe("(updated b)");
  expect(root.focusDirections()).toEqual([Direction.INWARD]);
  expect(first(first(root)).focusDirections()).toEqual([]);
  expect(first(first(root)).scale()).toBe(0.6);
  expect(first(root).scale()).toBe(0.5);
  expect(inward(first(root)).separationFit(Direction.DOWNWARD)).toBe(Fit.EXACT);
  expect(documentState(root).metadata.other).toEqual({ retained: true });
});

test("invalid graph connections and metadata fail without silently losing content", () => {
  const root = createStructuredLisp("1");
  root.connect(Direction.DOWNWARD, new DirectionNode("hidden"));
  expect(structuredLispStatus(root)).toMatchObject({ validStructure: false, complete: false });
  expect(() => exportStructuredLisp(root)).toThrow(/Unexpected connection/);
  expect(() => applyLispCommand(root, root, { type: "clear" })).toThrow(/Unexpected connection/);
  const bad = createStructuredLisp("1");
  documentState(bad).metadata.freeform.structuredLisp.version = 2;
  expect(isStructuredLisp(bad)).toBe(true);
  expect(() => exportStructuredLisp(bad)).toThrow(/Unsupported/);
});

test("failed source paste leaves the original graph and its spelling untouched", () => {
  const root = createStructuredLisp("#e#xA");
  const before = writeGraph(root);
  expect(() => applyLispCommand(root, first(root), { type: "paste", text: "(broken" })).toThrow(/Unclosed/);
  expect(writeGraph(root)).toEqual(before);
});

test.each([
  "\t\r\n(define (f x)\r\n\t(+ x 1))\r\n\r\n(f 2)  ",
  "' \t#; skipped\n kept  ",
  "(a . #| note |# b ; last\r\n  )\t",
  "(a)(b)\"c\"d", "(\t\n )", "; EOF without a final newline", " \r\n\t",
])("source-line drafts preserve exact intertoken whitespace: %j", (source) => {
  const root = createStructuredLisp(source);
  expect(exportStructuredLisp(root)).toBe(source);
  expect(exportStructuredLisp(roundTrip(root))).toBe(source);
});

test("forms link directly across a row and row starts link vertically", () => {
  const root = createStructuredLisp("(alpha beta\n gamma delta)");
  const list = first(root);
  const alpha = inward(list);
  const beta = forward(alpha);
  const gamma = down(alpha);
  const delta = forward(gamma);
  expect([alpha, beta, gamma, delta].map((node) => node.value())).toEqual(["alpha", "beta", "gamma", "delta"]);
  expect(inspectLispSelection(root, alpha).nodeId).toBe(alpha.id());
  const job = new CommitLayout(root, { size: (node, out) => {
    out[0] = Math.max(6, String(node.value() || "").length * 6); out[1] = 10;
  } }, DEFAULT_LAYOUT_DIRECTION);
  let steps = 0;
  while (job.crank()) expect(++steps).toBeLessThan(10000);
  expect(alpha.layout().absoluteY()).toBeCloseTo(beta.layout().absoluteY());
  expect(gamma.layout().absoluteY()).toBeCloseTo(delta.layout().absoluteY());
  expect(beta.layout().absoluteX()).toBeGreaterThan(alpha.layout().absoluteX());
  expect(gamma.layout().absoluteY()).toBeGreaterThan(alpha.layout().absoluteY());
  expect(alpha.layout().absoluteScale()).toBeCloseTo(SHRINK_SCALE ** 2);
  expect(beta.layout().absoluteScale()).toBeCloseTo(alpha.layout().absoluteScale());
  expect(gamma.layout().absoluteScale()).toBeCloseTo(alpha.layout().absoluteScale());
});

test("direct rows keep differently sized nested forms separate with a straight row baseline", () => {
  const root = createStructuredLisp('(alpha (child "wide string"\n #| taller\n block |#) omega\n (next longer) tail\n last)');
  const list = first(root);
  const a = first(list);
  const nested = forward(a);
  const omega = forward(nested);
  const next = down(a);
  const tail = forward(next);
  const last = down(next);
  commit(root);
  expect([a, nested, omega].map((node) => node.layout().absoluteY()))
    .toEqual([a, a, a].map((node) => node.layout().absoluteY()));
  expect(next.layout().absoluteY()).toBeCloseTo(tail.layout().absoluteY());
  expect(next.layout().absoluteY()).toBeGreaterThan(a.layout().absoluteY());
  expect(last.layout().absoluteY()).toBeGreaterThan(next.layout().absoluteY());
  const forms = [a, nested, omega, next, tail, last];
  for (let i = 0; i < forms.length; i++) for (let j = i + 1; j < forms.length; j++) {
    const left = forms[i].layout(), right = forms[j].layout();
    const leftSize = [], rightSize = [];
    left.absoluteSize(leftSize); right.absoluteSize(rightSize);
    const xGap = Math.abs(left.absoluteX() - right.absoluteX()) - (leftSize[0] + rightSize[0]) / 2;
    const yGap = Math.abs(left.absoluteY() - right.absoluteY()) - (leftSize[1] + rightSize[1]) / 2;
    expect(Math.max(xGap, yGap)).toBeGreaterThanOrEqual(-0.00001);
  }
  expect(first(nested).layout().absoluteScale()).toBeCloseTo(SHRINK_SCALE ** 3);
  expect(graphNodes(root).every((node) => node.value() !== undefined)).toBe(true);
});

test("splitting, joining, reordering, and removing row starts preserve surviving form sizes", () => {
  let root = createStructuredLisp("a b\nc d\ne");
  root.setScale(0.8);
  const a = first(root), b = forward(a), c = down(a), d = forward(c), e = down(c);
  a.setScale(0.5); b.setScale(0.7); d.setScale(0.9); e.setScale(1.2);
  const sizes = absoluteScales(root);
  const check = () => {
    for (const [id, scale] of absoluteScales(root)) expect(scale).toBeCloseTo(sizes.get(id));
    expect(exportStructuredLisp(roundTrip(root))).toBe(exportStructuredLisp(root));
  };
  root = applyLispCommand(root, b.id(), { type: "setLineBreak", enabled: true }).root; check();
  root = applyLispCommand(root, b.id(), { type: "setLineBreak", enabled: false }).root; check();
  root = applyLispCommand(root, a.id(), { type: "move", offset: 1 }).root; check();
  root = applyLispCommand(root, b.id(), { type: "remove" }).root; check();
  expect(exportStructuredLisp(root)).toBe("a\nc d\ne");
});

test("only the first form of a row may link downward and root cannot carry sibling links", () => {
  let root = createStructuredLisp("a b\nc");
  const a = first(root), b = forward(a), c = down(a);
  a.disconnect(Direction.DOWNWARD);
  b.connect(Direction.DOWNWARD, c);
  expect(() => exportStructuredLisp(root)).toThrow(/Unexpected connection/);
  root = createStructuredLisp("a\nb");
  documentState(root).metadata.freeform.structuredLisp.nodes[down(first(root)).id()].leading = " ";
  expect(() => exportStructuredLisp(root)).toThrow(/grouping/);
  root = createStructuredLisp("a b");
  const second = forward(first(root));
  first(root).disconnect(Direction.FORWARD);
  root.connect(Direction.FORWARD, second);
  expect(() => exportStructuredLisp(root)).toThrow(/Unexpected connection/);
});

test("line changes and native history preserve unrelated blank lines, IDs, and row settings", () => {
  const source = "(a b\r\n\r\n\t c)\r\n\r\nlast\t";
  let root = createStructuredLisp(source);
  const list = first(root);
  const line = inward(list);
  const b = kindNodes(root, "symbol").find((node) => node.value() === "b");
  const c = kindNodes(root, "symbol").find((node) => node.value() === "c");
  const ids = [b.id(), c.id()];
  line.setScale(0.5);
  new DirectionCaret(line).tighten();
  const stack = new GraphStack();
  stack.save(root, b);
  root = applyLispCommand(root, b, { type: "setLineBreak", enabled: true }).root;
  expect(exportStructuredLisp(root)).toBe("(a\r\n b\r\n\r\n\t c)\r\n\r\nlast\t");
  expect(inspectLispSelection(root, b.id())).toMatchObject({ startsLine: true, canBreakLine: true, canJoinLine: true });
  expect(inward(first(root)).id()).toBe(line.id());
  expect(inward(first(root)).scale()).toBe(0.5);
  expect(inward(first(root)).separationFit(Direction.DOWNWARD)).toBe(Fit.EXACT);
  stack.save(root, graphNodes(root).find((node) => node.id() === b.id()));
  stack.undo();
  expect(exportStructuredLisp(stack.widget())).toBe(source);
  stack.redo();
  root = roundTrip(stack.widget());
  root = applyLispCommand(root, b.id(), { type: "setLineBreak", enabled: false }).root;
  expect(exportStructuredLisp(root)).toBe(source);
  expect(ids.every((id) => graphNodes(root).some((node) => node.id() === id))).toBe(true);
});

test("new sibling lines split the current row while comment boundaries cannot be joined", () => {
  let root = createStructuredLisp("(a b ; note\n c)");
  const b = kindNodes(root, "symbol").find((node) => node.value() === "b");
  let changed = applyLispCommand(root, b, { type: "insertSibling", newline: true });
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "setText", text: "next" }).root;
  expect(exportStructuredLisp(root)).toBe("(a b\nnext ; note\n c)");
  const c = kindNodes(root, "symbol").find((node) => node.value() === "c");
  expect(inspectLispSelection(root, c)).toMatchObject({ startsLine: true, canJoinLine: false });
  expect(() => applyLispCommand(root, c, { type: "setLineBreak", enabled: false })).toThrow(/line comment/);
  const comment = kindNodes(root, "comment")[0];
  changed = applyLispCommand(root, comment, { type: "insertSibling" });
  root = applyLispCommand(changed.root, changed.selectedNode, { type: "setText", text: "safe" }).root;
  expect(exportStructuredLisp(root)).toBe("(a b\nnext ; note\n safe\n c)");
});

test.each([
  ["(a\r\n\t(display value)\r\n\tbody)", "(a\r\n\tbody)"],
  ["(a\r\n\t(display value) same\r\nnext)", "(a\r\n\tsame\r\nnext)"],
  ["(a\r\n\t(display value))", "(a)"],
  ["(a\r\n\t(display value)\r\n)", "(a\r\n)"],
  ["(a\r\n\t(display value)\r\n\r\n\tbody)\r\n\r\nlast", "(a\r\n\r\n\tbody)\r\n\r\nlast"],
])("removing a source row preserves the next row's boundary: %j", (source, expected) => {
  const root = createStructuredLisp(source);
  const debug = graphNodes(root).find((node) => inspectLispSelection(root, node).path === "$[0][1]");
  const changed = applyLispCommand(root, debug, { type: "remove" });
  expect(exportStructuredLisp(changed.root)).toBe(expected);
  expect(exportStructuredLisp(roundTrip(changed.root))).toBe(expected);
});

test("edits preserve valid adjacency and add only lexically necessary boundaries", () => {
  const examples = [
    ["(a)(b)", "list", 0, { type: "replace", kind: "symbol", text: "x" }, "x(b)"],
    ["(a)(b)", "list", 1, { type: "replace", kind: "symbol", text: "x" }, "(a)x"],
    ['"a"b', "string", 0, { type: "replace", kind: "symbol", text: "x" }, "x b"],
    ["(a .(b))", "list", 1, { type: "replace", kind: "symbol", text: "tail" }, "(a . tail)"],
    [",x", "symbol", 0, { type: "setText", text: "@x" }, ", @x"],
    ["(a)'b", "list", 0, { type: "replace", kind: "symbol", text: "x" }, "x 'b"],
    ['"a"b', "string", 0, { type: "replace", kind: "character", text: "#\\)" }, "#\\) b"],
    ['"a"b', "string", 0, { type: "replace", kind: "character", text: "#\\ " }, "#\\  b"],
    ["'(a)b", "list", 0, { type: "replace", kind: "symbol", text: "x" }, "'x b"],
  ];
  for (const [source, kind, index, command, expected] of examples) {
    const root = createStructuredLisp(source);
    const targets = kindNodes(root, kind).sort((a, b) =>
      inspectLispSelection(root, a).path.localeCompare(inspectLispSelection(root, b).path));
    const changed = applyLispCommand(root, targets[index], command).root;
    expect(exportStructuredLisp(changed)).toBe(expected);
    expect(() => createStructuredLisp(exportStructuredLisp(changed))).not.toThrow();
  }
});

test("new line comments terminate before closing containers and recursive dotted tails", () => {
  const root = createStructuredLisp("(a . b)");
  const b = kindNodes(root, "symbol").find((node) => node.value() === "b");
  const changed = applyLispCommand(root, b, { type: "replace", kind: "comment", text: "; pending" }).root;
  // The prefix still needs an actual operand, but the graph records a safe
  // closing boundary even while it is an incomplete native draft.
  const list = first(changed);
  expect(documentState(changed).metadata.freeform.structuredLisp.nodes[list.id()].trailing).toBe("\n");
  expect(structuredLispStatus(changed).complete).toBe(false);
  const plain = createStructuredLisp("(a b)");
  const last = kindNodes(plain, "symbol").find((node) => node.value() === "b");
  expect(exportStructuredLisp(applyLispCommand(plain, last, {
    type: "replace", kind: "comment", text: "; end",
  }).root)).toBe("(a ; end\n)");
});

test("native row metadata rejects unknown layouts, mismatched groups, and unsafe token boundaries", () => {
  let root = createStructuredLisp("a b");
  let metadata = documentState(root).metadata.freeform.structuredLisp;
  metadata.layout = "future-layout";
  expect(() => exportStructuredLisp(root)).toThrow(/Unsupported.*layout/);
  root = createStructuredLisp("a b");
  metadata = documentState(root).metadata.freeform.structuredLisp;
  const second = forward(first(root));
  metadata.nodes[second.id()].leading = "\n";
  expect(structuredLispStatus(root).validStructure).toBe(false);
  metadata.nodes[second.id()].leading = "";
  expect(structuredLispStatus(root)).toMatchObject({ validStructure: true, complete: false });
  expect(() => exportStructuredLisp(root)).toThrow(/separating space/);
  root = createStructuredLisp("(a ; last\n)");
  metadata = documentState(root).metadata.freeform.structuredLisp;
  metadata.nodes[first(root).id()].trailing = "";
  expect(() => exportStructuredLisp(root)).toThrow(/closing parenthesis/);
});

test("legacy vertical drafts migrate to direct forms while preserving effective sizes and containment settings", () => {
  const root = new DirectionNode("Scheme"); root.setId("document");
  const a = new DirectionNode("a"); a.setId("a");
  const b = new DirectionNode("b"); b.setId("b");
  const firstBud = new DirectionNode(); firstBud.setId("entry-a");
  const secondBud = new DirectionNode(); secondBud.setId("entry-b");
  root.connect(Direction.INWARD, firstBud);
  root.neighbors().align(Direction.INWARD, Alignment.INWARD_VERTICAL);
  root.neighbors().setAxisOverlap(Direction.INWARD, AxisOverlap.PREVENTED);
  firstBud.connect(Direction.FORWARD, a); firstBud.connect(Direction.DOWNWARD, secondBud);
  secondBud.connect(Direction.FORWARD, b);
  for (const bud of [firstBud, secondBud]) {
    bud.setNodeFit(Fit.EXACT);
    const caret = new DirectionCaret(bud); caret.pull(Direction.FORWARD); caret.loosen();
  }
  firstBud.setScale(0.5);
  new DirectionCaret(firstBud).tighten();
  firstBud.setSeparationFit(Direction.FORWARD, Fit.LOOSE);
  firstBud.neighbors().align(Direction.FORWARD, Alignment.POSITIVE);
  firstBud.setFocus(Direction.FORWARD);
  a.setScale(0.7); a.setNodeFit(Fit.LOOSE); a.setFocus(Direction.FORWARD);
  Object.defineProperty(root, Symbol.for("parsegraph.freeform.document"), { value: {
    version: 1, capabilities: {}, metadata: { freeform: { structuredLisp: {
      version: 1, innerScale: SHRINK_SCALE, nodes: {
        document: { kind: "document" }, a: { kind: "symbol" }, b: { kind: "symbol" },
        "entry-a": { kind: "entry" }, "entry-b": { kind: "entry" },
      },
    } } },
  } });
  expect(exportStructuredLisp(root)).toBe("a\nb");
  const changed = applyLispCommand(roundTrip(root), "a", { type: "setText", text: "updated" }).root;
  expect(documentState(changed).metadata.freeform.structuredLisp.layout).toBe("direct-source-lines");
  expect(changed.neighbors().getAlignment(Direction.INWARD)).toBe(Alignment.INWARD_VERTICAL);
  expect(changed.neighbors().axisOverlap(Direction.INWARD)).toBe(AxisOverlap.PREVENTED);
  expect(exportStructuredLisp(changed)).toBe("updated\nb");
  const migrated = inward(changed);
  expect(graphNodes(changed).map((node) => node.id()).sort()).toEqual(["a", "b", "document"]);
  expect(migrated.id()).toBe("a");
  expect(down(migrated).id()).toBe("b");
  expect(migrated.scale()).toBeCloseTo(0.35);
  expect(migrated.scale() * down(migrated).scale()).toBeCloseTo(0.5);
  expect(migrated.nodeFit()).toBe(Fit.LOOSE);
  expect(migrated.separationFit(Direction.DOWNWARD)).toBe(Fit.LOOSE);
  expect(migrated.focusDirections()).toEqual([Direction.FORWARD]);
  expect(migrated.siblings().layoutOrder().indexOf(Direction.FORWARD))
    .toBeLessThan(migrated.siblings().layoutOrder().indexOf(Direction.DOWNWARD));
  expect(migrated.paintGroups().isPaintGroup()).toBe(true);
  expect(exportStructuredLisp(roundTrip(changed))).toBe("updated\nb");
});

function sourceLineDraft() {
  const role = (id, text) => { const node = new DirectionNode(text); node.setId(id); return node; };
  const root = role("document", "Scheme");
  const row = role("row"), nextRow = role("next-row");
  const entryA = role("entry-a"), entryB = role("entry-b"), entryC = role("entry-c");
  const a = role("a", "a"), b = role("b", "b"), c = role("c", "c");
  root.connect(Direction.INWARD, row);
  row.connect(Direction.FORWARD, entryA); row.connect(Direction.DOWNWARD, nextRow);
  entryA.connect(Direction.DOWNWARD, a); entryA.connect(Direction.FORWARD, entryB);
  entryB.connect(Direction.DOWNWARD, b);
  nextRow.connect(Direction.FORWARD, entryC); entryC.connect(Direction.DOWNWARD, c);
  row.setScale(0.5); a.setScale(0.6); entryB.setScale(0.9); nextRow.setScale(0.7); c.setScale(1.3);
  row.paintGroups().crease();
  root.neighbors().align(Direction.INWARD, Alignment.INWARD_VERTICAL);
  root.neighbors().setAxisOverlap(Direction.INWARD, AxisOverlap.PREVENTED);
  Object.defineProperty(root, Symbol.for("parsegraph.freeform.document"), { value: {
    version: 1, capabilities: {}, metadata: { retained: "yes", freeform: { structuredLisp: {
      version: 1, layout: "source-lines", innerScale: SHRINK_SCALE, nodes: {
        document: { kind: "document", trailing: "\r\n" },
        row: { kind: "line" }, "next-row": { kind: "line" },
        "entry-a": { kind: "entry", leading: "\t" },
        "entry-b": { kind: "entry", leading: "  " },
        "entry-c": { kind: "entry", leading: "\r\n\r\n " },
        a: { kind: "symbol" }, b: { kind: "symbol" }, c: { kind: "symbol" },
      },
    } } },
  } });
  return { root, row, entryB };
}

test("source-line migration removes organizing buds while preserving exact source, selection, scaling, and history", () => {
  const { root, entryB } = sourceLineDraft();
  const source = "\ta  b\r\n\r\n c\r\n";
  expect(exportStructuredLisp(root)).toBe(source);
  const sizes = absoluteScales(root);
  const original = writeGraph(root);
  const migrated = upgradeLispLayout(root, entryB.id());
  expect(writeGraph(root)).toEqual(original);
  expect(migrated.selectedNode.id()).toBe("b");
  expect(exportStructuredLisp(migrated.root)).toBe(source);
  expect(graphNodes(migrated.root)).toHaveLength(4);
  for (const [id, scale] of absoluteScales(migrated.root)) expect(scale).toBeCloseTo(sizes.get(id));
  expect(first(migrated.root).paintGroups().isPaintGroup()).toBe(true);
  expect(first(migrated.root).separationFit(Direction.DOWNWARD)).toBe(Fit.LOOSE);
  expect(migrated.root.neighbors().getAlignment(Direction.INWARD)).toBe(Alignment.INWARD_VERTICAL);
  expect(migrated.root.neighbors().axisOverlap(Direction.INWARD)).toBe(AxisOverlap.PREVENTED);
  expect(documentState(migrated.root).metadata.retained).toBe("yes");
  expect(upgradeLispLayout(root, "missing-selection").selectedNode.id()).toBe(root.id());
  const stack = new GraphStack();
  stack.save(migrated.root, migrated.selectedNode);
  const edited = applyLispCommand(migrated.root, migrated.selectedNode, { type: "setText", text: "changed" });
  expect(first(edited.root).paintGroups().isPaintGroup()).toBe(true);
  stack.save(edited.root, edited.selectedNode);
  stack.undo();
  expect(exportStructuredLisp(stack.widget())).toBe(source);
  expect(graphNodes(stack.widget())).toHaveLength(4);
  stack.redo();
  expect(exportStructuredLisp(roundTrip(stack.widget()))).toBe(source.replace("b", "changed"));
});

test("opening migration preserves unsafe separators as diagnostics and skips current or ordinary graphs", () => {
  const { root, entryB } = sourceLineDraft();
  documentState(root).metadata.freeform.structuredLisp.nodes[entryB.id()].leading = "";
  const migrated = upgradeLispLayout(root, entryB);
  expect(structuredLispStatus(migrated.root)).toMatchObject({ validStructure: true, complete: false });
  expect(() => exportStructuredLisp(migrated.root)).toThrow(/separating space/);
  const current = createStructuredLisp("a b");
  const selected = forward(first(current));
  expect(upgradeLispLayout(current, selected)).toEqual({ root: current, selectedNode: selected });
  expect(upgradeLispLayout(current, selected.id()).selectedNode).toBe(selected);
  const ordinary = new DirectionNode("ordinary");
  expect(upgradeLispLayout(ordinary)).toEqual({ root: ordinary, selectedNode: ordinary });
});
