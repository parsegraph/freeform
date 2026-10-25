import { fireEvent, screen } from "@testing-library/react";
import Color from "parsegraph-color";
import Viewport from "./Viewport";
import GraphStack from "../../GraphStack";
import { graphNodes, graphSelection, readGraph, writeGraph } from "../../graphDocument";
import {
  createLispDraft,
  createStructuredLisp,
  exportStructuredLisp,
  inspectLispSelection,
  structuredLispStatus,
} from "../../structuredLisp";
import { readLispRecovery, writeLispRecovery } from "../../structuredRecovery";

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
  viewport.setHistoryGrouping({
    begin: (...args) => history.beginGroup(...args),
    end: () => history.endGroup(),
  });
  const restore = () => {
    viewport.show(history.widget(), history.viewportData());
    viewport.moveToId(history.selectedNode());
  };
  viewport.setUndo(() => { history.undo(); restore(); });
  viewport.setRedo(() => { history.redo(); restore(); });
  editors.push(viewport);
  return { viewport, history };
}

const press = (viewport, key) => viewport.handleStructuredKey({ key });
const selected = (viewport) => inspectLispSelection(viewport.widget(), viewport.node());
const pick = (viewport, text) => viewport.selectNode(
  graphNodes(viewport.widget()).find((node) => node.value() === text)
);
function insert(viewport) {
  expect(press(viewport, "i")).toBe(true);
  const field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
  expect(field).toHaveFocus();
  return field;
}
function replaceInput(field, value, caret = value.length, options = {}) {
  field.value = value;
  field.setSelectionRange(caret, caret);
  fireEvent.input(field, options);
}
function type(viewport, field, source) {
  for (const char of source) {
    if (char === "\n" || char === "\t") {
      fireEvent.keyDown(field, { key: char === "\n" ? "Enter" : "Tab" });
    } else {
      const start = field.selectionStart;
      const value = field.value.slice(0, start) + char + field.value.slice(field.selectionEnd);
      replaceInput(field, value, start + char.length, { inputType: "insertText", data: char });
    }
    expect(viewport._sourceInput.element).toBe(field);
    expect(field).toHaveFocus();
  }
}
const escape = (field) => fireEvent.keyDown(field, { key: "Escape" });

afterEach(() => {
  editors.splice(0).forEach((viewport) => {
    viewport._sourceInput?.discard();
    viewport._inlineEditor?.close(false);
    viewport.container().remove();
  });
});

test("one native field builds nested source with Enter and Tab, then Escape restores graph navigation", () => {
  const { viewport } = editor();
  viewport.camera().setOrigin(43, -29);
  viewport.camera().setScale(0.7);
  const camera = viewport.camera().toJSON();
  const field = insert(viewport);
  expect(screen.getByRole("status")).toHaveTextContent("INSERT");
  const source = "(define (square x)\n\t(* x x))\n(square 5)\n";
  type(viewport, field, source);
  expect(viewport.camera().toJSON()).toEqual(camera);
  expect(graphNodes(viewport.widget()).some((node) => node.value() === "[value]")).toBe(true);
  escape(field);
  expect(field).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(viewport.container()).toHaveFocus();
  expect(viewport.showingEditor()).toBe(false);
  expect(exportStructuredLisp(viewport.widget())).toBe(source);
  expect(graphNodes(viewport.widget()).some((node) => node.value() === "[value]")).toBe(false);
  expect(viewport.camera().toJSON()).toEqual(camera);
  expect(press(viewport, "h")).toBe(true);
  expect(selected(viewport).kind).toBe("list");
  expect(viewport.logMessage).not.toHaveBeenCalled();
});

test("spaces and parentheses inside strings and comments stay in their native tokens", () => {
  const { viewport } = editor();
  const field = insert(viewport);
  const source = '(display "a (b) c")\n; note (not a list)\n(+ 1 2)';
  type(viewport, field, source);
  escape(field);
  expect(exportStructuredLisp(viewport.widget())).toBe(source);
  const roles = graphNodes(viewport.widget()).map((node) => inspectLispSelection(viewport.widget(), node));
  expect(roles.filter(({ kind }) => kind === "list")).toHaveLength(2);
  expect(roles.find(({ kind }) => kind === "string").text).toBe('"a (b) c"');
  expect(roles.find(({ kind }) => kind === "comment").text).toBe("; note (not a list)");
});

