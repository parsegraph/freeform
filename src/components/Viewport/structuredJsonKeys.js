import { Direction } from "parsegraph";
import {
  inspectJsonSelection,
  isStructuredJson,
  jsonKeyboardTarget,
} from "../../structuredJson";

const DIRECTIONS = new Map([
  ["h", Direction.BACKWARD],
  ["a", Direction.BACKWARD],
  ["j", Direction.DOWNWARD],
  ["s", Direction.DOWNWARD],
  ["k", Direction.UPWARD],
  ["w", Direction.UPWARD],
  ["l", Direction.FORWARD],
  ["d", Direction.FORWARD],
]);
const ARROWS = new Map([
  ["ArrowLeft", Direction.BACKWARD],
  ["ArrowRight", Direction.FORWARD],
  ["ArrowUp", Direction.UPWARD],
  ["ArrowDown", Direction.DOWNWARD],
]);

/** Grammar-aware commands while graph navigation has focus. Textboxes own text. */
export function handleStructuredJsonKey(viewport, event) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target?.closest?.("input, textarea, select, [contenteditable]")
  )
    return false;
  const root = viewport.widget();
  if (!isStructuredJson(root) || viewport.showingEditor()) return false;
  const showingUI = viewport.rendering().showingUI();
  if (!showingUI && !viewport.navigatingNodes()) return false;
  const key = event.key;
  const node = viewport.node();
  const target = (action) => jsonKeyboardTarget(root, node, action);
  const select = (next) => {
    if (next) viewport.selectNode(next);
  };
  const command = (value) => {
    if (!event.repeat) viewport.applyStructuredCommand(value);
  };
  try {
    // Arrows retain camera panning in Edit mode; in View mode they follow nodes.
    const direction =
      DIRECTIONS.get(key) ?? (!showingUI ? ARROWS.get(key) : undefined);
    if (direction !== undefined) {
      if (!viewport.moveToNeighbor(direction)) {
        if (direction === Direction.DOWNWARD) select(target("next"));
        if (direction === Direction.UPWARD) select(target("previous"));
      }
      return true;
    }
    if (key === ":") {
      select(target("value"));
      return true;
    }
    if (["]", "}", "o", "q"].includes(key)) {
      select(target("container"));
      return true;
    }
    if (key === "i" || key === "e") {
      const next = target("enter");
      if (next) select(next);
      else if (inspectJsonSelection(root, node).entryCount === 0)
        command({ type: "add" });
      return true;
    }
    if (key === ",") {
      command({ type: "insertSibling" });
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
    if (key === "u" || key === "z") {
      if (!event.repeat) {
        const following = viewport.navigatingNodes();
        viewport.undo();
        if (following) viewport.selectNode(viewport.node());
      }
      return true;
    }
    if (key === "y" || key === "R") {
      if (!event.repeat) {
        const following = viewport.navigatingNodes();
        viewport.redo();
        if (following) viewport.selectNode(viewport.node());
      }
      return true;
    }
    // In particular, camera arrows and modifier-only keys must stay cheap.
    if (!['"', "[", "{", "t", "f", "n"].includes(key) && !/^[0-9-]$/.test(key))
      return false;
    if (event.repeat && ["t", "f", "n"].includes(key)) return true;
    const selection = inspectJsonSelection(root, node);
    // Only an unfilled value slot interprets literal syntax. Existing values
    // require explicit replacement, so navigation cannot destroy their contents.
    if (selection.kind !== "slot") return false;
    let replacement;
    let edit = false;
    if (key === '"') {
      replacement = { kind: "string" };
      edit = true;
    } else if (key === "[") replacement = { kind: "array" };
    else if (key === "{") replacement = { kind: "object" };
    else if (/^[0-9-]$/.test(key)) {
      replacement = { kind: "number", text: key };
      edit = true;
    } else if (key === "t" || key === "f")
      replacement = { kind: "boolean", text: key === "t" ? "true" : "false" };
    else if (key === "n") replacement = { kind: "null" };
    if (!replacement) return false;
    command({ type: "replace", ...replacement });
    if (edit && !event.repeat) viewport.showEditor();
    return true;
  } catch (error) {
    viewport.logMessage(error.message);
    return true;
  }
}
