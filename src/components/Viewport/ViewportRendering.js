import {
  Direction,
  CommitLayout,
  LayoutPhase,
  Alignment,
  Axis,
  getDirectionAxis,
  directionSign,
  getNegativeDirection,
  getPositiveDirection,
  paintNodeLines,
} from "parsegraph";
import Color from "parsegraph-color";
import { BasicGLProvider } from "parsegraph-compileprogram";
import { WebGLBlockPainter } from "parsegraph-blockpainter";
import {
  makeTranslation3x3,
  matrixMultiply3x3,
  makeScale3x3,
} from "parsegraph-matrix";
import { showNodeInCamera } from "parsegraph-showincamera";
import Rect from "parsegraph-rect";
import Camera from "parsegraph-camera";
import { cameraPose, graphTravelTarget, nodeTravelTarget } from "./ViewportCameraTravel";
import {
  USE_LOCAL_STORAGE,
  TEXT_IS_VISIBLE_SCALE,
  LABEL_IS_VISIBLE_SCALE,
  PAGE_BACKGROUND_COLOR,
  PRINT_PAINT_STATS,
  ENABLE_EXTENT_VIEWING,
  nodeHasValue,
  BORDER_ROUNDEDNESS,
  BORDER_THICKNESS,
  LINE_HEIGHT,
  FONT_SIZE,
  SHOW_WORLD_LABELS,
  LINE_THICKNESS,
  SHOW_NODE_SPOTLIGHTS,
  MAX_PAINT_TIME_MS,
  WORLD_LABEL_SIZE,
} from "../../settings";
import { WorldLabels } from "../WorldLabel";
import { createLayoutPainter } from "./createLayoutPainter";
import { drawSelectionOutline } from "./selectionOutline";
import DocumentFont from "./DocumentFont";
import ViewportFrameBuffer, { viewportFrameTransform } from "./ViewportFrameBuffer";
import { documentState, nodeLabel, writeGraph } from "../../graphDocument";
import { drawDocumentLabel } from "../../graphPresentation";
import { jsonNodeKind } from "../../structuredJsonAppearance";
import { isStructuredJson } from "../../structuredJson";
import { drawJsonNodeBorder, hasJsonNodeBorder, JSON_BORDER_PADDING } from "../../structuredJsonBorders";
import {
  annotateBenchmark,
  benchmarkFor,
  completeBenchmark,
  failBenchmark,
  measureBenchmark,
} from "../../benchmark";
import {
  interactionRecording,
  measureInteraction,
  recordInteraction,
  recordInteractionGroup,
} from "../../interactionBenchmark";

const sameCamera = (a, b) => a && b &&
  a.x() === b.x() && a.y() === b.y() && a.scale() === b.scale() &&
  a.width() === b.width() && a.height() === b.height();

function frameCanvas(className) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  Object.assign(canvas.style, {
    position: "absolute", inset: "0", transformOrigin: "0 0", pointerEvents: "none",
  });
  return canvas;
}

const minVisibleTextScale = 1;
const initialScale = 8;
const MIN_VISIBLE_GRAPH_SCREEN = 4;
const WALL_TIMES = 400;
const WALL_TIME_WIDTH = 1;

const WALL_TIME_SCALE = 4;

const highlightColor = new Color(0.4, 0.65, 0.57, 0.35);

// Node colors
const borderColor = new Color(0, 0, 0, 0.5);

export default class ViewportRendering {
  constructor(viewport) {
    this._steps = [
      ["Painting graph", () => this.paint(), () => this.allNodeCount()],
      ["Focusing camera", () => this.focusCamera(), () => 3],
      ["Clearing background", () => this.clearBackground(), () => 1],
      ["Rendering blocks", () => this.render(), () => this.allPaintGroupCount()],
      ["Initializing text", () => this.initializeText(), () => 1],
      ["Rendering text", () => this.renderText(), () => this.allNodeCount()],
      [
        "Rendering extents",
        () => this.renderExtents(this.camera().project()),
        () => 1,
      ],
      ["Rendering UI", () => false, () => 1],
      ["Post-rendering", () => this.postRender(), () => 1],
      ["Post-rendering text", () => this.postRenderText(), () => 1],
      ["Persisting graph", () => this.persist(), () => 1],
      ["Rendering metrics", () => this.renderMetrics(), () => 1],
      ["Presenting frame", () => this.publishFrame(), () => 1],
    ];

    this._phase = 0;

    this._showingUI = false;

    const container = viewport.container();

    this.resetSettings();

    container.style.background = this._pageBackgroundColor.asRGBA();
    //canvas.style.overflow = 'hidden';

    const textCanvas = frameCanvas("viewport-text-canvas");
    const labelsCanvas = frameCanvas("viewport-labels-canvas");
    this._textCanvas = textCanvas;
    this._labelsCanvas = labelsCanvas;
    this._ctx = textCanvas.getContext("2d");
    this._overlayCanvas = frameCanvas("viewport-overlay-canvas");
    this._revision = 0;
    this._textRequests = new Map();

    const glProvider = new BasicGLProvider();
    glProvider.canvas().getContext("webgl", {
      preserveDrawingBuffer: true
    });
    glProvider.container();
    glProvider.container().className = "viewport-webgl-container";
    glProvider.canvas().className = "viewport-webgl-canvas";
    glProvider.canvas().style.transformOrigin = "0 0";
    glProvider.container().style.position = "absolute";
    glProvider.container().style.inset = 0;
    container.appendChild(glProvider.container());
    this._glProvider = glProvider;


    this._extentGlProvider = new BasicGLProvider();
    this._extentGlProvider.canvas().getContext("webgl", { preserveDrawingBuffer: true });
    this._extentGlProvider.canvas().style.transformOrigin = "0 0";
    this._extentGlProvider.container();
    this._extentGlProvider.container().style.position = "absolute";
    this._extentGlProvider.container().style.inset = 0;
    this._extentGlProvider.container();
    this._extentGlProvider.container().className = "viewport-extent-container";
    this._extentGlProvider.canvas().className = "viewport-extent-canvas";
    container.appendChild(this._extentGlProvider.container());

    container.appendChild(this._overlayCanvas);

    this._viewport = viewport;

    this._painters = new WeakMap();
    this._documentFont = new DocumentFont();
    this._worldLabels = null;
    this._bounds = new WeakMap();

    this._showWorldLabels = SHOW_WORLD_LABELS;
    this._renderingSpotlights = SHOW_NODE_SPOTLIGHTS;

    this._showingStats = PRINT_PAINT_STATS;

    this._textRenderer = null;

    this.resetCounts();
    this._cranks = 0;
    this._startTime = NaN;
    glProvider.setOnContextChanged((isLost) => this.contextChanged(isLost));
    this._extentGlProvider.setOnContextChanged((isLost) => {
      this._extentContextLost = isLost;
      if (isLost) {
        this._extentBuffer?.contextLost();
        this._extentBuffer = null;
        this._extentPainter = null;
        if (this._frame) this._frame.hasExtents = false;
      } else {
        this.viewport().refresh();
      }
    });
  }