test("a whole-source paste is one history update and leaves the same input focused", () => {
  const { viewport, history } = editor();
  const field = insert(viewport);
  const before = history.undoCount();
  const source = '(define value "pasted words")\n\n(+ value 1)\n';
  replaceInput(field, source, source.length, { inputType: "insertFromPaste" });
  expect(history.undoCount()).toBe(before + 1);
  expect(viewport._sourceInput.element).toBe(field);
  expect(field).toHaveFocus();
  escape(field);
  expect(exportStructuredLisp(viewport.widget())).toBe(source);
});

test("IME composition defers graph changes and Escape until composition finishes", () => {
  const { viewport, history } = editor();
  const field = insert(viewport);
  const before = writeGraph(viewport.widget());
  const beforeCount = history.undoCount();
  fireEvent.compositionStart(field);
  replaceInput(field, "名", 1, { isComposing: true });
  replaceInput(field, "名前", 2, { isComposing: true });
  escape(field);
  expect(field).toHaveFocus();
  expect(writeGraph(viewport.widget())).toEqual(before);
  expect(history.undoCount()).toBe(beforeCount);
  fireEvent.compositionEnd(field, { data: "名前" });
  expect(selected(viewport).text).toBe("名前");
  expect(history.undoCount()).toBe(beforeCount + 1);
  escape(field);
  expect(exportStructuredLisp(viewport.widget())).toBe("名前");
});

test("inserting a delimiter at the native caret retains the suffix and caret position", () => {
  const { viewport } = editor(createStructuredLisp("foobar"));
  pick(viewport, "foobar");
  const field = insert(viewport);
  field.setSelectionRange(3, 3);
  type(viewport, field, " ");
  expect(field.value).toBe("bar");
  expect(field.selectionStart).toBe(0);
  type(viewport, field, "new-");
  escape(field);
  expect(exportStructuredLisp(viewport.widget())).toBe("foo new-bar");
});

test("unfinished input survives history and browser recovery, then completes through the same source editor", () => {
  const { viewport, history } = editor();
  let field = insert(viewport);
  type(viewport, field, '(say "unfinished');
  escape(field);
  expect(selected(viewport)).toMatchObject({ kind: "string", text: '"unfinished', isSlot: true });
  const nodeId = viewport.node().id();
  const partial = writeGraph(viewport.widget(), viewport.node(), viewport.toJSON());
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  writeLispRecovery(partial, storage);
  const recovered = readLispRecovery(storage).document;
  expect(graphSelection(recovered)).toBe(nodeId);
  expect(inspectLispSelection(readGraph(recovered), nodeId)).toMatchObject({ kind: "string", text: '"unfinished' });
  expect(structuredLispStatus(readGraph(recovered))).toMatchObject({ validStructure: true, complete: false });

  field = insert(viewport);
  replaceInput(field, '"done"');
  escape(field);
  expect(exportStructuredLisp(viewport.widget())).toBe('(say "done")');
  history.undo();
  expect(inspectLispSelection(history.widget(), nodeId).text).toBe('"unfinished');
  history.redo();
  const complete = writeGraph(history.widget(), nodeId);
  writeLispRecovery(complete, storage);
  expect(exportStructuredLisp(readGraph(readLispRecovery(storage).document))).toBe('(say "done")');
});

test("Enter retains fixed-type raw editing and source mode uses its own field", () => {
  const { viewport } = editor(createStructuredLisp("123"));
  pick(viewport, "123");
  press(viewport, "Enter");
  const raw = screen.getByRole("textbox", { name: "Edit number in graph" });
  replaceInput(raw, "word");
  expect(selected(viewport)).toMatchObject({ kind: "number", text: "word", isSlot: true });
  fireEvent.keyDown(raw, { key: "Enter" });
  expect(viewport.container()).toHaveFocus();
  const source = insert(viewport);
  expect(source).not.toBe(raw);
  replaceInput(source, "symbol");
  escape(source);
  expect(selected(viewport)).toMatchObject({ kind: "symbol", text: "symbol", isSlot: false });
  expect(exportStructuredLisp(viewport.widget())).toBe("symbol");
});

