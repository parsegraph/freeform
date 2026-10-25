import { fireEvent } from "@testing-library/react";
import { Direction } from "parsegraph";
import Color from "parsegraph-color";
import Viewport from "./Viewport";
import GraphStack from "../../GraphStack";
import { documentState, graphNodes, readGraph, writeGraph } from "../../graphDocument";
import {
  createLispDraft,
  createStructuredLisp,
  exportStructuredLisp,
  inspectLispSelection,
  structuredLispStatus,
} from "../../structuredLisp";
import { lispKindAppearance } from "../../structuredLispAppearance";

const editors = [];
function editor(root = createLispDraft()) {
  const viewport = new Viewport();
  viewport.scheduleRepaint = jest.fn();
  viewport.scheduleRender = jest.fn();
  viewport.attachInput = jest.fn();
  viewport.logMessage = jest.fn();
  viewport._rendering = {
    resetSettings: jest.fn(),
    pageBackgroundColor: () => new Color(0, 0, 0, 1),
    setPageBackgroundColor: jest.fn(),
    showingUI: () => true,
    showUI: jest.fn(),
    hideUI: jest.fn(),
    replaceDocumentRoot: jest.fn(),
  };
  viewport.camera().setSize(800, 600);
  viewport.show(root);
  const container = document.createElement("div");
  container.tabIndex = 0;
  document.body.appendChild(container);
  viewport._container = container;
  const history = new GraphStack();
  history.save(root, root, viewport.toJSON());
  viewport.setSaveGraph((graph, node) => history.save(graph, node, viewport.toJSON()));
  editors.push(viewport);
  return { viewport, history };
}
const press = (viewport, key, options = {}) => viewport.handleStructuredKey({ key, ...options });
const selected = (viewport) => inspectLispSelection(viewport.widget(), viewport.node());
function text(viewport, value) {
  const field = viewport._inlineEditor.element;
  expect(field).toHaveFocus();
  fireEvent.input(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(viewport.container()).toHaveFocus();
}
function pick(viewport, value) {
  viewport.selectNode(graphNodes(viewport.widget()).find((node) => node.value() === value));
}
afterEach(() => {
  editors.splice(0).forEach((viewport) => {
    viewport._inlineEditor?.close(false);
    viewport.container().remove();
  });
});

test("write a nested form entirely with graph keys and inline raw tokens", () => {
  const { viewport } = editor();
  press(viewport, "e");
  expect(selected(viewport).kind).toBe("slot");
  press(viewport, "(");
  press(viewport, "e");
  const symbolId = selected(viewport).nodeId;
  press(viewport, "Enter");
  text(viewport, "define");
  expect(selected(viewport)).toMatchObject({ kind: "symbol", nodeId: symbolId });
  press(viewport, " ");
  press(viewport, "Enter");
  text(viewport, "answer");
  press(viewport, " ");
  press(viewport, "(");
  press(viewport, "e");
  press(viewport, "Enter");
  text(viewport, "+");
  press(viewport, " ");
  press(viewport, "4");
  text(viewport, "40");
  press(viewport, " ");
  press(viewport, "2");
  text(viewport, "2");
  press(viewport, ")");
  press(viewport, ")");
  expect(exportStructuredLisp(viewport.widget())).toBe("(define answer (+ 40 2))");
  expect(viewport.logMessage).not.toHaveBeenCalled();
});

test("i explicitly opens source insertion once while e and Enter keep structural and raw editing", () => {
  const { viewport, history } = editor(createStructuredLisp("(alpha beta)"));
  viewport.showLispSourceInput = jest.fn();
  expect(press(viewport, "i")).toBe(true);
  expect(viewport.showLispSourceInput).toHaveBeenCalledTimes(1);
  expect(press(viewport, "i", { repeat: true })).toBe(true);
  expect(viewport.showLispSourceInput).toHaveBeenCalledTimes(1);
  expect(history.undoCount()).toBe(0);

  press(viewport, "e");
  expect(selected(viewport).kind).toBe("list");
  press(viewport, "e");
  expect(selected(viewport).text).toBe("alpha");
  press(viewport, "l");
  expect(selected(viewport).text).toBe("beta");
  press(viewport, "Enter");
  expect(press(viewport, "i")).toBe(false);
  expect(viewport.showLispSourceInput).toHaveBeenCalledTimes(1);
  text(viewport, "updated");
  expect(exportStructuredLisp(viewport.widget())).toBe("(alpha updated)");
});

test.each(["i", "c", "o", "O"])("%s source insertion needs a graph selection in View mode and respects native input", (key) => {
  const { viewport } = editor(createStructuredLisp("alpha"));
  viewport.showLispSourceInput = jest.fn();
  viewport._rendering.showingUI = () => false;
  viewport.clearNodeSelection();
  expect(press(viewport, key)).toBe(false);
  pick(viewport, "alpha");
  expect(press(viewport, key, { target: document.createElement("textarea") })).toBe(false);
  expect(press(viewport, key, { ctrlKey: true })).toBe(false);
  expect(press(viewport, key, { metaKey: true })).toBe(false);
  expect(press(viewport, key, { isComposing: true })).toBe(false);
  expect(viewport.showLispSourceInput).not.toHaveBeenCalled();
  expect(press(viewport, key)).toBe(true);
  expect(viewport.showLispSourceInput).toHaveBeenCalledTimes(1);
});

test.each([["c", "change"], ["o", "below"], ["O", "above"]])("%s opens %s source entry once", (key, mode) => {
  const { viewport, history } = editor(createStructuredLisp("(alpha beta)"));
  viewport.showLispSourceInput = jest.fn();
  pick(viewport, "alpha");
  expect(press(viewport, key)).toBe(true);
  expect(viewport.showLispSourceInput).toHaveBeenCalledWith({ mode });
  expect(press(viewport, key, { repeat: true })).toBe(true);
  expect(viewport.showLispSourceInput).toHaveBeenCalledTimes(1);
  expect(selected(viewport).text).toBe("alpha");
  expect(history.undoCount()).toBe(0);
});

test("c never clears a container, while slots remain changeable", () => {
  const { viewport, history } = editor();
  viewport.showLispSourceInput = jest.fn();
  expect(press(viewport, "c")).toBe(true);
  expect(viewport.showLispSourceInput).not.toHaveBeenCalled();
  expect(viewport.logMessage).toHaveBeenCalledWith(expect.stringMatching(/token or slot/));
  expect(history.undoCount()).toBe(0);
  press(viewport, "e");
  expect(selected(viewport).kind).toBe("slot");
  expect(press(viewport, "c")).toBe(true);
  expect(viewport.showLispSourceInput).toHaveBeenCalledWith({ mode: "change" });
});

test("q and closing parenthesis retain outward navigation", () => {
  const { viewport } = editor(createStructuredLisp("((alpha))"));
  pick(viewport, "alpha");
  expect(press(viewport, "q")).toBe(true);
  expect(selected(viewport)).toMatchObject({ kind: "list", path: "$[0][0]" });
  expect(press(viewport, ")")).toBe(true);
  expect(selected(viewport)).toMatchObject({ kind: "list", path: "$[0]" });
});

test("comma creates unquote instead of a sibling and prefixes preserve existing content", () => {
  const { viewport, history } = editor(createStructuredLisp("(alpha beta)"));
  pick(viewport, "alpha");
  const before = history.undoCount();
  press(viewport, ",");
  expect(exportStructuredLisp(viewport.widget())).toBe("(,alpha beta)");
  expect(selected(viewport)).toMatchObject({ kind: "symbol", text: "alpha" });
  press(viewport, ",", { repeat: true });
  expect(history.undoCount()).toBe(before + 1);
  press(viewport, "'");
  expect(exportStructuredLisp(viewport.widget())).toBe("(,'alpha beta)");
  press(viewport, "(");
  expect(exportStructuredLisp(viewport.widget())).toBe("(,'(alpha) beta)");
});

test("Space inserts on the same source row and Shift+Enter starts a new row", () => {
  const { viewport, history } = editor(createStructuredLisp("(alpha beta)"));
  pick(viewport, "alpha");
  press(viewport, " ");
  press(viewport, "Enter");
  text(viewport, "same");
  expect(exportStructuredLisp(viewport.widget())).toBe("(alpha same beta)");
  const before = history.undoCount();
  press(viewport, "Enter", { shiftKey: true });
  expect(viewport.showingEditor()).toBe(false);
  expect(selected(viewport).kind).toBe("slot");
  expect(history.undoCount()).toBe(before + 1);
  const nodeCount = graphNodes(viewport.widget()).length;
  press(viewport, "Enter", { shiftKey: true, repeat: true });
  expect(graphNodes(viewport.widget())).toHaveLength(nodeCount);
  expect(history.undoCount()).toBe(before + 1);
  press(viewport, "Enter");
  text(viewport, "next");
  expect(exportStructuredLisp(viewport.widget())).toBe("(alpha same\nnext beta)");
  expect(exportStructuredLisp(readGraph(writeGraph(viewport.widget())))).toBe("(alpha same\nnext beta)");
  history.undo(); // The inserted row's slot remains until its insertion is undone.
  history.undo();
  expect(exportStructuredLisp(history.widget())).toBe("(alpha same beta)");
});

test("horizontal keys follow semantic siblings and vertical keys follow source rows", () => {
  const { viewport, history } = editor(createStructuredLisp("(a b\n c\n d e f)"));
  pick(viewport, "b");
  press(viewport, "j");
  expect(selected(viewport).text).toBe("c");
  press(viewport, "j");
  expect(selected(viewport).text).toBe("d");
  press(viewport, "l");
  expect(selected(viewport).text).toBe("e");
  press(viewport, "w");
  expect(selected(viewport).text).toBe("c");
  press(viewport, "k");
  expect(selected(viewport).text).toBe("a");
  press(viewport, "k"); // There is no preceding row.
  expect(selected(viewport).text).toBe("a");
  press(viewport, "d");
  expect(selected(viewport).text).toBe("b");
  press(viewport, "l"); // Sibling order continues across the row boundary.
  expect(selected(viewport).text).toBe("c");
  press(viewport, "a");
  expect(selected(viewport).text).toBe("b");
  press(viewport, "s");
  expect(selected(viewport).text).toBe("c");
  expect(history.undoCount()).toBe(0);
  expect(viewport.logMessage).not.toHaveBeenCalled();
});

test("direct form links need no organizing buds, and View arrows use source rows", () => {
  const { viewport } = editor(createStructuredLisp("(a b\n c d)"));
  const graph = viewport.widget();
  const roles = documentState(graph).metadata.freeform.structuredLisp.nodes;
  expect(Object.values(roles).some(({ kind }) => kind === "entry" || kind === "line")).toBe(false);
  const list = graph.neighbors().nodeAt(Direction.INWARD);
  const a = list.neighbors().nodeAt(Direction.INWARD);
  const b = a.neighbors().nodeAt(Direction.FORWARD);
  const c = a.neighbors().nodeAt(Direction.DOWNWARD);
  const d = c.neighbors().nodeAt(Direction.FORWARD);
  expect([a, b, c, d].map((node) => node.value())).toEqual(["a", "b", "c", "d"]);
  viewport.selectNode(a);
  press(viewport, "l");
  expect(viewport.node()).toBe(b);
  expect(roles[viewport.node().id()].kind).toBe("symbol");
  expect(press(viewport, "ArrowDown")).toBe(false); // Edit arrows remain camera controls.
  viewport._rendering.showingUI = () => false;
  press(viewport, "ArrowDown");
  expect(viewport.node()).toBe(d);
  press(viewport, "ArrowUp");
  expect(viewport.node()).toBe(b);
  press(viewport, "ArrowLeft");
  expect(viewport.node()).toBe(a);
  viewport.clearNodeSelection();
  expect(press(viewport, "ArrowRight")).toBe(false);
});

test("View-mode editing needs selection and undo/redo retain node-following", () => {
  const { viewport, history } = editor(createStructuredLisp("()"));
  viewport._rendering.showingUI = () => false;
  expect(press(viewport, " ")).toBe(false);
  const list = graphNodes(viewport.widget()).find((node) => inspectLispSelection(viewport.widget(), node).kind === "list");
  viewport.selectNode(list);
  press(viewport, "e");
  press(viewport, "Enter");
  text(viewport, "value");
  const restore = () => {
    viewport.show(history.widget(), history.viewportData());
    viewport.moveToId(history.selectedNode());
  };
  viewport.setUndo(() => { history.undo(); restore(); });
  viewport.setRedo(() => { history.redo(); restore(); });
  press(viewport, "u");
  expect(viewport.navigatingNodes()).toBe(true);
  expect(selected(viewport).kind).toBe("slot");
  press(viewport, "y");
  expect(viewport.navigatingNodes()).toBe(true);
  expect(exportStructuredLisp(viewport.widget())).toBe("(value)");
  expect(press(viewport, "ArrowLeft")).toBe(true);
  viewport.clearNodeSelection();
  expect(press(viewport, " ")).toBe(false);
});

test("raw string drafts stay inline with fixed camera, preserve colors, and round-trip incomplete syntax", () => {
  const { viewport, history } = editor(createStructuredLisp('(say "before")'));
  pick(viewport, '"before"');
  const nodeId = viewport.node().id();
  expect(viewport.getNodeStyle().backgroundColor).toBe(lispKindAppearance("string").backgroundColor);
  viewport.updateNodeStyle({ backgroundColor: "#abcdef" });
  viewport.camera().setOrigin(42, -27);
  viewport.camera().setScale(0.7);
  const camera = viewport.camera().toJSON();
  press(viewport, "Enter");
  const field = viewport._inlineEditor.element;
  expect(field.value).toBe('"before"');
  fireEvent.input(field, { target: { value: '"unfinished' } });
  expect(viewport._inlineEditor.element).toBe(field);
  expect(viewport.node().id()).toBe(nodeId);
  expect(viewport.camera().toJSON()).toEqual(camera);
  expect(viewport.getNodeStyle().backgroundColor).toBe("#abcdef");
  expect(structuredLispStatus(viewport.widget()).complete).toBe(false);
  const restored = readGraph(writeGraph(viewport.widget(), viewport.node(), viewport.toJSON()));
  expect(inspectLispSelection(restored, nodeId).text).toBe('"unfinished');
  fireEvent.keyDown(field, { key: "Escape" });
  expect(viewport.showingEditor()).toBe(false);
  history.undo();
  expect(exportStructuredLisp(history.widget())).toBe('(say "before")');
});

test("directional edits cannot spawn untyped Lisp connections and delete uses the grammar", () => {
  const { viewport, history } = editor(createStructuredLisp("(one two)"));
  pick(viewport, "one");
  const count = graphNodes(viewport.widget()).length;
  viewport.spawnMove(Direction.FORWARD);
  expect(graphNodes(viewport.widget())).toHaveLength(count);
  expect(history.undoCount()).toBe(0);
  pick(viewport, "one");
  viewport.removeNode();
  expect(exportStructuredLisp(viewport.widget())).toBe("(two)");
  history.undo();
  expect(exportStructuredLisp(history.widget())).toBe("(one two)");
});

test("raw Lisp block comments accept Shift+Enter without closing the editor", () => {
  const { viewport } = editor(createStructuredLisp("#| note |#"));
  pick(viewport, "#| note |#");
  press(viewport, "Enter");
  const field = viewport._inlineEditor.element;
  const newline = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
  field.dispatchEvent(newline);
  expect(newline.defaultPrevented).toBe(false);
  expect(field).toHaveFocus();
  fireEvent.input(field, { target: { value: "#| first\nsecond |#" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(exportStructuredLisp(viewport.widget())).toBe("#| first\nsecond |#");
});

test("native text input, browser modifiers, IME, and held insertion keys remain protected", () => {
  const { viewport, history } = editor();
  expect(press(viewport, "(", { ctrlKey: true })).toBe(false);
  expect(press(viewport, "(", { isComposing: true })).toBe(false);
  expect(press(viewport, "(", { target: document.createElement("textarea") })).toBe(false);
  press(viewport, "e", { repeat: true });
  expect(history.undoCount()).toBe(0);
  press(viewport, "e");
  const count = graphNodes(viewport.widget()).length;
  press(viewport, " ", { repeat: true });
  expect(graphNodes(viewport.widget())).toHaveLength(count);
  press(viewport, "Enter");
  const field = viewport._inlineEditor.element;
  fireEvent.keyDown(field, { key: "Enter", repeat: true });
  expect(field).toHaveFocus();
  fireEvent.keyDown(field, { key: "Enter", isComposing: true });
  expect(field).toHaveFocus();
});
