import {
  Direction,
  Alignment,
  DirectionCaret,
  Axis,
  reverseDirection,
  getDirectionAxis,
  PreferredAxis,
  Fit,
  namePreferredAxis,
  nameDirection,
  nameAlignment,
} from "parsegraph";
import Color from "parsegraph-color";
import Camera from "parsegraph-camera";
import {
  MAX_RENDER_ATTEMPTS,
  CRANK_SPEED_MS,
  DEFAULT_NODE_STYLE,
  USE_LOCAL_STORAGE,
  ENABLE_EXTENT_VIEWING,
  nodeHasValue,
  MAX_PAINT_TIME_MS,
  SLOW_RENDER,
} from "../../settings";
import ViewportRendering from "./ViewportRendering";
import ViewportInput from "./ViewportInput";
import ViewportCameraTravel from "./ViewportCameraTravel";
import ViewportInlineEditor from "./ViewportInlineEditor";
import ViewportLispSourceInput from "./ViewportLispSourceInput";
import { handleStructuredJsonKey } from "./structuredJsonKeys";
import { handleStructuredLispKey } from "./structuredLispKeys";
import Carousel from "../Carousel";
import { documentState, ensureStringIds } from "../../graphDocument";
import {
  applyStructuredCommand as runStructuredCommand,
  inspectStructuredSelection,
  isStructuredDocument,
  structuredDocumentAdapter,
} from "../../structuredDocument";
import { jsonNodeAppearance } from "../../structuredJsonAppearance";
import { lispNodeAppearance } from "../../structuredLispAppearance";
import { benchmarkFor, measureBenchmark } from "../../benchmark";
import {
  interactionRecording,
  measureInteraction,
  recordInteraction,
} from "../../interactionBenchmark";

const findNodeById = (root, id) => {
  let foundNode = null;
  root.paintGroup().forEach((pg) => {
    pg.siblings().forEach((node) => {
      if (node.id() === id) {
        foundNode = node;
      }
    });
  });
  return foundNode;
};

const invalidateAll = (root) => {
  root.paintGroup().forEach((pg) => {
    pg.siblings().forEach((node) => node.invalidate());
  });
};

const nextAlignment = (alignment, childDir) => {
  if (getDirectionAxis(childDir) === Axis.Z) {
    if (alignment === Alignment.INWARD_VERTICAL) {
      return Alignment.INWARD_HORIZONTAL;
    }
    return Alignment.INWARD_VERTICAL;
  }
  switch (alignment) {
    case Alignment.NEGATIVE:
      return Alignment.CENTER;
    case Alignment.CENTER:
      return Alignment.POSITIVE;
    case Alignment.POSITIVE:
      return Alignment.NONE;
    default:
      return Alignment.NEGATIVE;
  }
};

const createDefaultNodeStyle = () => {
  return {
    backgroundColor: DEFAULT_NODE_STYLE.backgroundColor.asHex(),
    borderColor: DEFAULT_NODE_STYLE.borderColor.asHex(),
    lineColor: DEFAULT_NODE_STYLE.lineColor.asHex(),
    textColor: DEFAULT_NODE_STYLE.textColor.asHex(),
    backgroundAlpha: DEFAULT_NODE_STYLE.backgroundColor.a(),
    borderAlpha: DEFAULT_NODE_STYLE.borderColor.a(),
    lineAlpha: DEFAULT_NODE_STYLE.lineColor.a(),
    textAlpha: DEFAULT_NODE_STYLE.textColor.a(),
  };
};

export default class Viewport {
  clearShowingInCamera() {
    this._showInCamera = false;
  }

  showingInCamera() {
    return this._showInCamera;
  }

  clearCheckScale() {
    this._checkScale = false;
  }

  checkingScale() {
    return this._checkScale;
  }

  constructor() {
    this._saveGraph = () => {};
    this._container = null;

    this._showInCamera = true;
    this._ensureVisible = true;
    this._checkScale = true;
    this._fitGraphRequested = false;

    // Create and restore the camera if possible
    this._cam = new Camera();
    this._cameraTravel = new ViewportCameraTravel(this);
    if (USE_LOCAL_STORAGE) {
      try {
        this._cam.restore(
          JSON.parse(localStorage.getItem("parsegraph-camera"))
        );
        this._showInCamera = false;
      } catch (ex) {
        console.log(ex);
      }
    }

    this._nodeStyles = new WeakMap();
    this._defaultNodeStyle = createDefaultNodeStyle();
    this._rendering = null;
    this._showEditor = false;
  }

  input() {
    return this._input;
  }

  rendering() {
    return this._rendering;
  }

  toggleCrease() {
    const car = this.caret();
    if (car.node().paintGroups().isPaintGroup()) {
      this.logMessage("Uncreasing");
      car.uncrease();
    } else {
      this.logMessage("Creasing");
      car.crease();
    }
    this.repaint();
    this.save();
  }