  contextChanged(isLost) {
    this._contextLost = isLost;
    if (isLost) {
      this.viewport().cancelScheduledRender();
      this._documentFont.contextLost();
      this._painters = new WeakMap();
      this._bounds = new WeakMap();
      this._layout = null;
      this._frameBuffer?.contextLost();
      this._frameBuffer = null;
      this.discardFrames();
    } else {
      // Every group lost GPU buffers, including groups with committed geometry.
      this.widget()?.paintGroup().forEach((pg) => pg.invalidate());
      this.viewport().refresh();
    }
  }

  initializeText() {
    if (this.viewport().presentation()) return false;
    const frame = this._frame;
    if (this._textCache?.revision === this._revision &&
        sameCamera(this._textCache.camera, frame.camera)) {
      frame.textImage = this._textCache.canvas;
      return false;
    }
    if (!this._textRenderer) {
      this._textRenderer = new Worker("textrenderer.js");
      this._textRenderer.addEventListener("message", (e) => {
        const requested = this._textRequests.get(e.data.key);
        this._textRequests.delete(e.data.key);
        if (this.validFrame(requested)) {
          const canvas = document.createElement("canvas");
          canvas.width = requested.camera.width();
          canvas.height = requested.camera.height();
          canvas.getContext("2d").drawImage(e.data.image, 0, 0);
          this._textCache = { camera: requested.camera, revision: this._revision, canvas };
          // Refine text in a subsequent complete frame. Never interrupt a pass
          // or apply pixels generated for one camera to another camera's frame.
          if (this.isDone() && sameCamera(requested.camera, this.viewport().camera())) {
            this.cameraChanged();
            this.viewport().scheduleRender();
          }
        }
        e.data.image.close?.();
      });
    }
    this._textRenderer.postMessage({ event: "init", camera: frame.camera.toJSON() });
    return false;
  }

  resetSettings() {
    this._retainedEditRoot = null;
    this._cameraNode = null;
    this._cameraNodeScale = null;
    this._pageBackgroundColor = PAGE_BACKGROUND_COLOR;
    this._worldLabels?.clear();
  }

  extentGlProvider() {
    return this._extentGlProvider;
  }

  isDone() {
    return this.phase() >= this._steps.length;
  }

  resetCounts() {
    this._countedRoot = null;
    this._nodeCount = NaN;
    this._paintGroupCount = NaN;
  }

  runCount() {
    return measureInteraction("Counting graph for progress", () => this.countGraph());
  }

  countGraph() {
    const root = this.widget();
    this._nodeCount = 0;
    this._paintGroupCount = 0;
    root
      .paintGroup()
      .forEach((pg) => {
        this._paintGroupCount++;
        pg.siblings().forEach(() => {
          ++this._nodeCount;
        });
      });
    this._countedRoot = root;
  }

  allPaintGroupCount() {
    if (isNaN(this._paintGroupCount)) {
      this.runCount();
    }
    return this._paintGroupCount;
  }

  allNodeCount() {
    if (isNaN(this._nodeCount)) {
      this.runCount();
    }
    return this._nodeCount;
  }

  totalEstimatedCranks() {
    return this._steps.reduce((total, step) => {
      const complexityFunc = step[2];
      return total + complexityFunc();
    }, 0);
  }

  cranksComplete() {
    return this._cranks;
  }

  progress() {
    return Math.min(1, this.cranksComplete() / this.totalEstimatedCranks());
  }

  node() {
    return this.viewport().node();
  }

  viewport() {
    return this._viewport;
  }

  pageBackgroundColor() {
    return this._pageBackgroundColor;
  }

  setPageBackgroundColor(color) {
    this._pageBackgroundColor = color;
  }

  layout() {
    return this.viewport().layout();
  }

  showingInCamera() {
    return this.viewport().showingInCamera();
  }

  clearShowingInCamera() {
    return this.viewport().clearShowingInCamera();
  }