test("switching documents discards the source field without adding edits to the old history", () => {
  const { viewport, history } = editor();
  const field = insert(viewport);
  type(viewport, field, "value ");
  const before = history.undoCount();
  viewport.show(createStructuredLisp("replacement"));
  expect(field).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(viewport.showingEditor()).toBe(false);
  expect(history.undoCount()).toBe(before);
  expect(exportStructuredLisp(viewport.widget())).toBe("replacement");
});

test("c replaces one token with one undo step and restores its starting selection", () => {
  const { viewport, history } = editor(createStructuredLisp("(define old-name 3)"));
  pick(viewport, "old-name");
  const id = viewport.node().id();
  expect(press(viewport, "c")).toBe(true);
  const field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
  expect(field).toHaveValue("");
  expect(selected(viewport).nodeId).toBe(id);
  type(viewport, field, "new-name");
  escape(field);
  expect(history.undoCount()).toBe(1);
  expect(exportStructuredLisp(viewport.widget())).toBe("(define new-name 3)");
  press(viewport, "u");
  expect(exportStructuredLisp(viewport.widget())).toBe("(define old-name 3)");
  expect(viewport.node().id()).toBe(id);
  press(viewport, "y");
  expect(exportStructuredLisp(viewport.widget())).toBe("(define new-name 3)");
  expect(viewport.node().id()).toBe(id);
});

test("untouched i/o/O sessions preserve the document and an existing redo branch", () => {
  const { viewport, history } = editor(createStructuredLisp("(a\r\n\t b)\r\n"));
  pick(viewport, "b");
  press(viewport, "c");
  let field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
  type(viewport, field, "changed");
  escape(field);
  press(viewport, "u");
  const before = writeGraph(viewport.widget(), viewport.node(), viewport.toJSON());
  for (const key of ["i", "o", "O"]) {
    expect(press(viewport, key)).toBe(true);
    field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
    escape(field);
    expect(writeGraph(viewport.widget(), viewport.node(), viewport.toJSON())).toEqual(before);
    expect(history.undoCount()).toBe(0);
    expect(history.redoCount()).toBe(1);
  }
  press(viewport, "y");
  expect(exportStructuredLisp(viewport.widget())).toBe("(a\r\n\t changed)\r\n");
});

test("undo during insertion finishes the session and redo restores complete source", () => {
  const { viewport, history } = editor(createStructuredLisp("old"));
  pick(viewport, "old");
  press(viewport, "c");
  const field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
  type(viewport, field, "new   ");
  viewport.undo();
  expect(field).not.toBeInTheDocument();
  expect(exportStructuredLisp(viewport.widget())).toBe("old");
  expect(history.redoCount()).toBe(1);
  viewport.redo();
  expect(exportStructuredLisp(viewport.widget())).toBe("new   ");
  expect(structuredLispStatus(viewport.widget()).complete).toBe(true);
  expect(history.undoCount()).toBe(1);
});

test("o opens after the whole source row and carries indentation into source input", () => {
  const { viewport, history } = editor(createStructuredLisp("(a b\r\n\t c d)"));
  pick(viewport, "c"); // d is still on this row; opening below must keep it there.
  press(viewport, "o");
  const field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
  type(viewport, field, "(debug)");
  escape(field);
  expect(exportStructuredLisp(viewport.widget())).toBe("(a b\r\n\t c d\r\n\t (debug))");
  expect(history.undoCount()).toBe(1);
  press(viewport, "u");
  expect(exportStructuredLisp(viewport.widget())).toBe("(a b\r\n\t c d)");
  expect(viewport.node().value()).toBe("c");
});