  mountStatus(statusContainer) {
    if (this.statusElem().parentElement === statusContainer) {
      return;
    }
    statusContainer.appendChild(this.statusElem());
    this.setStatus(null);
  }

  progressElemText() {
    if (!this._progressElemText) {
      this._progressElemText = document.createElement("span");
      this._progressElemText.style.position = "absolute";
      this._progressElemText.style.left = "50%";
      this._progressElemText.style.top = "50%";
      this._progressElemText.style.transform = "translate(-50%, -50%)";
      this.progressElem().appendChild(this._progressElemText);
    }
    return this._progressElemText;
  }

  progressElem() {
    if (!this._progressElem) {
      this._progressElem = document.createElement("div");
      this._progressElem.className = "viewport-progress";
      this._progressElem.style.background = "#e5ebe8";
      this._progressElem.style.width = "96px";
      this._progressElem.style.height = "18px";
      this._progressElem.style.borderRadius = "4px";
      this._progressElem.style.alignItems = "start";
      this._progressElem.style.position = "relative";
      this._progressElem.style.display = "none";
      this._progressIndicator = document.createElement("div");
      this._progressIndicator.style.position = "absolute";
      this._progressIndicator.style.left = "0px";
      this._progressIndicator.style.width = "0%";
      this._progressIndicator.style.fontSize = "11px";
      this._progressIndicator.style.height = "100%";
      this._progressIndicator.style.background = "#bed6cc";
      this._progressElem.appendChild(this._progressIndicator);
      this.statusElem().appendChild(this._progressElem);
    }
    return this._progressElem;
  }

  /**
   * Updates progress bar, showing cranks/est. total cranks
   */
  updateRenderProgress() {
    const progress = this.rendering().progress();
    if (isNaN(progress) || progress <= 0) {
      this.progressElem().style.display = "none";
      return;
    }
    this.progressElem().style.display = "flex";
    this.progressElem().style.alignItems = "center";
    this.progressElem().style.justifyContent = "center";
    this.progressElem().style.overflow = "hidden";
    this.progressElem().style.whiteSpace = "nowrap";
    this._progressIndicator.style.width = 100 * progress + "%";
    this._progressIndicator.style.opacity = 0.8;
    if (
      this.rendering().cranksComplete() <
      this.rendering().totalEstimatedCranks()
    ) {
      this.progressElemText().innerText = `${this.rendering().cranksComplete()}/${this.rendering().totalEstimatedCranks()}`;
    } else {
      this.progressElemText().innerText = `${this.rendering().cranksComplete()}`;
    }
  }

  statusElem() {
    if (!this._statusElem) {
      this._statusElem = document.createElement("div");
      this._statusElem.className = "viewport-status";
      this._statusElem.style.display = "flex";
      this._statusElem.style.alignItems = "center";
      this._statusElem.style.gap = "8px";
    }
    return this._statusElem;
  }

  statusTextElem() {
    if (!this._statusTextElem) {
      this._statusTextElem = document.createElement("div");
      this._statusTextElem.style.fontSize = "12px";
      this._statusTextElem.style.color = "inherit";
      this._statusTextElem.style.display = "none";
      this.statusElem().appendChild(this._statusTextElem);
    }
    return this._statusTextElem;
  }

  setStatus(msg) {
    if (msg === null) {
      this.statusTextElem().style.display = "none";
      return;
    }
    this.statusTextElem().style.display = "block";
    this.statusTextElem().innerText = msg;
  }

  logMessage(...msgParts) {
    const msg = msgParts.join(" ");
    const elem = document.createElement("span");
    elem.style.display = "inline";
    elem.style.pointerEvents = "none";
    elem.style.userSelect = "none";
    elem.innerText = msg;
    const logContainer = this.logContainer();
    while (logContainer.childElementCount > 10) {
      logContainer.firstChild.remove();
    }
    logContainer.appendChild(elem);

    setTimeout(() => {
      elem.remove();
    }, 5000);
  }

  logContainer() {
    if (!this._logContainer) {
      this._logContainer = document.createElement("div");
      this._logContainer.style.fontSize = "12px";
      this._logContainer.style.color = "inherit";
      this._logContainer.style.display = "flex";
      this._logContainer.style.flexDirection = "column";
    }
    return this._logContainer;
  }

  mountLog(logContainer) {
    if (this.logContainer().parentElement === logContainer) {
      return;
    }
    logContainer.appendChild(this.logContainer());
  }

  setSaveGraph(saveGraph) {
    this._saveGraph = saveGraph;
  }

  setHistoryGrouping(callbacks) {
    this._historyGrouping = callbacks;
  }

  beginHistoryGroup() {
    this._historyGrouping?.begin(this.widget(), this.node(), this.toJSON());
  }

