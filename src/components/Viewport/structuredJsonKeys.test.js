import { fireEvent } from "@testing-library/react";
import { Direction, DirectionNode } from "parsegraph";
import Color from "parsegraph-color";
import Viewport from "./Viewport";
import GraphStack from "../../GraphStack";
import { graphNodes } from "../../graphDocument";
import {
  createJsonDraft,
  createStructuredJson,
  exportStructuredJson,
  inspectJsonSelection,
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