test("a manual function refactor retains existing identities and formatting through source entry and history", () => {
  const original = "; Keep this header.\r\n(define (score value)\r\n\t(+ value value))\r\n\r\n(score 3)  \r\n";
  const { viewport, history } = editor(createStructuredLisp(original));
  const originalIds = graphNodes(viewport.widget()).map((node) => node.id());
  const variableIds = graphNodes(viewport.widget()).filter((node) => node.value() === "value").map((node) => node.id());
  const restoreHistory = () => {
    viewport.show(history.widget(), history.viewportData());
    viewport.moveToId(history.selectedNode());
  };
  viewport.setUndo(() => { history.undo(); restoreHistory(); });
  viewport.setRedo(() => { history.redo(); restoreHistory(); });
  let navigationCount = 0;
  const navigate = (...keys) => keys.forEach((key) => {
    expect(press(viewport, key)).toBe(true);
    navigationCount++;
  });
  const rename = (expected, replacement) => {
    expect(selected(viewport).text).toBe(expected);
    const id = viewport.node().id();
    expect(press(viewport, "c")).toBe(true);
    const field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
    expect(field).toHaveValue("");
    type(viewport, field, replacement);
    escape(field);
    expect(viewport.container()).toHaveFocus();
    expect(viewport.node().id()).toBe(id);
  };

  // Rename the parameter and its two uses through normal structural navigation.
  navigate("e", "e", "l", "e", "l");
  rename("value", "amount");
  navigate("q", "l", "e", "l");
  rename("value", "amount");
  navigate("l");
  rename("value", "amount");
  variableIds.forEach((id) => expect(inspectLispSelection(viewport.widget(), id).text).toBe("amount"));
  expect(exportStructuredLisp(viewport.widget())).toBe(original.replaceAll("value", "amount"));

  // Change the operation, then append an operand inside the body container.
  navigate("h", "h");
  rename("+", "*");
  navigate("q");
  let field = insert(viewport);
  type(viewport, field, " 2");
  escape(field);
  const modified = original.replaceAll("value", "amount").replace("(+ amount amount)", "(* amount amount 2)");
  expect(exportStructuredLisp(viewport.widget())).toBe(modified);

  // O opens a row before the body and inherits its existing tab indentation.
  navigate("q");
  expect(press(viewport, "O")).toBe(true);
  field = screen.getByRole("textbox", { name: "Insert Lisp/Scheme source" });
  type(viewport, field, "(display amount)");
  escape(field);
  const debugId = viewport.node().id();
  expect(selected(viewport).kind).toBe("list");
  const withDebug = modified.replace("\r\n\t(*", "\r\n\t(display amount)\r\n\t(*");
  expect(exportStructuredLisp(viewport.widget())).toBe(withDebug);
  expect(navigationCount).toBe(14);
  expect(history.undoCount()).toBe(6);
  const saved = writeGraph(viewport.widget(), viewport.node(), viewport.toJSON());
  const restored = readGraph(saved);
  expect(graphSelection(saved)).toBe(debugId);
  expect(exportStructuredLisp(restored)).toBe(withDebug);
  originalIds.forEach((id) => expect(graphNodes(restored).some((node) => node.id() === id)).toBe(true));

  // One undo removes the entire insertion, including the temporary slot.
  expect(press(viewport, "u")).toBe(true);
  expect(exportStructuredLisp(viewport.widget())).toBe(modified);
  expect(press(viewport, "y")).toBe(true);
  expect(exportStructuredLisp(viewport.widget())).toBe(withDebug);
  expect(viewport.node().id()).toBe(debugId);

  // Remove only the debugging form; undo restores its identity and exact text.
  expect(press(viewport, "x")).toBe(true);
  const removed = exportStructuredLisp(viewport.widget());
  expect(press(viewport, "u")).toBe(true);
  expect(exportStructuredLisp(viewport.widget())).toBe(withDebug);
  expect(graphNodes(viewport.widget()).some((node) => node.id() === debugId)).toBe(true);
  expect(press(viewport, "y")).toBe(true);
  expect(exportStructuredLisp(viewport.widget())).toBe(removed);
  expect(viewport.logMessage).not.toHaveBeenCalled();
  expect(removed).toBe(modified);
});