  endHistoryGroup() {
    this._historyGrouping?.end();
  }

  setOnDocumentChange(listener) {
    this._onDocumentChange = listener;
    this.notifyDocumentChange(true);
  }

  notifyDocumentChange(force = false) {
    this._inlineEditor?.update();
    this._sourceInput?.update();
    if (!this._onDocumentChange) return;
    const root = this.widget();
    const node = root ? this.node() : null;
    if (!force && root === this._notifiedRoot && node === this._notifiedNode)
      return;
    this._notifiedRoot = root;
    this._notifiedNode = node;
    this._onDocumentChange(root, node);
  }

  applyStructuredCommand(command, nodeId) {
    const root = this.widget();
    const currentId = this.node().id();
    const target =
      nodeId === undefined ? this.node() : findNodeById(root, nodeId);
    if (!target) throw new Error("This entry is no longer in the document.");
    const result = runStructuredCommand(root, target, command);
    if (command.type === "setText") this.cancelCameraTravel();
    const keepSelection = nodeId !== undefined && nodeId !== currentId;
    return this.applyStructuredResult(result, {
      selectionId: keepSelection ? currentId : result.selectedNode.id(),
      ensureVisible: command.type !== "setText",
    });
  }

  applyStructuredResult(result, { selectionId = result.selectedNode.id(), ensureVisible = false } = {}) {
    const root = this.widget();
    // A semantic edit stays in the current document. Retain its camera and
    // completed display while laying out the replacement graph.
    const styles = new Map();
    root.paintGroup().forEach((group) => group.siblings().forEach((node) => {
      if (this._nodeStyles.has(node)) styles.set(node.id(), this._nodeStyles.get(node));
    }));
    this._userCaret = new DirectionCaret(result.root);
    result.root.paintGroup().forEach((group) => group.siblings().forEach((node) => {
      if (styles.has(node.id())) this._nodeStyles.set(node, styles.get(node.id()));
    }));
    const selection = findNodeById(result.root, selectionId);
    if (selection) this._userCaret.moveTo(selection);
    this._nodeNavigationRequested = false;
    this._showInCamera = false;
    this._checkScale = false;
    this._ensureVisible = ensureVisible;
    const renderer = this.rendering();
    renderer?.replaceDocumentRoot?.();
    this.save();
    // replaceDocumentRoot already invalidates the drawing; schedule it once.
    if (renderer?.replaceDocumentRoot) this.scheduleRender();
    else this.refresh();
    return result;
  }

  moveToId(id) {
    const root = this.widget();
    const selectedNode = findNodeById(root, id);
    if (selectedNode) {
      this.caret().moveTo(selectedNode);
      this.refresh();
    }
  }

  navigatingNodes() {
    return !!this._navigatingNodes;
  }

  selectNode(node) {
    this.caret().moveTo(node);
    this._navigatingNodes = true;
    this._nodeNavigationRequested = true;
    this.repaint();
  }

  clearNodeSelection() {
    this._navigatingNodes = false;
    this._nodeNavigationRequested = false;
    this.cancelCameraTravel();
    this._showInCamera = false;
    this._checkScale = false;
    this._ensureVisible = false;
    this.refresh();
  }

  moveToNeighbor(direction) {
    if (!this.node().neighbors().hasNode(direction)) return false;
    this.caret().move(direction);
    this._nodeNavigationRequested = true;
    this.repaint();
    return true;
  }

  save() {
    if (this._saveGraph) {
      this._saveGraph(this.widget(), this.caret().node());
    }
    this.notifyDocumentChange(true);
  }

  showInCamera() {
    this._showInCamera = true;
    this.repaint();
  }

  fitGraph() {
    this.container()?.focus();
    this._cameraTravel.cancel();
    this._cameraZoomTarget = null;
    this.input()?.stopPan();
    this._fitGraphRequested = true;
    this.refresh();
  }

  removeNode() {
    if (isStructuredDocument(this.widget())) {
      try {
        const selected = inspectStructuredSelection(this.widget(), this.node());
        this.applyStructuredCommand({ type: selected.removeAction || "clear" });
      } catch (error) {
        this.logMessage(error.message);
      }
      return;
    }
    if (this.node().neighbors().isRoot()) {
      this.node().setValue(undefined);
      this.save();
      this.repaint();
      return;
    }
    const node = this.node();
    this.caret().moveTo(node.neighbors().parentNode());
    node.disconnect();
    this.save();
    this.repaint();
  }

  toggleExtents() {
    if (!ENABLE_EXTENT_VIEWING) {
      return;
    }
    const order = ["none", "vertical", "horizontal"];
    let idx = order.indexOf(this.rendering().extentMode());
    if (idx < 0) {
      idx = 0;
    }
    this.rendering().setExtentMode(order[(idx + 1) % order.length]);
  }

