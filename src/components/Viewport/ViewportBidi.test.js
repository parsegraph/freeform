import {
  Bidi,
  CommitLayout,
  Direction,
  DirectionCaret,
  DirectionNode,
  LayoutOperation,
} from "parsegraph";
import Viewport from "./Viewport";
import ViewportRendering from "./ViewportRendering";
import GraphStack from "../../GraphStack";
import { graphNodes, readGraph, writeGraph } from "../../graphDocument";
import { resolveNodeDirection } from "../../graphDirection";
import {
  applyJsonCommand,
  createStructuredJson,
  exportStructuredJson,
} from "../../structuredJson";
import {
  applyLispCommand,
  createStructuredLisp,
  exportStructuredLisp,
} from "../../structuredLisp";

function editor(root, selected = root) {
  const viewport = new Viewport();
  viewport._userCaret = new DirectionCaret(root);
  viewport._userCaret.moveTo(selected);
  viewport.scheduleRender = jest.fn();
  viewport.camera().setSize(800, 600);
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = viewport;
  renderer._revision = 0;
  renderer._steps = [];
  renderer._phase = 0;
  renderer.createLayout = () =>
    new CommitLayout(
      viewport.widget(),
      {
        size: (node, out) => {
          out[0] = 30;
          out[1] = 20;
        },
        getSeparation: () => 10,
      },
      Bidi.LTR
    );
  viewport._rendering = renderer;
  const history = new GraphStack();
  history.save(root, selected);
  const save = jest.fn((graph, node) => history.save(graph, node));
  viewport.setSaveGraph(save);
  const changed = jest.fn();
  viewport.setOnDocumentChange(changed);
  changed.mockClear();
  return { viewport, renderer, history, save, changed };
}

function finish(renderer) {
  let steps = 0;
  while (renderer.paint() !== LayoutOperation.DONE)
    expect(++steps).toBeLessThan(1000);
  expect(renderer.layoutReady()).toBe(true);
}

test("direction resolution follows current declarations instead of stale layout and preserves inheritance", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("inherited");
  const explicit = new DirectionNode("explicit");
  root.connect(Direction.FORWARD, child);
  child.connect(Direction.DOWNWARD, explicit);
  explicit.setBidi(Bidi.LTR);
  const { renderer } = editor(root);
  finish(renderer);
  expect(child.effectiveBidi()).toBe(Bidi.LTR);
  root.setBidi(Bidi.RTL);
  expect(resolveNodeDirection(child)).toBe(Bidi.RTL);
  expect(resolveNodeDirection(explicit)).toBe(Bidi.LTR);
  expect(child.bidi()).toBe(Bidi.INHERIT);
  root.setBidi(Bidi.INHERIT);
  expect(resolveNodeDirection(child)).toBe(Bidi.LTR);
  expect(resolveNodeDirection(child, Bidi.RTL)).toBe(Bidi.RTL);
  expect(resolveNodeDirection(undefined)).toBeUndefined();
  expect(() => resolveNodeDirection(child, Bidi.INHERIT)).toThrow(
    /surrounding/
  );
});

