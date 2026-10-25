import ViewportInlineEditor from "./ViewportInlineEditor";
import {
  beginLispSourceInput,
  editLispSourceInput,
  finishLispSourceInput,
} from "../../structuredLisp";

/** Native text input for source entry, reanchored as tokens become graph forms. */
export default class ViewportLispSourceInput extends ViewportInlineEditor {
  open(options = {}) {
    if (this.active()) return true;
    const viewport = this.viewport;
    const result = beginLispSourceInput(viewport.widget(), viewport.node(), options);
    this.initial = { root: viewport.widget(), selectedNode: viewport.node() };
    this.mode = options.mode || "insert";
    this.hasInput = false;
    viewport.input()?.stopPan?.();
    viewport.cancelCameraTravel();
    viewport.clearShowingInCamera();
    viewport.clearCheckScale();
    viewport.clearEnsuringVisible();
    viewport.beginHistoryGroup();
    this.historyGroup = true;
    const element = document.createElement("textarea");
    this.element = element;
    element.className = "graph-inline-editor graph-source-input";
    element.setAttribute("aria-label", "Insert Lisp/Scheme source");
    element.title = "INSERT · Type source · Escape returns to navigation";
    element.spellcheck = false;
    element.wrap = "off";
    element.rows = 1;
    const badge = document.createElement("div");
    badge.className = "graph-source-mode";
    badge.textContent = "INSERT · Esc to navigate";
    badge.setAttribute("role", "status");
    this.badge = badge;
    document.body.append(element, badge);
    for (const name of ["pointerdown", "mousedown", "mouseup", "touchstart", "touchmove", "wheel"]) {
      element.addEventListener(name, (event) => event.stopPropagation());
    }
    element.addEventListener("compositionstart", () => { this.composing = true; });
    element.addEventListener("compositionend", () => {
      this.composing = false;
      this.acceptInput();
    });
    element.addEventListener("input", (event) => {
      if (!this.composing && !event.isComposing) this.acceptInput();
    });
    element.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (this.composing || event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!event.repeat) this.close(true);
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey &&
          (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        element.setRangeText(event.key === "Enter" ? "\n" : "\t",
          element.selectionStart, element.selectionEnd, "end");
        this.acceptInput();
      }
    });
    element.addEventListener("blur", () => { if (!this.closing) this.close(false); });
    try { this.acceptResult(result); }
    catch (error) { this.discard(); throw error; }
    element.focus({ preventScroll: true });
    return true;
  }

  acceptResult(result) {
    this.applying = true;
    try {
      this.state = result.state;
      if (this.nodeId !== result.selectedNode.id()) this.geometryRoot = null;
      this.nodeId = result.selectedNode.id();
      this.element.value = result.text;
      this.element.setSelectionRange(result.caret, result.caret);
      this.element.setCustomValidity("");
      this.failedInput = false;
      this.viewport.applyStructuredResult(result);
    } finally { this.applying = false; }
    this.update();
  }

  acceptInput() {
    if (!this.active() || this.composing) return false;
    try {
      const result = editLispSourceInput(this.viewport.widget(), this.state,
        this.element.value, this.element.selectionStart);
      this.hasInput = true;
      this.acceptResult(result);
      return true;
    } catch (error) {
      // Keep rejected input in its native field so it can be corrected.
      this.failedInput = true;
      this.element.setCustomValidity(error.message);
      this.viewport.logMessage(error.message);
      return false;
    }
  }

  update() {
    if (this.applying || this.closing) return;
    super.update();
    if (this.badge && this.element) Object.assign(this.badge.style, {
      left: this.element.style.left,
      top: `${Math.max(4, parseFloat(this.element.style.top) - 24)}px`,
    });
  }

  close(focusGraph = false) {
    if (!this.active() || this.closing) return true;
    if (this.composing || (this.failedInput && !this.acceptInput())) {
      this.element.focus({ preventScroll: true });
      return false;
    }
    const viewport = this.viewport;
    try {
      // Merely entering insertion should preserve even custom geometry and
      // focus settings on connections temporarily rearranged by a new row.
      const result = !this.hasInput && this.mode !== "change" ? this.initial
        : finishLispSourceInput(viewport.widget(), this.state);
      const selectionId = viewport.node().id() === this.nodeId
        ? result.selectedNode.id() : viewport.node().id();
      this.discard(false);
      viewport.applyStructuredResult(result, { selectionId });
      this.endHistoryGroup();
      if (focusGraph) viewport.container()?.focus({ preventScroll: true });
      return true;
    } catch (error) {
      this.element?.setCustomValidity(error.message);
      if (!this.element) this.endHistoryGroup();
      viewport.logMessage(error.message);
      return false;
    }
  }

  /** Switching documents or undoing must not write into the departing history. */
  endHistoryGroup() {
    if (!this.historyGroup) return;
    this.historyGroup = false;
    this.viewport.endHistoryGroup();
  }

  discard(endGroup = true) {
    this.closing = true;
    super.discard();
    this.badge?.remove();
    this.badge = null;
    this.state = null;
    this.initial = null;
    this.failedInput = false;
    this.closing = false;
    if (endGroup) this.endHistoryGroup();
  }
}