  toggleAlignment() {
    const node = this.node();
    if (node.neighbors().isRoot()) {
      this.togglePreferredAxis();
      return;
    }
    const childDir = reverseDirection(node.neighbors().parentDirection());
    const alignment = node
      .neighbors()
      .parentNode()
      .neighbors()
      .getAlignment(childDir);
    node
      .neighbors()
      .parentNode()
      .neighbors()
      .align(childDir, nextAlignment(alignment, childDir));
    this.logMessage(
      "Alignment is now " +
        nameAlignment(
          node.neighbors().parentNode().neighbors().getAlignment(childDir)
        )
    );
    this.save();
    this.repaint();
  }

  tab(reverse) {
    const car = this.caret();
    if (reverse) {
      car.moveTo(car.node().siblings().next());
    } else {
      car.moveTo(car.node().siblings().prev());
    }
    this.repaint();
  }

  movePaintGroup(reverse) {
    const car = this.caret();
    if (reverse) {
      car.moveTo(car.node().paintGroup().next());
    } else {
      car.moveTo(car.node().paintGroup().prev());
    }
    this.repaint();
  }

  spawnMove(dir, pullIfOccupied, dontTouchCamera) {
    if (isStructuredDocument(this.widget())) {
      // Directional input navigates the representation; only semantic commands
      // create content in a structured document.
      this.moveToNeighbor(dir);
      return;
    }
    if (this.node().neighbors().hasNode(dir)) {
      if (pullIfOccupied && !this.node().neighbors().isRoot()) {
        const parentDir = this.node().neighbors().parentDirection();
        if (dir === parentDir) {
          this.pullNode();
        } else {
          this.toggleAlignment();
        }
      } else {
        this.caret().move(dir);
        if (!dontTouchCamera) {
          this.showInCamera();
        } else {
        }
      }
      this.repaint();
    } else {
      const curStyle = this.getNodeStyle();
      this.caret().spawnMove(dir);
      this.updateNodeStyle(curStyle);
      if (!dontTouchCamera) {
        this.showInCamera();
      }
      this.repaint();
      this.save();
    }
  }

  container() {
    return this._container;
  }

  mount(container) {
    if (!container || (this.hasContainer() && this.container() === container)) {
      return;
    }
    this._container = container;

    this._rendering = new ViewportRendering(this);
    this.attachInput();
  }

  carouselRoot() {
    // Generate if needed.
    this.carouselContainer();

    return this._carouselRoot;
  }

  carouselContainer() {
    if (!this._carouselContainer) {
      this._carouselContainer = document.createElement("div");
      this._carouselContainer.className = "Carousel";
      this._carouselContainer.style.display = "none";
      this._carouselContainer.style.position = "absolute";
      this._carouselContainer.style.left = "50%";
      this._carouselContainer.style.top = "50%";
      this._carouselContainer.style.transformOrigin = "center";
      this._carouselRoot = require("react-dom/client").createRoot(
        this.carouselContainer()
      );
    }
    return this._carouselContainer;
  }

  attachInput() {
    if (this._input && this._input.attachedContainer() === this.container()) {
      return;
    }
    if (this._input) {
      this._input.unmount();
      this._input = null;
    }

    this._container.appendChild(this.carouselContainer());
    this.carouselRoot().render(<Carousel viewport={this} />);
    this._input = new ViewportInput(this);
  }

  caret() {
    return this._userCaret;
  }

  toJSON() {
    if (documentState(this.widget())?.version === 1)
      ensureStringIds(this.widget());
    const styles = Object.create(null);
    this._userCaret
      .root()
      .paintGroup()
      .forEach((pg) => {
        pg.siblings().forEach((node) => {
          if (this._nodeStyles.has(node)) {
            styles[node.id()] = this._nodeStyles.get(node);
          }
        });
      });
    return {
      styles,
      defaultNodeStyle: this.defaultNodeStyle(),
      pageBackgroundColor: this.rendering().pageBackgroundColor().asRGBA(),
      cam: this.camera().toJSON(),
      showingUI: this.rendering().showingUI(),
      appearanceChanged: !!this._appearanceChanged,
    };
  }

  camera() {
    return this._cam;
  }

  cameraTravel() {
    return this._cameraTravel;
  }

  zoomCamera(factor, x, y) {
    const target = new Camera();
    target.copy(this._cameraZoomTarget ?? this.camera());
    const destination = this._cameraTravel.destination();
    if (destination && !this._cameraZoomTarget) {
      target.setScale(destination.scale);
      target.setOrigin(
        target.width() / (2 * destination.scale) - destination.x,
        target.height() / (2 * destination.scale) - destination.y
      );
    }
    this.cancelCameraTravel();
    this.input().stopPan();
    target.zoomToPoint(
      factor,
      Number.isFinite(x) ? x : target.width() / 2,
      Number.isFinite(y) ? y : target.height() / 2
    );
    this._cameraZoomTarget = target;
    // Keyboard zoom is a camera update, just like wheel/pinch zoom. A graph
    // refresh would abandon the unfinished frame and invalidate worker text.
    this.refreshCamera(true);
  }