  focusCamera() {
    const viewport = this.viewport();
    const camera = viewport.camera();
    // Camera.canProject() only rejects NaN, so zero dimensions still pass it.
    // Fitting against them would zoom to zero and make the transform singular.
    if (![camera.width(), camera.height()].every((size) => Number.isFinite(size) && size > 0)) return true;
    const previousNode = this._cameraNode;
    const previousScale = this._cameraNodeScale;
    const layout = this.node().layout();
    this._cameraNode = this.node();
    this._cameraNodeScale = layout.absoluteScale();
    const travel = viewport.cameraTravel();
    const bodySize = [NaN, NaN];
    layout.absoluteSize(bodySize);
    const bounds = new Rect(layout.absoluteX(), layout.absoluteY(), ...bodySize);
    const navigationRequested = viewport._nodeNavigationRequested;
    viewport._nodeNavigationRequested = false;

    if (viewport._fitGraphRequested) {
      const target = graphTravelTarget(camera, this.widget().layout());
      if (!target) return true;
      viewport._fitGraphRequested = false;
      viewport._cameraZoomTarget = null;
      viewport.clearShowingInCamera();
      viewport.clearCheckScale();
      viewport.clearEnsuringVisible();
      viewport.input().stopPan();
      if (previousNode) travel.start(target, true);
      else {
        travel.cancel();
        travel.apply(target);
      }
      return true;
    }

    if (previousNode && (previousNode !== this.node() || navigationRequested) &&
      (viewport.ensuringVisible() || viewport.showingInCamera())) {
      const target = nodeTravelTarget(camera, layout, previousScale,
        travel.destinationScale() ?? camera.scale());
      viewport.clearShowingInCamera();
      viewport.clearCheckScale();
      viewport.clearEnsuringVisible();
      viewport.input().stopPan();
      travel.start(target, camera.containsAny(bounds));
      return true;
    }
    if (travel.active() && !viewport.showingInCamera() && !viewport.checkingScale()) {
      viewport.clearEnsuringVisible();
      return false;
    }

    // Compute the endpoint separately so rendering never snaps the live camera.
    const cam = new Camera();
    const zoomTarget = viewport._cameraZoomTarget;
    viewport._cameraZoomTarget = null;
    cam.copy(zoomTarget ?? camera);
    const applyTarget = (animate) => {
      if (animate && previousNode) {
        viewport.input().stopPan();
        if (zoomTarget) travel.startZoom(cameraPose(cam));
        else travel.start(cameraPose(cam), camera.containsAny(bounds));
      } else {
        travel.cancel();
        camera.copy(cam);
      }
      return true;
    };

    const showInCamera = () => {
      //this.viewport().logMessage("Explicitly showing node in camera");
      const [x, y] = [cam.x(), cam.y(), cam.scale()];
      showNodeInCamera(this.viewport().node(), cam);

      const FUZZINESS = 1e-3;
      if (
        Math.abs(cam.x() - x) < FUZZINESS &&
        Math.abs(cam.y() - y) < FUZZINESS
      ) {
        let scaleFactor = MIN_VISIBLE_GRAPH_SCREEN * 0.75;
        const graphSize = [NaN, NaN];
        this.widget().layout().extentSize(graphSize);
        const scale =
          Math.min(cam.height(), cam.width()) /
          scaleFactor /
          (cam.scale() * Math.max(...graphSize));
        if (Number.isFinite(scale) && scale > 0) {
          let scaleFactor = 1 / 4;
          if (Math.abs(1 - scale) < FUZZINESS) {
            //this.viewport().logMessage("Showing node at max scale")
            this.node().layout().absoluteSize(graphSize);
            if (graphSize[0] < graphSize[1]) {
              const scale =
                (cam.width() * scaleFactor) / (graphSize[0] * cam.scale());
              if (Number.isFinite(scale) && scale > 0) {
                //this.viewport().logMessage("Zooming out camera to keep node horizontally within scale");
                cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
              }
            } else {
              const scale =
                (cam.height() * scaleFactor) / (graphSize[1] * cam.scale());
              if (Number.isFinite(scale) && scale > 0) {
                //this.viewport().logMessage("Zooming out camera to keep node vertically within scale");
                cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
              }
            }
          } else {
            //this.viewport().logMessage("Showing graph at min scale")
            cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
          }
        }
      } else {
        //this.viewport().logMessage("Showing node in camera");
      }
      this.viewport().clearShowingInCamera();
      this.viewport()._checkScale = true;
      return true;
    };

    const checkScale = () => {
      let adjusted = false;
      let scaleFactor = initialScale;

      const graphSize = [NaN, NaN];
      this.node().layout().absoluteSize(graphSize);
      if (graphSize[0] * cam.scale() > cam.width() * scaleFactor) {
        const scale =
          (cam.width() * scaleFactor) / (graphSize[0] * cam.scale());
        if (Number.isFinite(scale) && scale > 0) {
          //this.viewport().logMessage("Zooming out camera to keep node horizontally within scale");
          cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
          adjusted = true;
        }
      }
      if (graphSize[1] * cam.scale() > cam.height() * scaleFactor) {
        const scale =
          (cam.height() * scaleFactor) / (graphSize[1] * cam.scale());
        if (Number.isFinite(scale) && scale > 0) {
          //this.viewport().logMessage("Zooming out camera to keep node vertically within scale");
          cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
          adjusted = true;
        }
      }
      if (!adjusted) {
        let scaleFactor = MIN_VISIBLE_GRAPH_SCREEN;
        this.widget().layout().extentSize(graphSize);
        if (
          Math.max(...graphSize) * cam.scale() <
          Math.min(cam.height(), cam.width()) / scaleFactor
        ) {
          const scale =
            Math.min(cam.height(), cam.width()) /
            scaleFactor /
            (cam.scale() * Math.max(...graphSize));
          if (Number.isFinite(scale) && scale > 0) {
            //this.viewport().logMessage("Zooming in camera to keep graph within scale");
            cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
            adjusted = true;
          }
        }
      }
      viewport.clearCheckScale();
      return true;
    };

    if (this.viewport().showingInCamera()) {
      showInCamera();
      checkScale();
      viewport.clearEnsuringVisible();
      return applyTarget(true);
    }
    if (this.viewport().checkingScale()) {
      checkScale();
      return applyTarget(!!zoomTarget);
    }

    if (this.viewport().ensuringVisible()) {
      if (bounds.isNaN()) {
        return true;
      }
      if (!cam.containsAll(bounds)) {
        /*this.viewport().logMessage(
          "Showing node in camera to keep it within camera viewport"
        );*/
        showNodeInCamera(this.node(), cam);
      }
      this.viewport().clearEnsuringVisible();
      return applyTarget(true);
    }
    return false;
  }

  toggleWorldLabels() {
    this._showWorldLabels = !this._showWorldLabels;
  }

  glProvider() {
    return this._glProvider;
  }

  ctx() {
    return this._drawingOverlay ? this._overlayCanvas.getContext("2d") : this._ctx;
  }

  clearBackground() {
    const cam = new Camera();
    cam.copy(this.viewport().camera());
    if (!cam.canProject() || cam.width() <= 0 || cam.height() <= 0) return true;
    const oldFront = this._frontFrame;
    if (oldFront && !this.sameSize(oldFront.camera, cam)) this.discardFrames();
    const provider = this.glProvider();
    provider.render();
    this._frameBuffer ??= new ViewportFrameBuffer(provider.gl());
    this._frameBuffer.begin(cam.width(), cam.height());
    this._drawingTargetBound = true;
    // Two canvas pairs are reused. Unfinished layers are never attached to DOM.
    const layers = this._spareLayers ?? {
      text: this._textCanvas, labels: this._labelsCanvas,
    };
    this._spareLayers = null;
    this._textCanvas = layers.text;
    this._labelsCanvas = layers.labels;
    for (const canvas of [layers.text, layers.labels]) {
      canvas.width = cam.width();
      canvas.height = cam.height();
      canvas.style.transform = "";
    }
    this._ctx = layers.text.getContext("2d");
    this._worldLabels ??= new WorldLabels(minVisibleTextScale);
    this._worldLabels.clear();
    this._frame = {
      camera: cam, root: this.widget(), revision: this._revision,
      pass: this._renderPass, started: performance.now(),
      text: layers.text, labels: layers.labels, worldLabels: this._worldLabels,
    };
    if (interactionRecording()) recordInteraction("clear", this.interactionState());
    return false;
  }

  camera() {
    return this._drawingOverlay ? this.viewport().camera()
      : this._frame?.camera ?? this.viewport().camera();
  }

  sameSize(a, b) {
    return a.width() === b.width() && a.height() === b.height();
  }

  validFrame(frame) {
    return !!frame && !frame.released && frame.revision === this._revision &&
      frame.root === this.widget() &&
      (frame === this._frame || frame === this._frontFrame);
  }

