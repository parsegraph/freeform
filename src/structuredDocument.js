import {
  applyJsonCommand,
  inspectJsonSelection,
  isStructuredJson,
  jsonKeyboardTarget,
  structuredJsonStatus,
} from "./structuredJson";
import {
  applyLispCommand,
  inspectLispSelection,
  isStructuredLisp,
  lispKeyboardTarget,
  structuredLispStatus,
} from "./structuredLisp";

// Keep language operations behind one dispatch point. Graph geometry and the
// editor's interaction lifecycle do not need to know each document grammar.
const JSON_ADAPTER = Object.freeze({
  id: "json",
  label: "JSON",
  inspect: inspectJsonSelection,
  command: applyJsonCommand,
  status: structuredJsonStatus,
  keyboardTarget: jsonKeyboardTarget,
});
const LISP_ADAPTER = Object.freeze({
  id: "lisp",
  label: "Lisp/Scheme",
  inspect: inspectLispSelection,
  command: applyLispCommand,
  status: structuredLispStatus,
  keyboardTarget: lispKeyboardTarget,
});

export function structuredDocumentAdapter(root) {
  const json = isStructuredJson(root), lisp = isStructuredLisp(root);
  if (json && lisp) throw new Error("A document cannot declare both JSON and Lisp/Scheme structure.");
  if (json) return JSON_ADAPTER;
  if (lisp) return LISP_ADAPTER;
  return null;
}

export const isStructuredDocument = (root) => structuredDocumentAdapter(root) !== null;

function requireAdapter(root) {
  const adapter = structuredDocumentAdapter(root);
  if (!adapter) throw new Error("This graph is not a structured document.");
  return adapter;
}

export const inspectStructuredSelection = (root, node) => requireAdapter(root).inspect(root, node);
export const applyStructuredCommand = (root, node, command) => requireAdapter(root).command(root, node, command);
export const structuredDocumentStatus = (root) => requireAdapter(root).status(root);
export const structuredKeyboardTarget = (root, node, action) => requireAdapter(root).keyboardTarget(root, node, action);
