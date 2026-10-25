import { fireEvent } from "@testing-library/react";
import Color from "parsegraph-color";
import Viewport from "./Viewport";
import { inlineEditorBox } from "./ViewportInlineEditor";
import GraphStack from "../../GraphStack";
import { graphNodes, readGraph, writeGraph } from "../../graphDocument";
import {
  createStructuredJson,
  exportStructuredJson,
  inspectJsonSelection,
} from "../../structuredJson";
import { createStructuredLisp, exportStructuredLisp } from "../../structuredLisp";

const editors = [];

function editor(value, root = createStructuredJson(value)) {
  let publishedRoot = root;
  const viewport = new Viewport();
  viewport.scheduleRepaint = jest.fn();
  viewport.scheduleRender = jest.fn();
  viewport.attachInput = jest.fn();
  viewport._rendering = {
    resetSettings: jest.fn(),
    pageBackgroundColor: () => new Color(0.2, 0.2, 0.9, 1),
    setPageBackgroundColor: jest.fn(),
    showingUI: () => true,
    showUI: jest.fn(),
    hideUI: jest.fn(),
    publishedRoot: () => publishedRoot,
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
  viewport.setHistoryGrouping({
    begin: (graph, node, data) => history.beginGroup(graph, node, data),
    end: () => history.endGroup(),
  });
  viewport.setUndo(() => {
    if (history.undoCount()) {
      history.undo();
      viewport.show(history.widget(), history.viewportData());
      viewport.moveToId(history.selectedNode());
    }
  });
  viewport.setRedo(() => {
    if (history.redoCount()) {
      history.redo();
      viewport.show(history.widget(), history.viewportData());
      viewport.moveToId(history.selectedNode());
    }
  });
  const result = {
    viewport,
    root,
    history,
    container,
    publish: (graph) => {
      publishedRoot = graph;
    },
  };
  editors.push(result);
  return result;
}

function geometry(
  node,
  { x = 200, y = 150, width = 120, height = 40, scale = 1, dirty = false } = {}
) {
  jest.spyOn(node, "layout").mockReturnValue({
    needsCommit: () => dirty,
    needsAbsolutePos: () => false,
    size: (size) => {
      size[0] = width;
      size[1] = height;
    },
    absoluteX: () => x,
    absoluteY: () => y,
    absoluteScale: () => scale,
  });
}

function key(element, value, options = {}) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  element.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const { viewport, container } of editors.splice(0)) {
    viewport._inlineEditor?.close(false);
    container.remove();
  }
  jest.restoreAllMocks();
});

test("Enter on an untouched key slot accepts an empty JSON key", () => {
  const { viewport } = editor({});
  viewport.applyStructuredCommand({ type: "add" });
  expect(inspectJsonSelection(viewport.widget(), viewport.node()).isSlot).toBe(true);
  viewport.showEditor();
  key(viewport._inlineEditor.element, "Enter");
  expect(inspectJsonSelection(viewport.widget(), viewport.node())).toMatchObject({ kind: "key", text: "", isSlot: false });
  expect(viewport.showingEditor()).toBe(false);
});

test("inline geometry uses world origin and both camera and node scale", () => {
  const { viewport, root } = editor("hello");
  geometry(root, { x: 40, y: 30, width: 100, height: 20, scale: 0.5 });
  viewport.camera().setOrigin(10, -5);
  viewport.camera().setScale(2);
  expect(inlineEditorBox(root, viewport.camera())).toEqual({
    x: 100,
    y: 50,
    width: 100,
    height: 20,
    scale: 1,
  });
  geometry(root, { dirty: true });
  expect(inlineEditorBox(root, viewport.camera())).toBeNull();
  geometry(root, { width: NaN });
  expect(inlineEditorBox(root, viewport.camera())).toBeNull();
});

test("Enter finishes inline editing and returns focus so the editor can open again", () => {
  const { viewport, container } = editor("hello");
  container.focus();
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  expect(field).toHaveAccessibleName("Edit string in graph");
  expect(field).toHaveValue("hello");
  expect(field).toHaveFocus();
  expect(viewport.showingEditor()).toBe(true);
  expect(key(field, "Enter").defaultPrevented).toBe(true);
  expect(field).not.toBeInTheDocument();
  expect(container).toHaveFocus();
  expect(viewport.showingEditor()).toBe(false);
  viewport.toggleEditor();
  expect(document.querySelector(".graph-inline-editor")).toHaveValue("hello");
  viewport.toggleEditor();
  expect(document.querySelector(".graph-inline-editor")).toBeNull();
});