  publishedRoot() {
    return this._frontFrame?.root;
  }

  // A semantic edit can replace every DirectionNode while still belonging to
  // the same document. Keep the last complete frame until its successor is
  // ready; actual document switches still discard via resetSettings().
  replaceDocumentRoot() {
    this._retainedEditRoot = this.widget();
    if (this._cameraNode?.id?.() === this.node()?.id?.()) {
      this._cameraNode = this.node();
    }
    this.reset();
  }

  releaseFrame(frame) {
    frame.released = true;
    frame.cancelLabels?.();
    this._textRequests?.delete(frame.textKey);
  }

  discardFrames() {
    if (this._frame) this.releaseFrame(this._frame);
    if (this._frontFrame) {
      this.releaseFrame(this._frontFrame);
      this._frontFrame.text.remove();
      this._frontFrame.labels.remove();
      this._spareLayers = { text: this._frontFrame.text, labels: this._frontFrame.labels };
    }
    this._frame = null;
    this._frontFrame = null;
    this._frameBuffer?.discard();
    this._extentBuffer?.discard();
    this.resetText();
  }

  cameraChanged(checkScale = false) {
    if (checkScale) {
      this.viewport()._checkScale = true;
      // Zoom limits change the live camera, never the immutable drawing pose.
      if (this.widget()?.layout().phase() === LayoutPhase.COMMITTED) this.focusCamera();
    }
    if (this.isDone()) this.restart();
  }

  continueLatestFrame() {
    if (!this.isDone() || !this._frontFrame) return false;
    const front = this._frontFrame;
    const textReady = !front.textImage && this._textCache?.revision === this._revision &&
      sameCamera(this._textCache.camera, this.viewport().camera());
    if (!sameCamera(front.camera, this.viewport().camera()) || textReady ||
        this.viewport().checkingScale()) {
      this.restart();
      return true;
    }
    return false;
  }

  publishFrame() {
    const frame = this._frame;
    if (!this.validFrame(frame)) return false;
    const data = this._renderData;
    frame.offscreen = data.i === 0 && data.dirtyGroups === 0 &&
      data.offscreenGroups === data.allGroups && data.allGroups > 0;
    this._frameBuffer.publish();
    if (frame.hasExtents && !this._extentContextLost) this._extentBuffer?.publish();
    else this._extentBuffer?.discard();
    const previous = this._frontFrame;
    if (previous) {
      this.releaseFrame(previous);
      previous.text.remove();
      previous.labels.remove();
      this._spareLayers = { text: previous.text, labels: previous.labels };
    } else {
      this._spareLayers = {
        text: frameCanvas("viewport-text-canvas"), labels: frameCanvas("viewport-labels-canvas"),
      };
    }
    this._frontFrame = frame;
    this._retainedEditRoot = null;
    const container = this.viewport().container();
    container.insertBefore(frame.text, this.extentGlProvider().container());
    container.insertBefore(frame.labels, this._overlayCanvas);
    container.style.background = this._pageBackgroundColor.asRGBA();
    if (interactionRecording()) {
      recordInteraction("present", {
        ...this.interactionState(), ageMs: performance.now() - frame.started,
        liveCamera: cameraPose(this.viewport().camera()),
      });
    }
    return false;
  }

  present() {
    if (this._contextLost) return;
    const cam = this.viewport().camera();
    const front = this._frontFrame;
    this._offscreenHandler?.(!!front?.offscreen && sameCamera(front.camera, cam));
    // Keep the published default canvases intact while drawing to the FBOs.
    // Camera-only updates are compositor transforms, with no GL submission.
    if (this._presentedFrame !== front) {
      this._drawingTargetBound = false;
      this._frameBuffer?.present(front?.camera ?? cam, front?.camera);
      this._extentBuffer?.present(front?.camera ?? cam, front?.camera);
      this._presentedFrame = front;
    }
    const graphCanvas = this.glProvider().canvas();
    const extentCanvas = this.extentGlProvider().canvas();
    if (front) {
      const { scale, x, y } = viewportFrameTransform(cam, front.camera);
      const transform = `translate(${x}px, ${y}px) scale(${scale})`;
      front.text.style.transform = transform;
      front.labels.style.transform = transform;
      graphCanvas.style.transform = transform;
      extentCanvas.style.transform = transform;
    } else {
      graphCanvas.style.transform = "";
      extentCanvas.style.transform = "";
    }
    const overlay = this._overlayCanvas;
    if (!overlay || !cam.canProject()) return;
    if (overlay.width !== cam.width()) overlay.width = cam.width();
    if (overlay.height !== cam.height()) overlay.height = cam.height();
    const ctx = overlay.getContext("2d");
    ctx.resetTransform();
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    this._drawingOverlay = true;
    try {
      if (this.node() && !this.layout().needsCommit() && !this.layout().needsAbsolutePos()) {
        this.renderUI();
      }
    } finally {
      this._drawingOverlay = false;
    }
  }

  widget() {
    return this.viewport().widget();
  }

  phase() {
    return this._phase ?? 0;
  }

  nextPhase() {
    this._phase = this.phase() + 1;
  }

  resetText() {
    this._textCache = null;
    this._textRequests?.clear();
  }

  restart() {
    if (interactionRecording()) {
      recordInteraction("restart", this.interactionState());
    }
    if (this._frame && this._frame !== this._frontFrame) this.releaseFrame(this._frame);
    this._frame = null;
    this._renderPass = (this._renderPass ?? 0) + 1;
    this._benchmark = benchmarkFor(this.widget());
    this.pushPastCrank(!this.isDone());
    this._phase = 0;
    const root = this.widget();
    // Graph edits invalidate layout through the root; camera movement does not.
    // Keep the census across clean redraws, but recount changed/replaced graphs.
    if (root !== this._countedRoot || root?.layout().phase() !== LayoutPhase.COMMITTED) {
      this.resetCounts();
    }
    this._cranks = 0;
    this._startTime = NaN;
    this._layout = null;
    this._currentPaintGroup = null;
    this._renderData = {
      i: 0,
      j: 0,
      k: 0,
      allGroups: 0,
      dirtyGroups: 0,
      offscreenGroups: 0,
      textVisited: 0,
    };
  }

  interactionState() {
    const data = this._renderData;
    const cam = this.camera();
    return {
      pass: this._renderPass ?? 0,
      phase: this.phase(),
      phaseName: this.phaseName(),
      complete: this.isDone(),
      blocksVisited: data?.allGroups ?? 0,
      blocksDrawn: data?.i ?? 0,
      culled: data?.offscreenGroups ?? 0,
      dirtyGroups: data?.dirtyGroups ?? 0,
      textVisited: data?.textVisited ?? 0,
      totalGroups: Number.isFinite(this._paintGroupCount) ? this._paintGroupCount : null,
      camera: { x: cam.x(), y: cam.y(), scale: cam.scale(), version: cam.changeVersion() },
    };
  }

