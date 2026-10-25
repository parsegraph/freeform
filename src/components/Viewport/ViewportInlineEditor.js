import { graphNodes } from "../../graphDocument";
import { inspectStructuredSelection, structuredDocumentAdapter } from "../../structuredDocument";
import { FONT_SIZE, LINE_HEIGHT } from "../../settings";
import "./ViewportInlineEditor.css";

/** Project the published node, rather than a replacement still being laid out. */
export function inlineEditorBox(node, camera) {
  const layout = node?.layout();
  if (!layout || layout.needsCommit() || layout.needsAbsolutePos()) return null;
  const size = [0, 0];
  layout.size(size);
  const scale = layout.absoluteScale() * camera.scale();
  const width = size[0] * scale;
  const height = size[1] * scale;
  const x = (layout.absoluteX() + camera.x()) * camera.scale();
  const y = (layout.absoluteY() + camera.y()) * camera.scale();
  if (![x, y, width, height, scale].every(Number.isFinite) || scale <= 0) return null;
  return { x, y, width, height, scale };
}

/** One native textarea, anchored to a semantic value for the lifetime of an edit. */
export default class ViewportInlineEditor {
  constructor(viewport) {
    this.viewport = viewport;
  }

  active() { return !!this.element; }

  open() {
    const viewport = this.viewport;
    const selection = inspectStructuredSelection(viewport.widget(), viewport.node());
    if (!selection.canEdit) return false;
    if (!this.close(false)) return false;
    viewport.moveToId(selection.nodeId);
    viewport.input()?.stopPan?.();
    viewport.cancelCameraTravel();
    viewport.clearShowingInCamera();
    viewport.clearCheckScale();
    viewport.clearEnsuringVisible();
    this.nodeId = selection.nodeId;
    this.kind = selection.kind;
    this.language = structuredDocumentAdapter(viewport.widget()).id;
    viewport.beginHistoryGroup();
    this.rawHistoryGroup = true;
    // Lisp edits raw tokens, including block comments and quoted symbols;
    // preserve their line breaks while the grammar reports unfinished syntax.
    this.multiline = this.kind === "string" || this.language === "lisp";
    this.geometryRoot = null;
    this.geometryNode = null;
    const element = document.createElement("textarea");
    this.element = element;
    element.className = "graph-inline-editor";
    element.setAttribute("aria-label", `Edit ${selection.kind} in graph`);
    element.title = "Enter to finish · Shift+Enter for a newline · Escape to finish · Changes are saved as you type";
    element.spellcheck = false;
    element.wrap = "off";
    element.value = selection.text;
    element.rows = 1;
    if (selection.kind === "number") element.inputMode = "decimal";
    // A sibling of the graph cannot start a graph drag or intercept its wheel.
    document.body.appendChild(element);
    for (const event of ["pointerdown", "mousedown", "mouseup", "touchstart", "touchmove", "wheel"]) {
      element.addEventListener(event, (e) => e.stopPropagation());
    }
    element.addEventListener("compositionstart", () => { this.composing = true; });
    element.addEventListener("compositionend", () => { this.composing = false; });
    element.addEventListener("input", () => this.acceptInput());
    element.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" ||
          (event.key === "Enter" && !(event.shiftKey && this.multiline))) {
        event.preventDefault();
        if (event.repeat) return;
        // Finishing an untouched key slot explicitly accepts the valid key "".
        if (event.key === "Enter" && this.language === "json" && this.kind === "key") {
          try {
            const selected = inspectStructuredSelection(viewport.widget(), viewport.node());
            if (selected.isSlot && !this.acceptInput()) return;
          } catch (error) { viewport.logMessage(error.message); return; }
        }
        this.close(true);
      }
    });
    element.addEventListener("blur", () => this.close(false));
    this.update();
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
    return true;
  }

  acceptInput() {
    if (!this.element) return false;
    this.applying = true;
    try {
      if (this.viewport.applyStructuredCommand(
        { type: "setText", text: this.element.value }, this.nodeId
      ) === false) throw new Error("The edit could not be applied. Your text is still here.");
      this.element.setCustomValidity("");
      this.failedInput = false;
      return true;
    } catch (error) {
      this.failedInput = true;
      this.element.setCustomValidity(error.message);
      this.viewport.logMessage(error.message);
      return false;
    } finally { this.applying = false; }
  }

  update() {
    if (this.applying) return;
    const element = this.element;
    if (!element) return;
    const viewport = this.viewport;
    if (viewport.node()?.id() !== this.nodeId) {
      this.close(false);
      return;
    }
    const published = viewport.rendering()?.publishedRoot?.();
    if (published !== this.geometryRoot) {
      this.geometryRoot = published;
      this.geometryNode = published && graphNodes(published).find((node) => node.id() === this.nodeId);
    }
    const camera = viewport.camera();
    const box = inlineEditorBox(this.geometryNode ?? (!published ? viewport.node() : null), camera);
    // During a pending layout keep the previous rectangle; don't jump to NaN
    // or to the new geometry before its corresponding frame appears.
    if (box) this.lastBox = box;
    const position = box ?? this.lastBox ?? {
      x: camera.width() / 2, y: camera.height() / 2,
      width: 180, height: 42, scale: 1,
    };
    const width = Math.max(80, Math.min(position.width, camera.width() - 24));
    const height = Math.max(32, Math.min(position.height, Math.min(300, camera.height() - 24)));
    const left = Math.max(8, Math.min(camera.width() - width - 8, position.x - width / 2));
    const top = Math.max(8, Math.min(camera.height() - height - 8, position.y - height / 2));
    const style = viewport.getNodeStyle();
    const bounds = viewport.container()?.getBoundingClientRect();
    Object.assign(element.style, {
      left: `${left + (bounds?.left ?? 0)}px`,
      top: `${top + (bounds?.top ?? 0)}px`,
      width: `${width}px`, height: `${height}px`,
      fontSize: `${Math.max(14, Math.min(64, FONT_SIZE * position.scale))}px`,
      lineHeight: `${Math.max(18, Math.min(80, LINE_HEIGHT * position.scale))}px`,
      backgroundColor: style.backgroundColor, color: style.textColor,
      borderColor: style.borderColor,
    });
  }

  close(focusGraph = false) {
    if (!this.element) return true;
    if (this.composing || (this.failedInput && !this.acceptInput())) {
      this.element.focus({ preventScroll: true });
      return false;
    }
    this.discard();
    if (focusGraph) this.viewport.container()?.focus({ preventScroll: true });
    return true;
  }

  /** Document changes discard the field without replaying input into another graph. */
  discard() {
    if (!this.element) return;
    const element = this.element;
    this.element = null;
    this.nodeId = null;
    this.language = null;
    this.multiline = false;
    this.lastBox = null;
    this.composing = false;
    this.failedInput = false;
    element.remove();
    if (this.rawHistoryGroup) {
      this.rawHistoryGroup = false;
      this.viewport.endHistoryGroup();
    }
  }
}