  cancelCameraTravel() {
    this._cameraZoomTarget = null;
    if (!this._cameraTravel.active()) return;
    this._cameraTravel.cancel();
    this._showInCamera = false;
    this._checkScale = false;
    this._ensureVisible = false;
  }

  load(viewportData) {
    if (!viewportData) {
      return;
    }
    if (viewportData.defaultNodeStyle) {
      this.updateDefaultNodeStyle(viewportData.defaultNodeStyle);
    }
    if (viewportData.styles) {
      this._userCaret
        .root()
        .paintGroup()
        .forEach((pg) => {
          pg.siblings().forEach((node) => {
            if (
              Object.prototype.hasOwnProperty.call(
                viewportData.styles,
                node.id()
              )
            ) {
              this.updateNodeStyle(node, viewportData.styles[node.id()]);
            }
          });
        });
    }
    if (viewportData.cam) {
      this._fitGraphRequested = false;
      this._cameraZoomTarget = null;
      this._cameraTravel.cancel();
      this.camera().restore(viewportData.cam);
      this._showInCamera = false;
      this._checkScale = false;
      this._ensureVisible = false;
    }
    if (viewportData.pageBackgroundColor) {
      this.rendering().setPageBackgroundColor(
        viewportData.pageBackgroundColor.startsWith("#")
          ? Color.fromHex(viewportData.pageBackgroundColor)
          : Color.fromRGB(viewportData.pageBackgroundColor)
      );
    }
    if (viewportData.showingUI === true) this.rendering().showUI();
    if (viewportData.showingUI === false) this.rendering().hideUI();
    this.refresh();
  }

  resetSettings() {
    this._fitGraphRequested = true;
    this._navigatingNodes = false;
    this._nodeNavigationRequested = false;
    this._cameraZoomTarget = null;
    this._cameraTravel.cancel();
    this.camera().setOrigin(0, 0);
    this.camera().setScale(1);

    this.rendering()?.resetSettings();
    this._showInCamera = true;
    this._checkScale = true;
    this._ensureVisible = true;

    this._defaultNodeStyle = createDefaultNodeStyle();
    this._appearanceChanged = false;
  }

  showingStyling() {
    return this._showingStyling;
  }

  toggleNodeStyling() {
    this._showingStyling = !this._showingStyling;
    if (this._showingStyling) {
      this.carouselContainer().style.display = "none";
    } else {
      this.carouselContainer().style.display = "block";
    }
    if (this._toggleNodeStyling !== null) {
      this._toggleNodeStyling(this._showingStyling);
    }
    this.refresh();
  }

  setToggleNodeStyling(toggleNodeStyling) {
    this._toggleNodeStyling = toggleNodeStyling;
  }

  moveOutward(dontTouchCamera) {
    if (this._userCaret.has(Direction.OUTWARD)) {
      this._userCaret.move(Direction.OUTWARD);
    } else if (!this._userCaret.node().neighbors().isRoot()) {
      this._userCaret.move(
        this._userCaret.node().neighbors().parentDirection()
      );
    } else {
      return;
    }
    if (!dontTouchCamera) {
      this.showInCamera();
    }
    this.repaint();
  }

  mountEditor(editorContainer) {
    this.createEditor();
    editorContainer.appendChild(this._editorContainer);
    if (this._suspendedEditor?.node === this.node()) {
      this._showEditor = true;
      this._editor.value = this._suspendedEditor.text;
      this._editorContainer.style.display = "block";
    }
    this._suspendedEditor = null;
    if (this._showEditor) this._editor.focus({ preventScroll: true });
  }

  unmountEditor(editorContainer) {
    if (this._editorContainer?.parentElement !== editorContainer) return;
    if (this._showEditor) {
      // Developer tools can temporarily replace the inspector. Keep its
      // unsubmitted label text, but don't let a hidden editor consume keys.
      this._suspendedEditor = { node: this._editorNode, text: this._editor.value };
      this._showEditor = false;
      this._editorContainer.style.display = "none";
    }
    this._editorContainer.remove();
  }

  undo() {
    if (!this.finishStructuredEditing()) return;
    if (this._undo) {
      this._undo();
    }
  }

  redo() {
    if (!this.finishStructuredEditing()) return;
    if (this._redo) {
      this._redo();
    }
  }

  setUndo(undo) {
    this._undo = undo;
  }

  setRedo(redo) {
    this._redo = redo;
  }

  refresh() {
    this.notifyDocumentChange();
    this.scheduleRepaint();
  }