  reset() {
    this._revision = (this._revision ?? 0) + 1;
    if (this._frontFrame && ((this._frontFrame.root !== this.widget() &&
        this._retainedEditRoot !== this.widget()) ||
        !this.sameSize(this._frontFrame.camera, this.viewport().camera()))) {
      this.discardFrames();
    }
    this.restart();
    this.resetText();
    if (this._worldLabels) {
      this._worldLabels.clear();
    }
    if (this._extentPainter) {
      this._extentPainter.clear();
    }
  }

  crank() {
    if (this._contextLost) return false;
    if (isNaN(this._startTime)) {
      this._startTime = Date.now();
    }
    this._cranks++;

    const step = this._steps[this.phase()];
    if (!step) {
      return false;
    }

    const pass = this._renderPass;
    let more;
    try {
      // Presentation binds the default framebuffer between slices. Restore the
      // unfinished target before any subsequent graph/glyph drawing.
      if (this._frame && !this.isDone() && !this._drawingTargetBound) {
        this._frameBuffer?.drawTarget();
        this._drawingTargetBound = true;
      }
      const phaseName = this.phase() === 0
        ? "Layout + paint preparation" : step[0];
      more = measureBenchmark(
        this._benchmark,
        phaseName,
        interactionRecording()
          ? () => measureInteraction(phaseName, step[1])
          : step[1]
      );
    } catch (error) {
      failBenchmark(this._benchmark, error);
      throw error;
    }
    // A dirty group can request a fresh layout while this step is running.
    // Do not advance the newly restarted pass past its layout phase.
    if (pass !== this._renderPass) return true;
    if (!more) {
      this.nextPhase();
      if (this.isDone() && interactionRecording()) {
        recordInteraction("pass-complete", this.interactionState());
      }
      if (this.isDone() && this._benchmark) {
        const state = documentState(this.widget());
        const counts = measureBenchmark(
          this._benchmark,
          "Graph statistics",
          () => ({
            nodes: this.allNodeCount(),
            paintGroups: this.allPaintGroupCount(),
          })
        );
        annotateBenchmark(this._benchmark, {
          ...counts,
          documentVersion: state?.version ?? 0,
          capabilities: Object.keys(state?.capabilities ?? {}),
          textWorker: !this.viewport().presentation(),
          worldLabels: this._showWorldLabels,
        });
        completeBenchmark(this._benchmark);
        this._benchmark = undefined;
      }
    }
    return true;
  }

  toggleStats() {
    this._showingStats = !this._showingStats;
  }

  phaseName() {
    if (this.isDone()) {
      return "Finished";
    }
    const step = this._steps[this.phase()];
    return step ? step[0] : null;
  }

  persist() {
    if (!USE_LOCAL_STORAGE) {
      return;
    }
    localStorage.setItem(
      "parsegraph-camera",
      JSON.stringify(this.camera().toJSON())
    );
    localStorage.setItem(
      "parsegraph-graph",
      JSON.stringify(writeGraph(this.widget(), this.node(), this.viewport().toJSON()))
    );
  }

  createLayout() {
    const root = this.widget();
    const provider = this.glProvider();
    if (!this._documentFont.isFor(root, provider)) {
      // A previously displayed root can retain committed geometry and painters
      // for a disposed atlas. Rebind every group to the current document font.
      root.paintGroup().forEach((pg) => pg.invalidate());
    }
    return new CommitLayout(
      root,
      createLayoutPainter(
        this._painters,
        this._bounds,
        provider,
        this.ctx(),
        (node) => this.viewport().getNodeStyle(node),
        this.viewport().presentation(),
        this._benchmark,
        this._documentFont.get(root, provider, this._benchmark),
        isStructuredJson(root) ? (node) => jsonNodeKind(root, node) : undefined
      )
    );
  }

  paint() {
    if (!this._layout || this._layout.startingNode() !== this.widget()) {
      this._layout = this.createLayout();
    }
    return this._layout.crank();
  }

  collectWorldLabel(node, label, camera, renderData, fontSize = FONT_SIZE) {
    if (!this._showWorldLabels || !label) return false;
    const layout = node.layout();
    // Presentation documents can choose a different font size. Promote text
    // based on its displayed size, including the scale of nested content.
    const textScale = layout.absoluteScale() * fontSize / FONT_SIZE;
    if (textScale * camera.scale() >= LABEL_IS_VISIBLE_SCALE) return false;
    const firstLine = label.split("\n", 1)[0];
    if (!firstLine) return false;
    this._worldLabels ??= new WorldLabels(minVisibleTextScale);
    this._worldLabels.draw(
      firstLine, layout.absoluteX(), layout.absoluteY(),
      WORLD_LABEL_SIZE, textScale
    );
    ++renderData.k;
    return true;
  }

  renderPaintGroupText(paintGroup, renderData) {
    const pg = paintGroup;
    const ctx = this.ctx();

    if (pg.layout().needsCommit() || pg.layout().needsAbsolutePos()) {
      pg.neighbors().root().invalidate();
      return true;
    }

    let bounds = this._bounds.get(pg).bounds;
    if (bounds.isNaN()) {
      throw new Error("bounds must not be NaN");
    }

    const b = bounds.clone();
    b.scale(pg.scale());
    b.translate(pg.layout().absoluteX(), pg.layout().absoluteY());

    const cam = this.camera();
    if (!cam.containsAny(b)) {
      return false;
    }

    const presentation = this.viewport().presentation();
    if (presentation) {
      let dirty = false;
      measureBenchmark(this._benchmark, "Label collection and enqueue", () => pg.siblings().forEach((node) => {
        if (node.layout().needsAbsolutePos()) {
          dirty = true;
          return;
        }
        const style = this.viewport().getNodeStyle(node);
        if (style.textAlpha > 0 && this.collectWorldLabel(
          node, nodeLabel(node, presentation), cam, renderData, presentation.text.fontSize
        )) return;
        const sidePadding = hasJsonNodeBorder(jsonNodeKind(this.widget(), node)) ? JSON_BORDER_PADDING : 0;
        drawDocumentLabel(ctx, node, cam, presentation, style, sidePadding);
      }));
      return dirty;
    }

    const { glyphPainter } = this._painters.get(pg);
    if (!glyphPainter) {
      return false;
    }

    const layout = paintGroup.layout();
    if (!this._frame?.textImage) measureBenchmark(this._benchmark, "Glyph rendering", () => glyphPainter.render(
      matrixMultiply3x3(
        makeScale3x3(layout.absoluteScale()),
        makeTranslation3x3(layout.absoluteX(), layout.absoluteY()),
        cam.project()
      ),
      cam.scale()
    ));

    // eslint-disable-next-line no-loop-func
    let dirty = false;
    measureBenchmark(this._benchmark, "Label collection and enqueue", () => pg.siblings().forEach((node) => {
        if (node.layout().needsAbsolutePos()) {
          dirty = true;
          return;
        }
        if (!nodeHasValue(node)) {
          return;
        }
        const kind = jsonNodeKind(this.widget(), node);
        if (!this.collectWorldLabel(node, node.value().toString(), cam, renderData) && !this._frame?.textImage) {
          const style = this.viewport().getNodeStyle(node);
          const nodeSize = [0, 0];
          node.layout().size(nodeSize);
          this.drawText(
            node.value(),
            node.layout().absoluteX(),
            node.layout().absoluteY(),
            node.layout().absoluteScale(),
            `${FONT_SIZE}px sans-serif`,
            Color.fromHex(style.textColor)
              .setA(style.textAlpha)
              .asRGBA(),
            node.neighbors().hasNode(Direction.INWARD),
            nodeSize,
            node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL,
            hasJsonNodeBorder(kind) ? JSON_BORDER_PADDING : 0
          );
        }
    }));
    return dirty;
  }

