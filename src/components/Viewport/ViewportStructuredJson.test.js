import { Direction, DirectionNode } from "parsegraph";
import Color from "parsegraph-color";
import Viewport from "./Viewport";
import GraphStack from "../../GraphStack";
import { graphNodes, readGraph, writeGraph } from "../../graphDocument";
import { createStructuredJson, exportStructuredJson, inspectJsonSelection } from "../../structuredJson";

function editor(root) {
  const viewport = new Viewport();
  viewport.scheduleRepaint = jest.fn();
  viewport._rendering = {
    resetSettings: jest.fn(),
    pageBackgroundColor: () => new Color(0.2, 0.2, 0.9, 1),
    setPageBackgroundColor: jest.fn(),
    showingUI: () => true,
    showUI: jest.fn(),
    hideUI: jest.fn(),
  };
  viewport.camera().setSize(800, 600);
  viewport.show(root);
  const history = new GraphStack();
  history.save(root, root, viewport.toJSON());
  viewport.setSaveGraph((graph, node) => history.save(graph, node, viewport.toJSON()));
  return { viewport, history };
}

test("directional edits cannot create untyped connections in a JSON document", () => {
  const { viewport, history } = editor(createStructuredJson(1));
  viewport.spawnMove(Direction.FORWARD);
  expect(graphNodes(viewport.widget())).toHaveLength(1);
  expect(history.undoCount()).toBe(0);
  expect(exportStructuredJson(viewport.widget())).toBe(1);
  const freeform = editor(new DirectionNode("ordinary"));
  freeform.viewport.spawnMove(Direction.FORWARD);
  expect(graphNodes(freeform.viewport.widget())).toHaveLength(2);
});

test("keyboard deletion clears required member values but removes array entries", () => {
  const { viewport, history } = editor(createStructuredJson({ volume: 5 }));
  const value = graphNodes(viewport.widget()).find((node) => node.value() === "5");
  viewport.selectNode(value);
  viewport.removeNode();
  expect(inspectJsonSelection(viewport.widget(), viewport.node()).kind).toBe("slot");
  expect(graphNodes(viewport.widget()).some((node) => node.value() === '"volume"')).toBe(true);
  expect(history.undoCount()).toBe(1);
  history.undo();
  expect(exportStructuredJson(history.widget())).toEqual({ volume: 5 });
  const array = editor(createStructuredJson([1, 2]));
  array.viewport.selectNode(graphNodes(array.viewport.widget()).find((node) => node.value() === "1"));
  array.viewport.removeNode();
  expect(exportStructuredJson(array.viewport.widget())).toEqual([2]);
});

test("a targeted text draft preserves selection, camera, styles, and one atomic undo", () => {
  const { viewport, history } = editor(createStructuredJson({ volume: 5 }));
  const nodes = graphNodes(viewport.widget());
  const key = nodes.find((node) => node.value() === '"volume"');
  const value = nodes.find((node) => node.value() === "5");
  viewport.selectNode(key);
  viewport.updateNodeStyle(value, { backgroundColor: "#abc123" });
  viewport.camera().setOrigin(42, -27);
  viewport.camera().setScale(0.7);
  const before = viewport.camera().toJSON();
  viewport.applyStructuredCommand({ type: "setText", text: "-" }, value.id());
  expect(viewport.node().id()).toBe(key.id());
  expect(viewport.camera().toJSON()).toEqual(before);
  expect(history.undoCount()).toBe(1);
  const saved = writeGraph(viewport.widget(), viewport.node(), viewport.toJSON(), 1);
  expect(saved.capabilities["appearance/1"].nodeStyles[value.id()].backgroundColor).toBe("#abc123");
  const restored = readGraph(saved);
  expect(inspectJsonSelection(restored, value.id())).toMatchObject({ text: "-", isSlot: true });
  history.undo();
  expect(exportStructuredJson(history.widget())).toEqual({ volume: 5 });
});

test("raw label editing is routed through the grammar and preserves empty strings", () => {
  const { viewport } = editor(createStructuredJson("text"));
  viewport._editor = { value: "" };
  viewport.applyEditorValue();
  expect(exportStructuredJson(viewport.widget())).toBe("");
  expect(viewport.node().value()).toBe('""');
});

test("selection observers are not notified again by ordinary redraws", () => {
  const { viewport } = editor(createStructuredJson([1]));
  const listener = jest.fn();
  viewport.setOnDocumentChange(listener);
  viewport.repaint();
  viewport.refresh();
  expect(listener).toHaveBeenCalledTimes(1);
  viewport.moveToNeighbor(Direction.INWARD);
  expect(listener).toHaveBeenCalledTimes(2);
});