  refreshCamera(checkScale = false) {
    this.rendering()?.cameraChanged(checkScale);
    this.scheduleRender();
  }

  refreshOverlay() {
    this.scheduleRender();
  }

  scheduleRepaint() {
    this.rendering()?.reset();
    this.scheduleRender();
  }

  scheduleRender() {
    if (this._scheduledRender) {
      return;
    }
    if (SLOW_RENDER) {
      this.scheduleSlowRender();
    } else {
      this.scheduleImmediateRender();
    }
  }

  updateStatus() {
    measureInteraction("Progress/status", () => {
      this.setStatus(`${this.rendering().phaseName()}`);
      this.updateRenderProgress();
    });
  }

  clearStatus() {
    this.setStatus(null);
    this.progressElem().style.display = "none";
  }

  scheduleImmediateRender() {
    let attempts = 0;
    const loop = () => {
      this._scheduledRender = null;

      if (this.paint()) {
        this.updateStatus();
        if (attempts++ > MAX_RENDER_ATTEMPTS) {
          throw new Error("Failed to render after " + attempts + " attempts");
        }
        schedule();
      } else {
        this.clearStatus();
      }
    };
    const schedule = () => {
      let id = requestAnimationFrame(loop);
      this._scheduledRender = () => {
        this._scheduledRender = null;
        cancelAnimationFrame(id);
        id = null;
      };
    };
    schedule();
  }

  scheduleSlowRender() {
    let attempts = 0;
    const loop = () => {
      this._scheduledRender = null;

      if (!this.canPaint()) {
        return false;
      }
      const more = this.rendering().crank();
      this.rendering().present();
      this._inlineEditor?.update();
      this._sourceInput?.update();
      if (more || this.rendering().continueLatestFrame()) {
        this.updateStatus();
        if (attempts++ > MAX_RENDER_ATTEMPTS) {
          throw new Error("Failed to render after " + attempts + " attempts");
        }
        schedule();
      } else {
        this.clearStatus();
      }
    };
    const schedule = () => {
      let animId = null;
      let timerId = setTimeout(() => {
        animId = requestAnimationFrame(loop);
      }, CRANK_SPEED_MS);
      this._scheduledRender = () => {
        this._scheduledRender = null;
        if (animId) {
          cancelAnimationFrame(animId);
          animId = null;
        }
        if (timerId) {
          clearTimeout(timerId);
          timerId = null;
        }
      };
    };
    schedule();
  }

  cancelScheduledRender() {
    if (!this._scheduledRender) {
      return;
    }
    this._scheduledRender();
  }

  repaint() {
    this.notifyDocumentChange();
    this._ensureVisible = true;
    this.scheduleRepaint();
  }

  paint() {
    if (!this.canPaint()) {
      return false;
    }
    const recording = interactionRecording();
    const before = recording ? this.rendering().interactionState() : null;
    const sliceStart = recording ? performance.now() : 0;
    const more = measureBenchmark(
      benchmarkFor(this.widget()),
      "Render slice",
      () => {
        const start = Date.now();
        while (this.rendering().crank()) {
          if (Date.now() - start > MAX_PAINT_TIME_MS) {
            return true;
          }
        }
        return this.rendering().continueLatestFrame();
      }
    );
    measureInteraction("Frame presentation", () => this.rendering().present());
    this._inlineEditor?.update();
    this._sourceInput?.update();
    if (recording) {
      recordInteraction("slice", {
        durationMs: performance.now() - sliceStart,
        before,
        after: this.rendering().interactionState(),
        more,
      });
    }
    return more;
  }

  node() {
    return this.caret().node();
  }

  layout() {
    return this.node().layout();
  }

  pullNode() {
    if (this.node().neighbors().isRoot()) {
      this.toggleAlignment();
      return;
    }
    if (this.node().nodeFit() === Fit.EXACT) {
      this._userCaret.fitLoose();
    } else {
      const dir = this._userCaret.node().neighbors().parentDirection();
      this.logMessage("Pulling this node " + nameDirection(dir));
      this._userCaret.fitExact();
      this._userCaret
        .node()
        .neighbors()
        .parentNode()
        .siblings()
        .pull(reverseDirection(dir));
    }
    this.save();
    this.repaint();
  }

  toggleNodeFit() {
    if (this.node().nodeFit() === Fit.EXACT) {
      this.node().setNodeFit(Fit.LOOSE);
      this.logMessage("Fit is now LOOSE");
    } else {
      this.node().setNodeFit(Fit.EXACT);
      this.logMessage("Fit is now EXACT");
    }
    this.node().invalidate();
    this.save();
    this.repaint();
  }

  toggleNodeScale() {
    if (this.node().scale() === 1) {
      this._userCaret.shrink();
    } else {
      this._userCaret.grow();
    }
    this.save();
    this.repaint();
  }

