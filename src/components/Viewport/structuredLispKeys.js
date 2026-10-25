import {
  inspectLispSelection,
  isStructuredLisp,
  lispKeyboardTarget,
} from "../../structuredLisp";

const NAVIGATION = new Map([
  ["h", "previous"], ["a", "previous"],
  ["j", "down"], ["s", "down"],
  ["k", "up"], ["w", "up"],
  ["l", "next"], ["d", "next"],
]);
const ARROWS = new Map([
  ["ArrowLeft", "previous"], ["ArrowRight", "next"],
  ["ArrowUp", "up"], ["ArrowDown", "down"],
]);
const PREFIXES = new Map([
  ["'", "quote"], ["`", "quasiquote"], [",", "unquote"],
  ["@", "unquote-splicing"],
]);

/** Lisp punctuation edits syntax; native fields retain ordinary text input. */
export function handleStructuredLispKey(viewport, event) {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey ||
      event.target?.closest?.("input, textarea, select, [contenteditable]")) return false;
  const root = viewport.widget();
  if (!isStructuredLisp(root) || viewport.showingEditor()) return false;
  const showingUI = viewport.rendering().showingUI();
  if (!showingUI && !viewport.navigatingNodes()) return false;
  const key = event.key, node = viewport.node();
  const select = (next) => { if (next) viewport.selectNode(next); };
  const target = (action) => lispKeyboardTarget(root, node, action);
  const command = (value) => { if (!event.repeat) viewport.applyStructuredCommand(value); };
  try {
    // Keep camera arrows available in Edit mode, as in the JSON editor.
    const navigation = NAVIGATION.get(key) ?? (!showingUI ? ARROWS.get(key) : undefined);
    if (navigation !== undefined) {
      // Follow semantic siblings and source rows, including column matching.
      select(target(navigation));
      return true;
    }
    if ([")", "q"].includes(key)) {
      select(target("container"));
      return true;
    }
    if (key === "i") {
      if (!event.repeat) viewport.showLispSourceInput();
      return true;
    }
    if (key === "c" || key === "o" || key === "O") {
      if (event.repeat) return true;
      if (key === "c" && !inspectLispSelection(root, node).canEdit)
        throw new Error("Scheme: select a token or slot to change.");
      viewport.showLispSourceInput({
        mode: key === "c" ? "change" : key === "o" ? "below" : "above",
      });
      return true;
    }
    if (key === "e") {
      const next = target("enter");
      if (next) select(next);
      else if (inspectLispSelection(root, node).entryCount === 0) command({ type: "add" });
      return true;
    }
    if (key === " " || key === "Spacebar") {
      command({ type: "insertSibling" });
      return true;
    }
    if (key === "Enter" && event.shiftKey) {
      command({ type: "insertSibling", newline: true });
      return true;
    }
    if (key === "Enter" || key === "Insert") {
      if (!event.repeat) viewport.toggleEditor();
      return true;
    }
    if (key === "x" || key === "Backspace") {
      if (!event.repeat) viewport.removeNode();
      return true;
    }
    if (key === "u" || key === "z" || key === "y" || key === "R") {
      if (!event.repeat) {
        const following = viewport.navigatingNodes();
        if (key === "u" || key === "z") viewport.undo();
        else viewport.redo();
        if (following) viewport.selectNode(viewport.node());
      }
      return true;
    }
    const literal = key === '"' ? "string"
      : /^[0-9-]$/.test(key) ? "number"
      : key === "#" ? "boolean"
      : key === ";" ? "comment" : null;
    if (literal) {
      // As in JSON, literal syntax only fills a slot. Existing values require
      // an explicit edit; '-' still zooms when there is no empty slot.
      if (inspectLispSelection(root, node).kind !== "slot") return false;
      command({ type: "replace", kind: literal, text: key });
      if (!event.repeat) viewport.showEditor();
      return true;
    }
    if (key !== "(" && !PREFIXES.has(key)) return false;
    if (event.repeat) return true;
    const selected = inspectLispSelection(root, node);
    const kind = key === "(" ? "list" : PREFIXES.get(key);
    if (selected.kind === "slot") command({ type: "replace", kind });
    else if (selected.canWrap) command({ type: "wrap", kind });
    // Reader prefixes contain an operand, so put the selection on it next.
    if (key !== "(" && (selected.kind === "slot" || selected.canWrap)) {
      select(lispKeyboardTarget(viewport.widget(), viewport.node(), "enter"));
    }
    return true;
  } catch (error) {
    viewport.logMessage(error.message);
    return true;
  }
}
