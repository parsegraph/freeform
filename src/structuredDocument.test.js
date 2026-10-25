import { DirectionNode } from "parsegraph";
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
  expect(isStructuredDocument(restored)).toBe(true);
  expect(structuredDocumentAdapter(restored)).toMatchObject({ id: "lisp", label: "Lisp/Scheme" });
  expect(exportStructuredLisp(restored)).toBe('(display "world")');
  expect(inspectStructuredSelection(restored, target.id())).toMatchObject({ kind: "string", text: '"world"' });
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