  togglePreferredAxis() {
    const nextAxis = (curAxis) => {
      switch (curAxis) {
        case PreferredAxis.HORIZONTAL:
          return PreferredAxis.VERTICAL;
        case PreferredAxis.VERTICAL:
          return PreferredAxis.HORIZONTAL;
        case PreferredAxis.PARENT:
          return PreferredAxis.PERPENDICULAR;
        case PreferredAxis.PERPENDICULAR:
        default:
          return PreferredAxis.PARENT;
      }
    };

    this.node()
      .siblings()
      .setLayoutPreference(
        nextAxis(this.node().siblings().getLayoutPreference())
      );
    this.node().invalidate();
    this.logMessage(
      "Preferred axis is now " +
        namePreferredAxis(this.node().siblings().getLayoutPreference())
    );

    this.repaint();
    this.save();
  }

  widget() {
    return this.caret()?.root();
  }

  hasContainer() {
    return !!this._container;
  }

  show(widget, viewport) {
    this._sourceInput?.discard();
    this._inlineEditor?.discard();
    if (this._showEditor && this._editorContainer) this.hideEditor();
    if (!widget) {
      throw new Error("Refusing to show falsy widget");
    }
    if (this.widget() !== widget) {
      this._userCaret = new DirectionCaret(widget);
      if (this.hasContainer()) {
        this.attachInput();
      }
    }
    this.resetSettings();
    const appearance = documentState(widget)?.appearance;
    if (appearance) {
      this.load({
        defaultNodeStyle: appearance.defaults,
        styles: appearance.nodeStyles,
        pageBackgroundColor: Color.fromHex(appearance.pageBackgroundColor)
          .setA(appearance.pageBackgroundAlpha)
          .asRGBA(),
      });
    }
    if (viewport) {
      this.load(viewport);
    }
    this._appearanceChanged = false;
    const structured = isStructuredDocument(widget);
    if (this._carouselRoot && this._carouselStructured !== structured) {
      this._carouselStructured = structured;
      this._carouselRoot.render(<Carousel viewport={this} />);
    }
    this.refresh();
  }

  presentation() {
    return documentState(this.widget())?.presentation;
  }