  drawText(text, worldX, worldY, worldScale, font, fillStyle, hasInward, nodeSize, inwardVertical, nodeLabelPadding = 0)
  {
    if (!this._textRenderer) {
      return;
    }
    this._textRenderer.postMessage({
      event: "text",
      text,
      worldX,
      worldY,
      worldScale,
      font,
      fillStyle,
      hasInward,
      nodeSize,
      inwardVertical,
      nodeLabelPadding
    });
  }

  renderPaintGroup(paintGroup, worldMatrix, renderData) {
    const pg = paintGroup;

    const { painter, spotlightPainter, typedShapes } = this._painters.get(pg);
    if (pg.layout().needsCommit() || pg.layout().needsAbsolutePos()) {
      renderData.dirtyGroups++;
      pg.neighbors().root().invalidate();
      return true;
    }
    if (!painter || !spotlightPainter) {
      renderData.dirtyGroups++;
      return true;
    }

    let bounds = this._bounds.get(pg).bounds;
    if (bounds.isNaN()) {
      throw new Error("bounds must not be NaN");
    }

    const b = bounds.clone();
    b.scale(pg.scale());
    b.translate(pg.layout().absoluteX(), pg.layout().absoluteY());

    const cam = this.camera();
    if (!cam.containsAny(b)) {
      renderData.offscreenGroups++;
      return false;
    }
    ++renderData.i;

    const pgMatrix = matrixMultiply3x3(
      makeScale3x3(pg.layout().absoluteScale()),
      makeTranslation3x3(pg.layout().absoluteX(), pg.layout().absoluteY()),
      worldMatrix
    );
    recordInteractionGroup(pg, "draw", () => {
      if (this.renderingSpotlights()) {
        spotlightPainter.render(pgMatrix);
      }
      if (typedShapes) painter.render(pgMatrix, cam.scale() * pg.layout().absoluteScale());
      else painter.render(pgMatrix);
    });

    return false;
  }

  render() {
    const cam = this.camera();
    if (!this.glProvider().canProject() || !cam.canProject()) {
      return false;
    }

    const worldMatrix = cam.project();
    const ctx = this.ctx();

    ctx.resetTransform();
    ctx.scale(cam.scale(), cam.scale());
    ctx.translate(cam.x(), cam.y());

    if (!this._currentPaintGroup) {
      this._currentPaintGroup = this.widget();
    }
    let pg = this._currentPaintGroup;

    const renderData = this._renderData;
    if (this.renderPaintGroup(pg, worldMatrix, renderData)) {
      this.viewport().refresh();
      return false;
    }

    ++renderData.allGroups;
    this._currentPaintGroup = pg.paintGroup().next();
    if (this._currentPaintGroup !== this.widget()) {
      return true;
    }
    this._currentPaintGroup = null;

    return false;
  }

  renderUI() {
    const ctx = this._overlayCanvas.getContext("2d");
    const cam = this.viewport().camera();
    if (cam.canProject()) {
      ctx.resetTransform();
      ctx.scale(cam.scale(), cam.scale());
      ctx.translate(cam.x(), cam.y());

      this.renderHovered();
      if (this.showingUI() || this.viewport().navigatingNodes()) {
        this.renderCaret();
      }
    }

    return false;
  }

  renderMetrics() {
    if (!this._showingStats) {
      return false;
    }
    const ctx = this.ctx();
    const cam = this.camera();
    const { i, j, k, dirtyGroups, offscreenGroups, allGroups } = this._renderData;
    ctx.resetTransform();
    ctx.font = "18px sans-serif";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillStyle = "white";
    const wallTime = Date.now() - this._startTime
    ctx.fillText(
      `${wallTime}ms wall, ${this._cranks} cranks, ${i}/${allGroups} groups (${dirtyGroups} dirty, ${offscreenGroups} offscreen), ${j} text, ${k} labels`,
      0,
      cam.height()
    );
    ctx.textAlign = "right";
    ctx.fillText(cam.toString(), cam.width(), cam.height());

    if (!this._wallTimes) {
      this._wallTimes = [];
    }
    this._wallTimes.push(wallTime);
    if (this._wallTimes.length > WALL_TIMES) {
      this._wallTimes.shift();
    }

    ctx.translate(0, cam.height());
    ctx.translate(0, - 18*1.5);
    ctx.save();
    let maxTime = 0;
    this._pastCranks.forEach(t => {
      maxTime = Math.max(Math.abs(t), maxTime);
    });
    const CRANK_HEIGHT = 25;
    this._pastCranks.forEach(t => {
      ctx.fillStyle = t < 0 ? 'rgba(255, 0, 0, 0.5)' : 'rgba(0, 255, 0, 0.5)';
      t = Math.abs(t);
      const h = CRANK_HEIGHT * (t / maxTime)
      ctx.fillRect(WALL_TIME_WIDTH/2, -h, WALL_TIME_WIDTH, h);
      ctx.translate(WALL_TIME_WIDTH, 0);
    });
    ctx.restore();
    ctx.translate(0, -CRANK_HEIGHT - 1);

    ctx.scale(1, WALL_TIME_SCALE);
    ctx.save();
    ctx.fillStyle = 'grey';
    ctx.fillRect(0, 0, WALL_TIME_WIDTH*WALL_TIMES, 1/WALL_TIME_SCALE);
    ctx.fillRect(0, -MAX_PAINT_TIME_MS/2, WALL_TIME_WIDTH*WALL_TIMES, 1/WALL_TIME_SCALE);
    ctx.fillRect(0, -MAX_PAINT_TIME_MS, WALL_TIME_WIDTH*WALL_TIMES, 1/WALL_TIME_SCALE);

    ctx.strokeStyle = 'white';
    this._wallTimes.forEach(t => {
      if (t < MAX_PAINT_TIME_MS/2) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
      } else if (t < MAX_PAINT_TIME_MS) {
        ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
      } else {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'baseline';
        ctx.save();
        ctx.translate(0, -t);
        ctx.scale(1, 1/WALL_TIME_SCALE);
        ctx.fillText(t + "ms", WALL_TIME_WIDTH, 0)
        ctx.restore();
      }
      ctx.fillRect(WALL_TIME_WIDTH/2, -t, WALL_TIME_WIDTH, t);
      ctx.translate(WALL_TIME_WIDTH, 0);
    });
    ctx.restore();

