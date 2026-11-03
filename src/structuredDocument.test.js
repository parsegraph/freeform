import { Bidi, DirectionNode } from "parsegraph";
import { createStructuredJson, exportStructuredJson } from "./structuredJson";
import { createStructuredLisp, exportStructuredLisp } from "./structuredLisp";
import { documentState, graphNodes, readGraph, writeGraph } from "./graphDocument";
import {
  applyStructuredCommand,
  inspectStructuredSelection,
  isStructuredDocument,
  structuredDocumentAdapter,
  structuredDocumentStatus,
  structuredKeyboardTarget,
} from "./structuredDocument";

test("the shared operations retain JSON's existing value and draft semantics", () => {
  const graph = createStructuredJson([1]);
  expect(writeGraph(graph).version).toBe(2);
  expect(documentState(graph).metadata.freeform.structuredJson.version).toBe(1);
  expect(structuredDocumentAdapter(graph)).toMatchObject({ id: "json", label: "JSON" });
  const target = structuredKeyboardTarget(graph, graph, "enter");
  const result = applyStructuredCommand(graph, target, { type: "setText", text: "2" });
  expect(exportStructuredJson(result.root)).toEqual([2]);
  expect(inspectStructuredSelection(result.root, result.selectedNode)).toMatchObject({ kind: "number", text: "2" });
  expect(structuredDocumentStatus(result.root)).toMatchObject({ complete: true, validStructure: true });
});

test("Lisp native round trips dispatch to Lisp grammar and preserve quoted source tokens", () => {
  const graph = createStructuredLisp('(display "hello")');
  const target = graphNodes(graph).find((node) => node.value() === '"hello"');
  const result = applyStructuredCommand(graph, target, { type: "setText", text: '"world"' });
  const restored = readGraph(writeGraph(result.root));
  expect(writeGraph(restored).version).toBe(2);
  expect(documentState(restored).metadata.freeform.structuredLisp.version).toBe(1);
  expect(isStructuredDocument(restored)).toBe(true);
  expect(structuredDocumentAdapter(restored)).toMatchObject({ id: "lisp", label: "Lisp/Scheme" });
  expect(exportStructuredLisp(restored)).toBe('(display "world")');
  expect(inspectStructuredSelection(restored, target.id())).toMatchObject({ kind: "string", text: '"world"' });
});

test.each([
  ["JSON", () => createStructuredJson([1]), exportStructuredJson, [2]],
  ["Lisp", () => createStructuredLisp("(1)"), exportStructuredLisp, "(2)"],
])("legacy %s rebuilds retain their source version and explicit LTR root while saving v2", (name, create, exportSource, expected) => {
  const legacy = writeGraph(create());
  legacy.version = 1;
  legacy.nodes = legacy.nodes.map(({ bidi, ...node }) => ({ ...node, rightToLeft: true }));
  const imported = readGraph(legacy);
  expect(documentState(imported)).toMatchObject({ version: 2, sourceVersion: 1 });
  expect(imported.bidi()).toBe(Bidi.LTR);
  expect(graphNodes(imported).filter((node) => node !== imported)
    .every((node) => node.bidi() === Bidi.INHERIT)).toBe(true);
  const target = graphNodes(imported).find((node) => node.value() === "1");
  const result = applyStructuredCommand(imported, target, { type: "setText", text: "2" });
  expect(documentState(result.root)).toMatchObject({ version: 2, sourceVersion: 1 });
  expect(result.root.bidi()).toBe(Bidi.LTR);
  expect(exportSource(result.root)).toEqual(expected);
  const current = writeGraph(result.root);
  expect(current.version).toBe(2);
  expect(current.nodes.every((node) => "bidi" in node && !("rightToLeft" in node))).toBe(true);
  expect(exportSource(readGraph(current))).toEqual(expected);
});

test("ordinary graphs are not routed to a language and ambiguous grammar metadata is rejected", () => {
  const graph = new DirectionNode("ordinary");
  expect(isStructuredDocument(graph)).toBe(false);
  expect(structuredDocumentAdapter(graph)).toBeNull();
  expect(() => applyStructuredCommand(graph, graph, { type: "clear" })).toThrow("not a structured document");
  const ambiguous = createStructuredJson(1);
  documentState(ambiguous).metadata.freeform.structuredLisp = { version: 1, nodes: {} };
  expect(() => structuredDocumentAdapter(ambiguous)).toThrow("both JSON and Lisp/Scheme");
});
