import { fireEvent } from "@testing-library/react";
import { Direction, DirectionNode } from "parsegraph";
import Color from "parsegraph-color";
import Viewport from "./Viewport";
import GraphStack from "../../GraphStack";
import { graphNodes, graphSelection, readGraph, writeGraph } from "../../graphDocument";
import {
  createJsonDraft,
  createStructuredJson,
  exportStructuredJson,
  inspectJsonSelection,
  structuredJsonStatus,
} from "../../structuredJson";

const editors = [];
function editor(root = createJsonDraft()) {
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
  viewport.setSaveGraph((graph, node) =>
    history.save(graph, node, viewport.toJSON())
  );
  const result = { viewport, history };
  editors.push(viewport);
  return result;
}
function press(viewport, key, options = {}) {
  return viewport.handleStructuredKey({ key, ...options });
}
function text(viewport, value) {
  const field = viewport._inlineEditor.element;
  expect(field).toHaveFocus();
  fireEvent.input(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(viewport.container()).toHaveFocus();
}
function selected(viewport) {
  return inspectJsonSelection(viewport.widget(), viewport.node());
}
function pick(viewport, label) {
  viewport.selectNode(
    graphNodes(viewport.widget()).find((node) => node.value() === label)
  );
}
afterEach(() => {
  editors.splice(0).forEach((viewport) => {
    viewport._inlineEditor?.close(false);
    viewport.container().remove();
  });
});

test("write a nested document entirely with keyboard commands and inline text", () => {
  const { viewport } = editor();
  press(viewport, "i");
  expect(selected(viewport)).toMatchObject({ kind: "key", isSlot: true });
  press(viewport, "Enter");
  text(viewport, "name");
  press(viewport, ":");
  press(viewport, '"');
  text(viewport, "hello, world");
  press(viewport, ",");
  press(viewport, "Enter");
  text(viewport, "notes");
  press(viewport, ":");
  press(viewport, "[");
  expect(selected(viewport)).toMatchObject({ kind: "array", entryCount: 0 });
  press(viewport, "i");
  press(viewport, "6");
  const field = viewport._inlineEditor.element;
  expect(field.value).toBe("6");
  expect(field.selectionStart).toBe(1);
  text(viewport, "60");
  press(viewport, ",");
  press(viewport, "t");
  press(viewport, ",");
  press(viewport, "n");
  press(viewport, "]");
  expect(selected(viewport).kind).toBe("array");
  press(viewport, ",");
  press(viewport, "Enter");
  text(viewport, "options");
  press(viewport, ":");
  press(viewport, "{", { shiftKey: true });
  press(viewport, "i");
  press(viewport, "Enter");
  text(viewport, "enabled");
  press(viewport, ":");
  press(viewport, "f");
  press(viewport, "}");
  press(viewport, "o");
  expect(viewport.node()).toBe(viewport.widget());
  expect(exportStructuredJson(viewport.widget())).toEqual({
    name: "hello, world",
    notes: [60, true, null],
    options: { enabled: false },
  });
  expect(viewport.logMessage).not.toHaveBeenCalled();
});

test("comma inserts in the middle and a held key does not create extra slots", () => {
  const { viewport, history } = editor(createStructuredJson([1, 3]));
  pick(viewport, "1");
  const before = history.undoCount();
  press(viewport, ",");
  const count = graphNodes(viewport.widget()).length;
  press(viewport, ",", { repeat: true });
  expect(graphNodes(viewport.widget())).toHaveLength(count);
  expect(history.undoCount()).toBe(before + 1);
  press(viewport, "2");
  expect(exportStructuredJson(viewport.widget())).toEqual([1, 2, 3]);
  expect(history.undoCount()).toBe(before + 2);
  history.undo();
  expect(
    inspectJsonSelection(history.widget(), history.selectedNode()).kind
  ).toBe("slot");
  history.undo();
  expect(exportStructuredJson(history.widget())).toEqual([1, 3]);
});

test("entering an empty container creates exactly one entry", () => {
  const { viewport, history } = editor(createStructuredJson([]));
  press(viewport, "i", { repeat: true });
  expect(exportStructuredJson(viewport.widget())).toEqual([]);
  press(viewport, "i");
  expect(selected(viewport).kind).toBe("slot");
  expect(history.undoCount()).toBe(1);
  press(viewport, "i", { repeat: true });
  expect(history.undoCount()).toBe(1);
  press(viewport, "o");
  press(viewport, "i");
  expect(selected(viewport).kind).toBe("slot");
  expect(history.undoCount()).toBe(1);
});

test("j follows a key's value before moving to the next member at a dead end", () => {
  const { viewport, history } = editor(createStructuredJson({ a: 1, b: 2 }));
  press(viewport, "i");
  expect(viewport.node().value()).toBe('"a"');
  press(viewport, "j");
  expect(viewport.node().value()).toBe("1");
  press(viewport, "j");
  expect(viewport.node().value()).toBe('"b"');
  press(viewport, "k");
  expect(viewport.node().value()).toBe('"a"');
  press(viewport, "l");
  expect(history.undoCount()).toBe(0);
  expect(exportStructuredJson(viewport.widget())).toEqual({ a: 1, b: 2 });
});

test("View mode only accepts structured commands while following a selection", () => {
  const { viewport, history } = editor(createStructuredJson([]));
  viewport._rendering.showingUI = () => false;
  expect(press(viewport, ",")).toBe(false);
  expect(press(viewport, "w")).toBe(false);
  viewport.selectNode(viewport.widget());
  expect(press(viewport, "i")).toBe(true);
  expect(selected(viewport).kind).toBe("slot");
  expect(press(viewport, "n")).toBe(true);
  expect(exportStructuredJson(viewport.widget())).toEqual([null]);
  expect(press(viewport, "ArrowLeft")).toBe(true);
  viewport.clearNodeSelection();
  const before = history.undoCount();
  expect(press(viewport, ",")).toBe(false);
  expect(history.undoCount()).toBe(before);
});

test("View-mode undo and redo keep following nodes across document reconstruction", () => {
  const { viewport, history } = editor(createStructuredJson([]));
  viewport._rendering.showingUI = () => false;
  const restore = () => {
    viewport.show(history.widget(), history.viewportData());
    viewport.moveToId(history.selectedNode());
  };
  viewport.setUndo(() => {
    history.undo();
    restore();
  });
  viewport.setRedo(() => {
    history.redo();
    restore();
  });
  viewport.selectNode(viewport.widget());
  press(viewport, "i");
  press(viewport, "n");
  expect(exportStructuredJson(viewport.widget())).toEqual([null]);
  press(viewport, "u");
  expect(viewport.navigatingNodes()).toBe(true);
  expect(selected(viewport).kind).toBe("slot");
  press(viewport, "y");
  expect(viewport.navigatingNodes()).toBe(true);
  expect(exportStructuredJson(viewport.widget())).toEqual([null]);
  press(viewport, ",");
  expect(selected(viewport).kind).toBe("slot");
});

test.each(['"', "[", "{", "t", "f", "n", "1", "-"])(
  "literal shortcut %s cannot replace existing content",
  (key) => {
    const { viewport, history } = editor(createStructuredJson("keep me"));
    expect(press(viewport, key)).toBe(false);
    expect(history.undoCount()).toBe(0);
    expect(exportStructuredJson(viewport.widget())).toBe("keep me");
  }
);

test("a partial negative number remains a draft and a single undo restores its slot", () => {
  const { viewport, history } = editor();
  press(viewport, "i");
  press(viewport, ":");
  press(viewport, "-");
  expect(selected(viewport)).toMatchObject({
    kind: "number",
    text: "-",
    isSlot: true,
  });
  expect(viewport._inlineEditor.element.selectionStart).toBe(1);
  history.undo();
  expect(
    inspectJsonSelection(history.widget(), selected(viewport).nodeId).kind
  ).toBe("slot");
});

test("held Enter does not immediately close the textbox it just opened", () => {
  const { viewport } = editor(createStructuredJson("text"));
  press(viewport, "Enter");
  const field = viewport._inlineEditor.element;
  fireEvent.keyDown(field, { key: "Enter", repeat: true });
  expect(field).toHaveFocus();
  fireEvent.keyDown(field, { key: "Enter" });
  press(viewport, "Enter", { repeat: true });
  expect(viewport.showingEditor()).toBe(false);
});

test("ordinary graphs keep their existing keyboard behavior", () => {
  const { viewport, history } = editor(new DirectionNode("ordinary"));
  expect(press(viewport, ",")).toBe(false);
  expect(press(viewport, "i")).toBe(false);
  expect(history.undoCount()).toBe(0);
  expect(viewport.node().neighbors().hasNode(Direction.INWARD)).toBe(false);
});

test("edit a configuration, extend a nested task list, and reorder it without replacing existing identities", () => {
  const original = {
    name: "demo",
    enabled: false,
    jobs: [{ name: "build", steps: ["install", "test"] }],
    obsolete: true,
  };
  const { viewport, history } = editor(createStructuredJson(original));
  const originalIds = graphNodes(viewport.widget()).map((node) => node.id());
  const restore = () => {
    viewport.show(history.widget(), history.viewportData());
    viewport.moveToId(history.selectedNode());
  };
  viewport.setUndo(() => { history.undo(); restore(); });
  viewport.setRedo(() => { history.redo(); restore(); });

  // Rename a key and edit its string; JSON fields contain decoded text.
  press(viewport, "i");
  expect(selected(viewport)).toMatchObject({ kind: "key", text: "name" });
  const keyId = viewport.node().id();
  press(viewport, "Enter");
  text(viewport, "projectName");
  expect(viewport.node().id()).toBe(keyId);
  press(viewport, ":");
  const nameId = viewport.node().id();
  press(viewport, "Enter");
  text(viewport, "freeform");
  expect(viewport.node().id()).toBe(nameId);

  // A value's dead-end down key advances to the next member's key.
  press(viewport, "j");
  expect(selected(viewport)).toMatchObject({ kind: "key", text: "enabled" });
  press(viewport, ":");
  press(viewport, "Enter");
  text(viewport, "true");
  press(viewport, ",");
  press(viewport, "Enter");
  text(viewport, "timeout");
  press(viewport, ":");
  press(viewport, "3");
  text(viewport, "30");

  // Enter jobs[0].steps and append a third item to the existing array.
  press(viewport, "j");
  expect(selected(viewport)).toMatchObject({ kind: "key", text: "jobs" });
  press(viewport, ":");
  press(viewport, "i");
  expect(selected(viewport).kind).toBe("object");
  press(viewport, "i");
  press(viewport, ":");
  press(viewport, "j");
  expect(selected(viewport)).toMatchObject({ kind: "key", text: "steps" });
  press(viewport, ":");
  press(viewport, "i");
  expect(selected(viewport).text).toBe("install");
  press(viewport, "j");
  expect(selected(viewport).text).toBe("test");
  press(viewport, ",");
  press(viewport, '"');
  text(viewport, "lint");
  const lintId = viewport.node().id();
  const extended = {
    projectName: "freeform", enabled: true, timeout: 30,
    jobs: [{ name: "build", steps: ["install", "test", "lint"] }], obsolete: true,
  };
  expect(exportStructuredJson(viewport.widget())).toEqual(extended);

  // The inspector's Move earlier action uses this same viewport command.
  expect(selected(viewport).canMoveEarlier).toBe(true);
  viewport.applyStructuredCommand({ type: "move", offset: -1 });
  expect(viewport.node().id()).toBe(lintId);
  expect(exportStructuredJson(viewport.widget()).jobs[0].steps).toEqual(["install", "lint", "test"]);
  press(viewport, "u");
  expect(exportStructuredJson(viewport.widget())).toEqual(extended);
  press(viewport, "y");
  expect(exportStructuredJson(viewport.widget()).jobs[0].steps).toEqual(["install", "lint", "test"]);
  expect(viewport.node().id()).toBe(lintId);

  // Leave steps, then insert beside its owning job rather than beside jobs.
  press(viewport, "o");
  press(viewport, "o");
  expect(selected(viewport).kind).toBe("object");
  press(viewport, ",");
  press(viewport, "{");
  press(viewport, "i");
  press(viewport, "Enter");
  text(viewport, "name");
  press(viewport, ":");
  press(viewport, '"');
  text(viewport, "preview");
  press(viewport, ",");
  press(viewport, "Enter");
  text(viewport, "steps");
  press(viewport, ":");
  press(viewport, "[");
  press(viewport, "i");
  press(viewport, '"');
  text(viewport, "serve");

  const expected = {
    ...extended,
    jobs: [
      { name: "build", steps: ["install", "lint", "test"] },
      { name: "preview", steps: ["serve"] },
    ],
  };
  expect(exportStructuredJson(viewport.widget())).toEqual(expected);
  expect(structuredJsonStatus(viewport.widget()).complete).toBe(true);
  const saved = writeGraph(viewport.widget(), viewport.node(), viewport.toJSON());
  const restored = readGraph(saved);
  expect(exportStructuredJson(restored)).toEqual(expected);
  expect(inspectJsonSelection(restored, graphSelection(saved)).text).toBe("serve");
  const ids = new Set(graphNodes(restored).map((node) => node.id()));
  originalIds.forEach((id) => expect(ids.has(id)).toBe(true));
  expect(viewport.logMessage).not.toHaveBeenCalled();
});

test("deleting a member value clears it, while deleting its key removes the member and undo restores both", () => {
  const original = { obsolete: true, keep: "untouched" };
  const { viewport, history } = editor(createStructuredJson(original));
  const restore = () => {
    viewport.show(history.widget(), history.viewportData());
    viewport.moveToId(history.selectedNode());
  };
  viewport.setUndo(() => { history.undo(); restore(); });
  viewport.setRedo(() => { history.redo(); restore(); });
  press(viewport, "i");
  const keyId = viewport.node().id();
  press(viewport, ":");
  const valueId = viewport.node().id();
  press(viewport, "x");
  expect(selected(viewport)).toMatchObject({ kind: "slot", nodeId: valueId });
  expect(inspectJsonSelection(viewport.widget(), keyId).text).toBe("obsolete");
  expect(structuredJsonStatus(viewport.widget()).complete).toBe(false);
  expect(() => exportStructuredJson(viewport.widget())).toThrow();
  press(viewport, "u");
  expect(exportStructuredJson(viewport.widget())).toEqual(original);
  // JSON undo restores the preceding saved selection, which was the root;
  // navigating before the first edit does not create a history snapshot.
  expect(viewport.node()).toBe(viewport.widget());
  press(viewport, "i");
  press(viewport, ":");
  expect(viewport.node().id()).toBe(valueId);
  press(viewport, "k");
  expect(viewport.node().id()).toBe(keyId);
  press(viewport, "x");
  expect(exportStructuredJson(viewport.widget())).toEqual({ keep: "untouched" });
  expect(selected(viewport)).toMatchObject({ kind: "key", text: "keep" });
  press(viewport, "u");
  expect(exportStructuredJson(viewport.widget())).toEqual(original);
  expect(graphNodes(viewport.widget()).some((node) => node.id() === keyId)).toBe(true);
  expect(graphNodes(viewport.widget()).some((node) => node.id() === valueId)).toBe(true);
  press(viewport, "y");
  expect(exportStructuredJson(readGraph(writeGraph(viewport.widget())))).toEqual({ keep: "untouched" });
  expect(viewport.logMessage).not.toHaveBeenCalled();
});