    return false;
  }

  pushPastCrank(interrupted) {
    if (!this._pastCranks) {
      this._pastCranks = [];
    }
    this._pastCranks.push(this._cranks * (interrupted ? -1 : 1));
    if (this._pastCranks.length > WALL_TIMES) {
      this._pastCranks.shift();
    }
  }

  renderText() {
    const cam = this.camera();
    if (!this.glProvider().canProject() || !cam.canProject()) {
      return false;
    }

    if (this._frame?.textImage && !this._frame.textImageDrawn) {
      const ctx = this.ctx();
      ctx.resetTransform();
      ctx.drawImage(this._frame.textImage, 0, 0);
      this._frame.textImageDrawn = true;
    }

    if (!this._currentPaintGroup) {
      this._currentPaintGroup = this.widget();
    }
    let pg = this._currentPaintGroup;

    const renderData = this._renderData;
    ++renderData.textVisited;
    if (this.renderPaintGroupText(pg, renderData)) {
      this.viewport().refresh();
      return false;
    }

    this._currentPaintGroup = pg.paintGroup().next();
    if (this._currentPaintGroup !== this.widget()) {
      return true;
    }
    this._currentPaintGroup = null;
  }

  setOffscreenHandler(offscreenHandler) {
    this._offscreenHandler = offscreenHandler;
  }

  renderCaret() {
    const ctx = this.ctx();
    const layout = this.layout();
    const cam = this.camera();

    if (this.node()) {
      const bodySize = [0, 0];
      layout.size(bodySize);
      if (this.viewport().showingCaret()) {
        drawSelectionOutline(
          ctx, this.node(), cam, jsonNodeKind(this.widget(), this.node())
        );
      }

      ctx.resetTransform();
      //ctx.textAlign = 'left';
      //ctx.textBaseline = 'top';
      //ctx.fillText(this.node()?.value(), 0, 0);

      if (this.viewport().showNodeActions() && this.viewport().showingCaret()) {
        this.carouselContainer().style.display = "block";
        this.carouselContainer().style.transform = `scale(${cam.scale()}) translate(${
          layout.absoluteX() + cam.x()
        }px, ${layout.absoluteY() + cam.y()}px) scale(${
          1 / cam.scale()
        }) translate(-${cam.width() / 2}px, -${
          cam.height() / 2
        }px) translate(-50%, -50%)`;

        this.carouselAnchor().style.width = `${
          bodySize[0] * layout.absoluteScale() * cam.scale()
        }px`;
        this.carouselAnchor().style.height = `${
          bodySize[1] * layout.absoluteScale() * cam.scale()
        }px`;
      } else {
        this.carouselContainer().style.display = "none";
      }
    }
  }

  renderHovered() {
    const ctx = this.ctx();
    const cam = this.camera();

    let node = this.viewport().input()?.hoveredNode();
    if (!node || this.node() === node) {
      return;
    }
    const layout = node.layout();
    if (layout.needsCommit() || layout.needsAbsolutePos()) {
      return;
    }

    const kind = jsonNodeKind(this.widget(), node);
    if (hasJsonNodeBorder(kind)) {
      drawJsonNodeBorder(ctx, node, cam, kind, {
        borderColor: highlightColor.asHex(), borderAlpha: highlightColor.a(),
      });
      return;
    }

    ctx.resetTransform();
    ctx.scale(cam.scale(), cam.scale());
    ctx.translate(cam.x(), cam.y());

    ctx.lineWidth = (BORDER_THICKNESS / 2) * layout.absoluteScale();
    ctx.lineJoin = "round";
    ctx.strokeStyle = highlightColor.asRGBA();
    const bodySize = [0, 0];
    layout.size(bodySize);
    if (nodeHasValue(node) || node.neighbors().hasNode(Direction.INWARD)) {
      ctx.beginPath();
      ctx.roundRect(
        layout.absoluteX() -
          (layout.absoluteScale() * bodySize[0]) / 2 +
          (BORDER_THICKNESS / 4) * layout.absoluteScale(),
        layout.absoluteY() -
          (layout.absoluteScale() * bodySize[1]) / 2 +
          (BORDER_THICKNESS / 4) * layout.absoluteScale(),
        layout.absoluteScale() * bodySize[0] -
          (BORDER_THICKNESS / 2) * layout.absoluteScale(),
        layout.absoluteScale() * bodySize[1] -
          (BORDER_THICKNESS / 2) * layout.absoluteScale(),
        (BORDER_ROUNDEDNESS * layout.absoluteScale()) / 2.13
      );
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(
        layout.absoluteX(),
        layout.absoluteY(),
        (bodySize[0] / 2) * layout.absoluteScale() -
          (BORDER_THICKNESS / 4) * layout.absoluteScale(),
        0,
        Math.PI * 2
      );
      ctx.stroke();
    }
  }

  carouselAnchor() {
    return this.viewport().input().carouselAnchor();
  }

  carouselContainer() {
    return this.viewport().input().carouselContainer();
  }

  postRender() {
    const frame = this._frame;
    if (!frame.worldLabels.labels().length) return false;
    const cam = frame.camera;
    const ctx = frame.labels.getContext("2d");
    frame.cancelLabels = frame.worldLabels.prepareRender(
      ctx, cam.x(), cam.y(), cam.width(), cam.height(), cam.scale(), () => {
        if (!this.validFrame(frame)) return;
        ctx.resetTransform();
        ctx.clearRect(0, 0, frame.labels.width, frame.labels.height);
        ctx.scale(cam.scale(), cam.scale());
        ctx.translate(cam.x(), cam.y());
        if (this._showWorldLabels) {
          frame.worldLabels.render(ctx, this.pageBackgroundColor(), cam.scale());
        }
      }
    );
    return false;
  }

  postRenderText() {
    if (this.viewport().presentation() || this._frame.textImage || !this._textRenderer) return false;
    const key = `${this._revision}:${this._renderPass}`;
    this._frame.textKey = key;
    this._textRequests.set(key, this._frame);
    this._textRenderer.postMessage({ event: "render", key });
    return false;
  }

  renderExtents(worldMatrix) {
    if (this._extentContextLost || !ENABLE_EXTENT_VIEWING) return false;
    if (!this.node()) {
      return false;
    }
    if (this.node().layout().needsCommit()) {
      return false;
    }
    if (!this.extentGlProvider().canProject()) {
      return false;
    }

    if (this.extentGlProvider().render()) {
      return false;
    }

    this.paintExtents();
    const layout = this.layout();
    const cam = this.camera();
    this._extentBuffer ??= new ViewportFrameBuffer(this.extentGlProvider().gl());
    this._extentBuffer.begin(cam.width(), cam.height());
    this._frame.hasExtents = true;
    this._extentPainter.render(
      matrixMultiply3x3(
        makeScale3x3(layout.absoluteScale()),
        makeTranslation3x3(layout.absoluteX(), layout.absoluteY()),
        worldMatrix
      )
    );
    return false;
  }

  extentMode() {
    return this._extentMode;
  }

  setExtentMode(extentMode) {
    if (this._extentMode === extentMode) {
      return;
    }
    this._extentMode = extentMode;
    switch (this._extentMode) {
      case "vertical":
        this.viewport().logMessage("Showing vertical extents");
        break;
      case "horizontal":
        this.viewport().logMessage("Showing horizontal extents");
        break;
      case "none":
        this.viewport().logMessage("Hiding all extents");
        break;
      default:
        break;
    }
    this.viewport().refresh();
  }

  paintExtents() {
    if (!ENABLE_EXTENT_VIEWING) {
      return false;
    }

    if (!this._extentPainter) {
      this._extentPainter = new WebGLBlockPainter(this.extentGlProvider());
    } else {
      this._extentPainter.clear();
    }
    this._extentPainter.setBackgroundColor(new Color(1, 0, 0, 0));
    this._extentPainter.setBorderColor(new Color(1, 0, 0, 1));

    const layout = this.node().layout();
    const extentSize = [NaN, NaN];
    layout.extentSize(extentSize);

    const showExtents = (dir) => {
      let offset = 0;
      const dirSign = directionSign(dir);

      const borderThickness = 1;
      layout.extentsAt(dir).forEach((length, size) => {
        if (isNaN(length)) {
          return;
        }
        if (isNaN(size) || size < 0) {
          offset += length;
          return;
        }
        if (getDirectionAxis(dir) === Axis.VERTICAL) {
          if (dir === Direction.UPWARD) {
            this._extentPainter.drawBlock(
              dirSign * layout.extentOffsetAt(dir) -
                dirSign * offset -
                (dirSign * length) / 2,
              (dirSign * size) / 2,
              length,
              size,
              0,
              borderThickness
            );
          } else {
            this._extentPainter.drawBlock(
              -dirSign * layout.extentOffsetAt(dir) +
                dirSign * offset +
                (dirSign * length) / 2,
              (dirSign * size) / 2,
              length,
              size,
              0,
              borderThickness
            );
          }
        } else {
          // Axis.HORIZONTAL
          if (dir === Direction.BACKWARD) {
            this._extentPainter.drawBlock(
              (dirSign * size) / 2,
              dirSign * layout.extentOffsetAt(dir) -
                dirSign * offset -
                (dirSign * length) / 2,
              size,
              length,
              0,
              borderThickness
            );
          } else {
            this._extentPainter.drawBlock(
              (dirSign * size) / 2,
              -dirSign * layout.extentOffsetAt(dir) +
                dirSign * offset +
                (dirSign * length) / 2,
              size,
              length,
              0,
              borderThickness
            );
          }
        }
        offset += length;
      });
    };

    const showAxisExtents = (axis, colors) => {
      this._extentPainter.initBuffer(
        layout.extentsAt(getNegativeDirection(axis)).numBounds() +
          layout.extentsAt(getPositiveDirection(axis)).numBounds()
      );
      if (colors[0]) {
        this._extentPainter.setBackgroundColor(colors[0]);
      }
      showExtents(getNegativeDirection(axis));
      if (colors[1]) {
        this._extentPainter.setBackgroundColor(colors[1]);
      }
      showExtents(getPositiveDirection(axis));
    };

    switch (this.extentMode()) {
      case "vertical":
        showAxisExtents(Axis.VERTICAL, [
          new Color(0.2, 0.2, 0.5, 0.5), // blue=upward
          new Color(1, 1, 0, 0.5), // yellow=downward
        ]);
        break;
      case "horizontal":
        showAxisExtents(Axis.HORIZONTAL, [
          new Color(1, 0, 0, 0.5), // red=backward
          new Color(0, 1, 0, 0.5), // green=forward
        ]);
        break;
      case "none":
      default:
        break;
    }

    return false;
  }

  bounds(pg) {
    const b = new Rect();
    pg.siblings().forEach((node) => {
      if (node.layout().needsCommit()) {
        return;
      }
      const layout = node.layout();
      const size = [0, 0];
      layout.groupSize(size);
      b.include(layout.groupX(), layout.groupY(), ...size);
      paintNodeLines(node, LINE_THICKNESS / 2, (x, y, w, h) => {
        b.include(x, y, w, h);
      });
    });
    return b;
  }

  toggleSpotlights() {
    this._renderingSpotlights = !this._renderingSpotlights;
    this.viewport().refresh();
  }

  renderingSpotlights() {
    return this._renderingSpotlights;
  }

  showingUI() {
    return this._showingUI;
  }

  onUIChanged() {
    this._onUI?.(this.showingUI());
    this.viewport().refresh();
  }

  showUI() {
    if (this._showingUI) {
      return;
    }
    this._showingUI = true;
    this.onUIChanged();
  }

  toggleUI() {
    this._showingUI = !this._showingUI;
    this.onUIChanged();
  }

  hideUI() {
    if (!this._showingUI) {
      return;
    }
    this._showingUI = false;
    this.onUIChanged();
  }

  setOnUI(cb) {
    this._onUI = cb;
  }
}