  createEditor() {
    if (this._editorContainer) return this._editorContainer;
    const editorContainer = document.createElement("div");
    editorContainer.style.display = "none";
    editorContainer.style.flexGrow = "1";

    this._editorContainer = editorContainer;

    const editor = this.createEditorComp();

    editorContainer.appendChild(editor);
    this._editor = editor;

    const buttons = document.createElement("div");
    buttons.className = "buttons";
    editorContainer.appendChild(buttons);

    const saveBtn = document.createElement("button");

    const save = () => {
      this.applyEditorValue();
      this.toggleEditor();
    };
    saveBtn.addEventListener("click", save);
    saveBtn.innerHTML = "Save";
    buttons.appendChild(saveBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.addEventListener("click", () => this.toggleEditor());
    cancelBtn.innerHTML = "Cancel";
    buttons.appendChild(cancelBtn);

    return editorContainer;
  }

  setToggleNodeActions(cb) {
    this._toggleNodeActions = cb;
  }

  applyEditorValue() {
    if (isStructuredDocument(this.widget())) {
      try {
        this.applyStructuredCommand({
          type: "setText",
          text: this._editor.value,
        });
      } catch (error) {
        this.logMessage(error.message);
      }
      return;
    }
    this.node().setValue(
      this._editor.value === "" ? undefined : this._editor.value
    );
    this.showInCamera();
    this.checkScale();
    this.repaint();
    this.save();
  }

  createEditorComp() {
    const editor = document.createElement("textarea");
    editor.setAttribute("aria-label", "Node text");
    editor.style.width = "100%";
    editor.style.boxSizing = "border-box";
    editor.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.toggleEditor();
      } else if (e.key === "Enter") {
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        this.applyEditorValue();
        this.toggleEditor();
      }
    });
    return editor;
  }

  hideEditor() {
    this._suspendedEditor = null;
    if (this._sourceInput?.active()) {
      this._sourceInput.close(true);
      return;
    }
    if (this._inlineEditor?.active()) {
      this._inlineEditor.close(true);
      return;
    }
    if (!this.showingEditor()) {
      return;
    }
    if (this._toggleNodeActions) {
      this._toggleNodeActions(false);
    }
    this._showEditor = false;
    this._editorContainer.style.display = "none";
    this.container().focus();
    this.refresh();
  }

  showEditor() {
    if (this._sourceInput?.active() && !this._sourceInput.close(false)) return;
    if (isStructuredDocument(this.widget())) {
      this._inlineEditor ??= new ViewportInlineEditor(this);
      try {
        if (!this._inlineEditor.open()) this.rendering()?.showUI();
      } catch (error) { this.logMessage(error.message); }
      return;
    }
    if (this.showingEditor()) {
      return;
    }
    this.createEditor();
    const pending = this._suspendedEditor;
    this._suspendedEditor = null;
    this._showEditor = true;
    this._editorNode = this.node();
    this.rendering()?.showUI();
    if (this._toggleNodeActions) {
      this._toggleNodeActions(true);
    }
    this._editorContainer.style.display = "block";
    if (this._editorContainer.isConnected) this._editor.focus({ preventScroll: true });
    if (pending?.node === this.node()) {
      this._editor.value = pending.text;
    } else if (nodeHasValue(this.node())) {
      this._editor.value = this.node().value();
    } else {
      this._editor.value = "";
    }
    this.refresh();
  }

  canEditStructuredValue() {
    if (!isStructuredDocument(this.widget())) return false;
    try { return inspectStructuredSelection(this.widget(), this.node()).canEdit; }
    catch { return false; }
  }

  showLispSourceInput(options) {
    if (structuredDocumentAdapter(this.widget())?.id !== "lisp") return false;
    if (this._inlineEditor?.active() && !this._inlineEditor.close(false)) return false;
    this._sourceInput ??= new ViewportLispSourceInput(this);
    try { return this._sourceInput.open(options); }
    catch (error) { this.logMessage(error.message); return false; }
  }

  finishLispSourceInput() {
    return !this._sourceInput?.active() || this._sourceInput.close(false);
  }

  finishStructuredEditing() {
    if (!this.finishLispSourceInput()) return false;
    return !this._inlineEditor?.active() || this._inlineEditor.close(false);
  }

  handleStructuredKey(event) {
    return structuredDocumentAdapter(this.widget())?.id === "lisp"
      ? handleStructuredLispKey(this, event)
      : handleStructuredJsonKey(this, event);
  }

  toggleEditor() {
    if (this.showingEditor()) {
      this.hideEditor();
    } else {
      this.showEditor();
    }
  }

  updateDefaultNodeStyle(newRules) {
    this._appearanceChanged = true;
    this._defaultNodeStyle = {
      ...this.defaultNodeStyle(),
      ...newRules,
    };
    invalidateAll(this.widget());
  }

  defaultNodeStyle() {
    return this._defaultNodeStyle;
  }

  hasNodeStyle(node) {
    node = node ?? this.node();
    let curStyle = this._nodeStyles.get(node);
    return curStyle !== undefined;
  }

  getNodeStyle(node) {
    node = node ?? this.node();
    let curStyle = this._nodeStyles.get(node);
    const appearance = jsonNodeAppearance(this.widget(), node)
      ?? lispNodeAppearance(this.widget(), node);
    if (curStyle === undefined && !appearance) {
      return this.defaultNodeStyle();
    }
    return {
      ...this.defaultNodeStyle(),
      ...appearance,
      ...curStyle,
    };
  }

  updateNodeStyle(...args) {
    let node, newRules;
    if (args.length < 1) {
      throw new Error("Usage: updateNodeStyle([node], newRules)");
    } else if (args.length === 1) {
      node = this.node();
      newRules = args[0];
    } else {
      node = args[0];
      newRules = args[1];
    }

    this._appearanceChanged = true;
    newRules = { ...newRules };
    if (
      newRules.pageBackgroundColor !== undefined ||
      newRules.pageBackgroundAlpha !== undefined
    ) {
      const color =
        newRules.pageBackgroundColor !== undefined
          ? Color.fromHex(newRules.pageBackgroundColor)
          : this.rendering().pageBackgroundColor().clone();
      color.setA(
        newRules.pageBackgroundAlpha ??
          this.rendering().pageBackgroundColor().a()
      );
      this.rendering().setPageBackgroundColor(color);
      delete newRules.pageBackgroundColor;
      delete newRules.pageBackgroundAlpha;
    }

    if (Object.keys(newRules).length === 0) {
      return;
    }

    this._nodeStyles.set(node, {
      ...(this._nodeStyles.get(node) ?? {}),
      ...newRules,
    });
    node.invalidate();
    this.refresh();
  }

  canPaint() {
    return this.hasContainer() && this.hasWidget();
  }

  hasWidget() {
    return !!this._userCaret?.root();
  }

  showingCaret() {
    return (
      !this._showingStyling &&
      (this.rendering().showingUI() || this.navigatingNodes())
    );
  }

  showNodeActions() {
    return this._showEditor;
  }

  checkScale() {
    this._checkScale = true;
    this.refresh();
  }

  showingEditor() {
    return this._showEditor || !!this._inlineEditor?.active() || !!this._sourceInput?.active();
  }

  ensuringVisible() {
    return this._ensureVisible;
  }

  clearEnsuringVisible() {
    this._ensureVisible = false;
  }
}