test("changing direction relayouts inheriting descendants without changing connections or selection", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  const nested = new DirectionNode("nested LTR");
  const leaf = new DirectionNode("leaf");
  root.connect(Direction.FORWARD, child);
  child.connect(Direction.DOWNWARD, nested);
  nested.connect(Direction.FORWARD, leaf);
  nested.setBidi(Bidi.LTR);
  const { viewport, renderer, history, save, changed } = editor(root);
  const ids = graphNodes(root)
    .map((node) => node.id())
    .sort();
  finish(renderer);
  expect(child.layout().absoluteX()).toBeGreaterThan(root.layout().absoluteX());
  const revision = renderer._revision;
  expect(viewport.setNodeBidi(Bidi.RTL)).toBe(true);
  expect(renderer._revision).toBe(revision + 1);
  expect(renderer.layoutReady()).toBe(false);
  expect(viewport.node()).toBe(root);
  expect(save).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(history.undoCount()).toBe(1);
  expect(viewport.scheduleRender).toHaveBeenCalledTimes(1);
  finish(renderer);
  expect(child.layout().absoluteX()).toBeLessThan(root.layout().absoluteX());
  expect(leaf.layout().absoluteX()).toBeGreaterThan(
    nested.layout().absoluteX()
  );
  expect(root.neighbors().nodeAt(Direction.FORWARD)).toBe(child);
  expect(child.neighbors().nodeAt(Direction.DOWNWARD)).toBe(nested);
  expect(
    graphNodes(root)
      .map((node) => node.id())
      .sort()
  ).toEqual(ids);
  expect(child.bidi()).toBe(Bidi.INHERIT);
  expect(nested.bidi()).toBe(Bidi.LTR);
  const restored = readGraph(writeGraph(root, root));
  expect(restored.bidi()).toBe(Bidi.RTL);
  history.undo();
  expect(history.widget().bidi()).toBe(Bidi.INHERIT);
  history.redo();
  expect(history.widget().bidi()).toBe(Bidi.RTL);
  expect(history.selectedNode()).toBe(root.id());
  expect(viewport.setNodeBidi(Bidi.INHERIT)).toBe(true);
  finish(renderer);
  expect(child.layout().absoluteX()).toBeGreaterThan(root.layout().absoluteX());
});

test("no-op and invalid directions do not create history or redraws", () => {
  const { viewport, history, save, changed } = editor(new DirectionNode());
  expect(viewport.setNodeBidi(Bidi.INHERIT)).toBe(true);
  expect(() => viewport.setNodeBidi("auto")).toThrow(/Layout direction/);
  expect(save).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(history.undoCount()).toBe(0);
  expect(viewport.scheduleRender).not.toHaveBeenCalled();
  expect(new Viewport().setNodeBidi(Bidi.RTL)).toBe(false);
});

test("rejected inline input prevents a direction change", () => {
  const { viewport, save } = editor(createStructuredJson(5));
  viewport._inlineEditor = {
    active: () => true,
    close: jest.fn(() => false),
    update: jest.fn(),
  };
  expect(viewport.setNodeBidi(Bidi.RTL)).toBe(false);
  expect(viewport._inlineEditor.close).toHaveBeenCalledWith(false);
  expect(viewport.node().bidi()).toBe(Bidi.INHERIT);
  expect(save).not.toHaveBeenCalled();
  expect(viewport.scheduleRender).not.toHaveBeenCalled();
});

test("flushing inline input applies direction to the rebuilt selection", () => {
  const root = createStructuredJson(5);
  const { viewport, renderer } = editor(root);
  renderer.replaceDocumentRoot = jest.fn();
  let active = true;
  viewport._inlineEditor = {
    active: () => active,
    update: jest.fn(),
    close: () => {
      viewport.applyStructuredCommand({ type: "setText", text: "6" });
      active = false;
      return true;
    },
  };
  expect(viewport.setNodeBidi(Bidi.RTL)).toBe(true);
  expect(viewport.widget()).not.toBe(root);
  expect(root.bidi()).toBe(Bidi.INHERIT);
  expect(viewport.node().bidi()).toBe(Bidi.RTL);
  expect(exportStructuredJson(viewport.widget())).toBe(6);
});

test.each([
  [
    "JSON",
    () => createStructuredJson([5]),
    applyJsonCommand,
    exportStructuredJson,
    [6],
  ],
  [
    "Lisp",
    () => createStructuredLisp("(define value 5)"),
    applyLispCommand,
    exportStructuredLisp,
    "(define value 6)",
  ],
])(
  "%s direction survives a subsequent source edit and native restore",
  (_, create, edit, exportSource, expected) => {
    const root = create();
    const selected = graphNodes(root).find((node) => node.value() === "5");
    const { viewport } = editor(root, selected);
    expect(viewport.setNodeBidi(Bidi.RTL)).toBe(true);
    const next = edit(root, selected, { type: "setText", text: "6" });
    expect(next.selectedNode.bidi()).toBe(Bidi.RTL);
    expect(exportSource(next.root)).toEqual(expected);
    const restored = readGraph(writeGraph(next.root, next.selectedNode));
    expect(
      graphNodes(restored)
        .find((node) => node.id() === selected.id())
        .bidi()
    ).toBe(Bidi.RTL);
    expect(exportSource(restored)).toEqual(expected);
  }
);