test("the inline textbox follows the graph inside an offset canvas workspace", () => {
  const { viewport, root, container } = editor("hello");
  geometry(root, { x: 200, y: 150, width: 120, height: 40 });
  jest.spyOn(container, "getBoundingClientRect").mockReturnValue({ left: 80, top: 64 });
  viewport.camera().setOrigin(0, 0);
  viewport.camera().setScale(1);
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  expect(field.style.left).toBe("220px");
  expect(field.style.top).toBe("194px");
});

test("Shift+Enter permits string newlines and IME Enter does not finish a composition", () => {
  const { viewport } = editor("hello");
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  expect(key(field, "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
  expect(field).toBeInTheDocument();
  fireEvent.input(field, { target: { value: "hello\nworld" } });
  expect(exportStructuredJson(viewport.widget())).toBe("hello\nworld");
  fireEvent.compositionStart(field);
  expect(key(field, "Enter").defaultPrevented).toBe(false);
  expect(field).toBeInTheDocument();
  fireEvent.compositionEnd(field);
  expect(key(field, "Enter", { isComposing: true }).defaultPrevented).toBe(
    false
  );
  expect(field).toBeInTheDocument();
  key(field, "Enter");
  expect(field).not.toBeInTheDocument();
});

test("Escape keeps live edits and their native draft and undo history", () => {
  const { viewport, history, container } = editor("before");
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  fireEvent.input(field, { target: { value: "after" } });
  expect(exportStructuredJson(viewport.widget())).toBe("after");
  expect(
    exportStructuredJson(
      readGraph(
        writeGraph(viewport.widget(), viewport.node(), viewport.toJSON(), 1)
      )
    )
  ).toBe("after");
  key(field, "Escape");
  expect(container).toHaveFocus();
  expect(exportStructuredJson(viewport.widget())).toBe("after");
  expect(history.undoCount()).toBe(1);
  history.undo();
  expect(exportStructuredJson(history.widget())).toBe("before");
});

test("pasting long text keeps the textarea mounted and camera fixed until the new frame publishes", () => {
  const { viewport, root, publish } = editor("before");
  geometry(root);
  viewport.camera().setOrigin(10, 20);
  const camera = viewport.camera().toJSON();
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  expect(field.style.left).toBe("150px");
  expect(field.style.top).toBe("150px");
  expect(field.style.width).toBe("120px");
  const longText = "large text ".repeat(3000);
  fireEvent.input(field, { target: { value: longText } });
  expect(document.querySelector(".graph-inline-editor")).toBe(field);
  expect(field).toHaveFocus();
  expect(field).toHaveValue(longText);
  expect(exportStructuredJson(viewport.widget())).toBe(longText);
  expect(viewport.camera().toJSON()).toEqual(camera);
  expect(viewport.rendering().replaceDocumentRoot).toHaveBeenCalledTimes(1);
  const replacement = viewport.widget();
  geometry(replacement, { x: 350, y: 200, width: 400, height: 50 });
  viewport._inlineEditor.update();
  expect(field.style.left).toBe("150px");
  expect(field.style.width).toBe("120px");
  viewport.camera().setOrigin(20, 20);
  viewport._inlineEditor.update();
  expect(field.style.left).toBe("160px");
  publish(replacement);
  viewport._inlineEditor.update();
  expect(field.style.left).toBe("170px");
  expect(field.style.top).toBe("195px");
  expect(field.style.width).toBe("400px");
});

test("moving selection or replacing the document closes the old edit even when IDs repeat", () => {
  const { viewport } = editor(["first", "second"]);
  const first = graphNodes(viewport.widget()).find(
    (node) => node.value() === '"first"'
  );
  const second = graphNodes(viewport.widget()).find(
    (node) => node.value() === '"second"'
  );
  viewport.selectNode(first);
  viewport.toggleEditor();
  const firstField = document.querySelector(".graph-inline-editor");
  viewport.selectNode(second);
  expect(firstField).not.toBeInTheDocument();
  viewport.show(createStructuredJson("old document"));
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  const previousId = viewport.node().id();
  const newRoot = createStructuredJson("new document");
  expect(newRoot.id()).toBe(previousId);
  viewport.show(newRoot);
  expect(field).not.toBeInTheDocument();
  expect(viewport.showingEditor()).toBe(false);
  expect(exportStructuredJson(viewport.widget())).toBe("new document");
});

test("blur ends editing without stealing the next control's focus", () => {
  const { viewport } = editor("value");
  viewport.toggleEditor();
  const field = document.querySelector(".graph-inline-editor");
  const button = document.createElement("button");
  document.body.appendChild(button);
  button.focus();
  expect(field).not.toBeInTheDocument();
  expect(button).toHaveFocus();
  button.remove();
});

test("a JSON key rename is one undo and retains the key selection", () => {
  const { viewport, history } = editor({ name: "demo", enabled: true });
  const selected = graphNodes(viewport.widget()).find((node) => node.value() === '"name"');
  viewport.selectNode(selected);
  viewport.showEditor();
  const field = viewport._inlineEditor.element;
  for (const value of ["", "t", "title"]) fireEvent.input(field, { target: { value } });
  expect(exportStructuredJson(viewport.widget())).toEqual({ title: "demo", enabled: true });
  key(field, "Enter");
  expect(history.undoCount()).toBe(1);
  viewport.undo();
  expect(exportStructuredJson(viewport.widget())).toEqual({ name: "demo", enabled: true });
  expect(viewport.node().id()).toBe(selected.id());
  viewport.redo();
  expect(exportStructuredJson(viewport.widget())).toEqual({ title: "demo", enabled: true });
});

test("a no-op inline session after undo preserves redo", () => {
  const { viewport, history } = editor("before");
  viewport.showEditor();
  fireEvent.input(viewport._inlineEditor.element, { target: { value: "after" } });
  // Toolbar Undo can arrive while the editor is still active.
  viewport.undo();
  expect(viewport.showingEditor()).toBe(false);
  expect(exportStructuredJson(viewport.widget())).toBe("before");
  expect(history.redoCount()).toBe(1);
  viewport.showEditor();
  const field = viewport._inlineEditor.element;
  fireEvent.input(field, { target: { value: "temporary" } });
  fireEvent.input(field, { target: { value: "before" } });
  key(field, "Escape");
  expect(history.undoCount()).toBe(0);
  expect(history.redoCount()).toBe(1);
  viewport.redo();
  expect(exportStructuredJson(viewport.widget())).toBe("after");
});

test("partial numbers remain live native drafts while an edit is grouped", () => {
  const { viewport, history } = editor(12);
  viewport.showEditor();
  const field = viewport._inlineEditor.element;
  fireEvent.input(field, { target: { value: "-" } });
  fireEvent.input(field, { target: { value: "-1e" } });
  const restored = readGraph(writeGraph(viewport.widget(), viewport.node(), viewport.toJSON(), 1));
  expect(inspectJsonSelection(restored, restored)).toMatchObject({ kind: "number", text: "-1e", isSlot: true });
  expect(() => exportStructuredJson(restored)).toThrow();
  key(field, "Escape");
  expect(history.undoCount()).toBe(1);
  viewport.undo();
  expect(exportStructuredJson(viewport.widget())).toBe(12);
});

test("rejected text stays in its field until it can be applied", () => {
  const { viewport, history } = editor("before");
  viewport.logMessage = jest.fn();
  viewport.showEditor();
  const field = viewport._inlineEditor.element;
  const apply = jest.spyOn(viewport, "applyStructuredCommand").mockReturnValue(false);
  fireEvent.input(field, { target: { value: "retained" } });
  key(field, "Enter");
  expect(field).toBeInTheDocument();
  expect(field).toHaveValue("retained");
  expect(field.validationMessage).toMatch(/still here/);
  viewport.undo();
  expect(field).toBeInTheDocument();
  apply.mockRestore();
  key(field, "Escape");
  expect(field).not.toBeInTheDocument();
  expect(exportStructuredJson(viewport.widget())).toBe("retained");
  expect(history.undoCount()).toBe(1);
});

test("raw Lisp token editing also groups history without changing source input behavior", () => {
  const { viewport, history } = editor(null, createStructuredLisp("(display value)\n"));
  const token = graphNodes(viewport.widget()).find((node) => node.value() === "value");
  viewport.selectNode(token);
  viewport.showEditor();
  const field = viewport._inlineEditor.element;
  for (const value of ["", "r", "result"]) fireEvent.input(field, { target: { value } });
  key(field, "Enter");
  expect(exportStructuredLisp(viewport.widget())).toBe("(display result)\n");
  expect(history.undoCount()).toBe(1);
  viewport.undo();
  expect(exportStructuredLisp(viewport.widget())).toBe("(display value)\n");
  expect(viewport.node().id()).toBe(token.id());
});
