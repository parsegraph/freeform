import {
  Direction,
  CommitLayout,
  Alignment,
  Axis,
  getDirectionAxis,
  serializeParsegraph,
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
} from "../../settings";
import { WorldLabels } from "../WorldLabel";
import { createLayoutPainter } from "./createLayoutPainter";

const minVisibleTextScale = 1;
const initialScale = 8;
const MIN_VISIBLE_GRAPH_SCREEN = 4;

const caretColor = new Color(0.95, 0.9, 0, 1);
const caretHighlightColor = new Color(1, 1, 0, 1);
const highlightColor = new Color(1, 1, 1, 0.7);

// Node colors
const borderColor = new Color(0, 0, 0, 0.5);

export default class ViewportRendering {
  constructor(viewport) {
    this._steps = [
      ["Painting graph", () => this.paint(), () => this.allNodeCount()],
      ["Focusing camera", () => this.focusCamera(), () => 3],
      ["Clearing background", () => this.clearBackground(), () => 1],
      ["Rendering graph", () => this.render(), () => this.allPaintGroupCount()],
      [
        "Rendering extents",
        () => this.renderExtents(this.camera().project()),
        () => 1,
      ],
      ["Post-rendering", () => this.postRender(), () => 1],
      ["Persisting graph", () => this.persist(), () => 1],
    ];

    this._phase = 0;
    this._scheduledPostRender = null;

    const container = viewport.container();

    this.resetSettings();

    container.style.background = this._pageBackgroundColor.asRGBA();
    //canvas.style.overflow = 'hidden';

    const textCanvas = document.createElement("canvas");
    textCanvas.className = "viewport-text-canvas";
    textCanvas.style.position = "fixed";
    textCanvas.style.inset = 0;
    this._textCanvas = textCanvas;

    this._ctx = textCanvas.getContext("2d");

    const labelsCanvas = document.createElement("canvas");
    labelsCanvas.className = "viewport-labels-canvas";
    labelsCanvas.style.position = "fixed";
    labelsCanvas.style.inset = 0;
    this._labelsCanvas = labelsCanvas;

    this._ctx = textCanvas.getContext("2d");
    const glProvider = new BasicGLProvider();
    glProvider.container();
    glProvider.container().className = "viewport-webgl-container";
    glProvider.canvas().className = "viewport-webgl-canvas";
    glProvider.container().style.position = "fixed";
    glProvider.container().style.inset = 0;
    container.appendChild(glProvider.container());
    this._glProvider = glProvider;
    container.appendChild(textCanvas);

    this._extentGlProvider = new BasicGLProvider();
    this._extentGlProvider.container();
    this._extentGlProvider.container().style.position = "fixed";
    this._extentGlProvider.container().style.inset = 0;
    this._extentGlProvider.container();
    this._extentGlProvider.container().className = "viewport-extent-container";
    this._extentGlProvider.canvas().className = "viewport-extent-canvas";
    container.appendChild(this._extentGlProvider.container());

    container.appendChild(labelsCanvas);

    this._viewport = viewport;

    this._painters = new WeakMap();
    this._worldLabels = null;
    this._bounds = new WeakMap();

    this._showWorldLabels = SHOW_WORLD_LABELS;

    this._showingStats = PRINT_PAINT_STATS;
  }

  resetSettings() {
    this._pageBackgroundColor = PAGE_BACKGROUND_COLOR;
  }

  extentGlProvider() {
    return this._extentGlProvider;
  }

  isDone() {
    return this.phase() >= this._steps.length;
  }

  resetCounts() {
    this._nodeCount = NaN;
    this._paintGroupCount = NaN;
    this._cranks = 0;
  }

  runCount() {
    this._nodeCount = 0;
    this._paintGroupCount = 0;
    this.viewport()
      .widget()
      .paintGroup()
      .forEach((pg) => {
        this._paintGroupCount++;
        pg.siblings().forEach(() => {
          ++this._nodeCount;
        });
      });
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
    if (!this.camera().canProject()) {
      return true;
    }
    const viewport = this.viewport();
    const cam = this.camera();

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
        if (!isNaN(scale)) {
          let scaleFactor = 1 / 4;
          if (Math.abs(1 - scale) < FUZZINESS) {
            //this.viewport().logMessage("Showing node at max scale")
            this.node().layout().absoluteSize(graphSize);
            if (graphSize[0] < graphSize[1]) {
              const scale =
                (cam.width() * scaleFactor) / (graphSize[0] * cam.scale());
              if (!isNaN(scale)) {
                //this.viewport().logMessage("Zooming out camera to keep node horizontally within scale");
                cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
              }
            } else {
              const scale =
                (cam.height() * scaleFactor) / (graphSize[1] * cam.scale());
              if (!isNaN(scale)) {
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
        if (!isNaN(scale)) {
          //this.viewport().logMessage("Zooming out camera to keep node horizontally within scale");
          cam.zoomToPoint(scale, cam.width() / 2, cam.height() / 2);
          adjusted = true;
        }
      }
      if (graphSize[1] * cam.scale() > cam.height() * scaleFactor) {
        const scale =
          (cam.height() * scaleFactor) / (graphSize[1] * cam.scale());
        if (!isNaN(scale)) {
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
          if (!isNaN(scale)) {
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
      return showInCamera();
    }
    if (this.viewport().checkingScale()) {
      return checkScale();
    }

    const bodySize = [NaN, NaN];
    const layout = this.layout();
    layout.absoluteSize(bodySize);
    const bounds = new Rect(
      layout.absoluteX(),
      layout.absoluteY(),
      bodySize[0] * layout.absoluteScale(),
      bodySize[1] * layout.absoluteScale()
    );
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
      return true;
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
    return this._ctx;
  }

  clearBackground() {
    if (!this.glProvider().canProject()) {
      throw new Error("Cannot project");
    }
    this.viewport().container().style.background =
      this._pageBackgroundColor.asRGBA();

    const glProvider = this.glProvider();
    const cam = this.camera();
    const ctx = this.ctx();
    const gl = glProvider.gl();
    glProvider.render();
    gl.viewport(0, 0, cam.width(), cam.height());

    gl.clearColor(
      this._pageBackgroundColor.r(),
      this._pageBackgroundColor.g(),
      this._pageBackgroundColor.b(),
      this._pageBackgroundColor.a()
    );
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this._textCanvas.width = cam.width();
    this._textCanvas.height = cam.height();
    ctx.resetTransform();
    ctx.clearRect(0, 0, this._textCanvas.width, this._textCanvas.height);

    if (this._labelsCanvas.width !== cam.width()) {
      this._labelsCanvas.width = cam.width();
    }
    if (this._labelsCanvas.height !== cam.height()) {
      this._labelsCanvas.height = cam.height();
    }
  }

  camera() {
    return this.viewport().camera();
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

  reset() {
    this._phase = 0;
    this.resetCounts();

    this._layout = null;
    if (this._worldLabels) {
      this._worldLabels.clear();
    }
    if (this._extentPainter) {
      this._extentPainter.clear();
    }
  }

  crank() {
    this._cranks++;

    const step = this._steps[this.phase()];
    if (!step) {
      return false;
    }

    if (!step[1]()) {
      this.nextPhase();
      if (step) {
      } else {
        return false;
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
    // TODO This does not persist colors?
    localStorage.setItem(
      "parsegraph-graph",
      JSON.stringify(serializeParsegraph(this.widget()))
    );
  }

  createLayout() {
    return new CommitLayout(
      this.widget(),
      createLayoutPainter(
        this._painters,
        this._bounds,
        this.glProvider(),
        this.ctx(),
        (node) => this.viewport().getNodeStyle(node)
      )
    );
  }

  paint() {
    if (!this._layout || this._layout.startingNode() !== this.widget()) {
      this._layout = this.createLayout();
    }
    return this._layout.crank();
  }

  renderPaintGroup(paintGroup, worldMatrix, renderData) {
    const pg = paintGroup;
    const ctx = this.ctx();

    const painter = this._painters.get(pg);
    if (pg.layout().needsCommit() || pg.layout().needsAbsolutePos()) {
      renderData.dirtyGroups++;
      return true;
    }
    if (!painter) {
      renderData.dirtyGroups++;
      return true;
    }

    let bounds;
    if (this._bounds.has(pg) && !this._bounds.get(pg).dirty) {
      bounds = this._bounds.get(pg).bounds;
    } else {
      bounds = this.bounds(pg);
      if (bounds.isNaN()) {
        renderData.dirtyGroups++;
        return true;
      } else {
        this._bounds.set({ dirty: false, bounds });
      }
    }
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

    painter.render(
      matrixMultiply3x3(
        makeScale3x3(pg.layout().absoluteScale()),
        makeTranslation3x3(pg.layout().absoluteX(), pg.layout().absoluteY()),
        worldMatrix
      )
    );

    ctx.save();
    ctx.translate(pg.layout().absoluteX(), pg.layout().absoluteY());
    ctx.scale(pg.layout().absoluteScale(), pg.layout().absoluteScale());
    // eslint-disable-next-line no-loop-func
    let needsPaint = false;
    pg.siblings().forEach((node) => {
      if (node.layout().needsAbsolutePos()) {
        needsPaint = true;
        return;
      }
      if (!nodeHasValue(node)) {
        return;
      }
      const lines = node.value().toString().split("\n");
      if (
        node.layout().absoluteScale() * cam.scale() <
        LABEL_IS_VISIBLE_SCALE
      ) {
        if (!this._worldLabels) {
          this._worldLabels = new WorldLabels(minVisibleTextScale);
        }
        ++renderData.k;
        this._worldLabels.draw(
          lines[0],
          node.layout().absoluteX(),
          node.layout().absoluteY(),
          1.5 * FONT_SIZE,
          node.layout().absoluteScale(),
          new Color(1, 1, 1, 1),
          new Color(0, 0, 0, 1)
        );
      }
      if (node.layout().absoluteScale() * cam.scale() < TEXT_IS_VISIBLE_SCALE) {
        return;
      }
      ++renderData.j;
      ctx.fillStyle = borderColor.asRGBA();
      ctx.save();
      if (node.neighbors().hasNode(Direction.INWARD)) {
        const nodeSize = [0, 0];
        node.layout().size(nodeSize);
        const scale = node.layout().groupScale();
        if (
          node.neighbors().getAlignment(Direction.INWARD) ===
          Alignment.INWARD_VERTICAL
        ) {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.translate(
            node.layout().groupX(),
            node.layout().groupY() - (scale * nodeSize[1]) / 2 + scale * 3
          );
          if (lines.length > 1) {
            ctx.translate(
              0,
              node.layout().groupScale() *
                ((-(lines.length - 1) * LINE_HEIGHT) / 2 + LINE_HEIGHT / 2)
            );
          }
        } else {
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.translate(
            node.layout().groupX() -
              (scale * nodeSize[0]) / 2 +
              3 * BORDER_THICKNESS,
            node.layout().groupY()
          );
          if (lines.length > 1) {
            ctx.translate(
              0,
              (-(lines.length - 1) *
                (node.layout().groupScale() * LINE_HEIGHT)) /
                2
            );
          }
        }
      } else {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.translate(node.layout().groupX(), node.layout().groupY());
        if (lines.length > 1) {
          ctx.translate(
            0,
            (-(lines.length - 1) * (node.layout().groupScale() * LINE_HEIGHT)) /
              2
          );
        }
      }
      ctx.font = `${FONT_SIZE}px sans-serif`;
      const style = this.viewport().getNodeStyle(node);
      ctx.scale(node.layout().groupScale(), node.layout().groupScale());
      ctx.fillStyle = Color.fromHex(style.textColor)
        .setA(style.textAlpha)
        .asRGBA();
      lines.forEach((line) => {
        ctx.fillText(line, 0, 0);
        ctx.translate(0, LINE_HEIGHT);
      });
      ctx.restore();
    });
    ctx.restore();

    return needsPaint;
  }

  render() {
    const cam = this.camera();
    if (!this.glProvider().canProject() || !cam.canProject()) {
      return false;
    }

    const worldMatrix = cam.project();
    const ctx = this.ctx();

    ctx.scale(cam.scale(), cam.scale());
    ctx.translate(cam.x(), cam.y());

    let pg = this.widget();
    let needsPaint = false;

    let renderData = {
      i: 0,
      j: 0,
      k: 0,
      allGroups: 0,
      dirtyGroups: 0,
      offscreenGroups: 0,
    };
    do {
      ++renderData.allGroups;
      if (this.renderPaintGroup(pg, worldMatrix, renderData)) {
        needsPaint = true;
      }
      pg = pg.paintGroup().next();
    } while (pg !== this.widget());

    ctx.resetTransform();
    ctx.scale(cam.scale(), cam.scale());
    ctx.translate(cam.x(), cam.y());

    this.renderHovered();
    this.renderCaret();

    if (this._showingStats) {
      const { i, j, k, dirtyGroups, offscreenGroups, allGroups } = renderData;
      ctx.resetTransform();
      ctx.font = "18px sans-serif";
      ctx.textBaseline = "bottom";
      ctx.textAlign = "left";
      ctx.fillStyle = "white";
      ctx.fillText(
        `groups=${i}/${allGroups} (dirty=${dirtyGroups}, offscreen=${offscreenGroups}), text=${j}, labels=${k}`,
        0,
        cam.height()
      );
      ctx.textAlign = "right";
      ctx.fillText(cam.toString(), cam.width(), cam.height());
    }

    if (this._offscreenHandler && !needsPaint) {
      const isOffscreen =
        renderData.i === 0 &&
        renderData.dirtyGroups === 0 &&
        renderData.offscreenGroups === renderData.allGroups &&
        renderData.allGroups > 0;
      this._offscreenHandler(isOffscreen);
    }

    return needsPaint;
  }

  setOffscreenHandler(offscreenHandler) {
    this._offscreenHandler = offscreenHandler;
  }

  renderCaret() {
    const ctx = this.ctx();
    const layout = this.layout();
    const cam = this.camera();

    if (this.node()) {
      ctx.lineWidth = (BORDER_THICKNESS / 2) * layout.absoluteScale();
      ctx.lineJoin = "round";
      let hovered = this.viewport().input()?.hoveredNode();
      ctx.strokeStyle =
        hovered === this.node()
          ? caretHighlightColor.asRGBA()
          : caretColor.asRGBA();
      const bodySize = [0, 0];
      layout.size(bodySize);
      if (this.viewport().showingCaret()) {
        if (
          nodeHasValue(this.node()) ||
          this.node().neighbors().hasNode(Direction.INWARD)
        ) {
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
      } else {
        ctx.lineWidth = 0.1;
        ctx.lineJoin = "round";
        ctx.strokeRect(
          layout.absoluteX() - (layout.absoluteScale() * bodySize[0]) / 2,
          layout.absoluteY() - (layout.absoluteScale() * bodySize[1]) / 2,
          layout.absoluteScale() * bodySize[0],
          layout.absoluteScale() * bodySize[1]
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

  cancelPostRender() {
    if (this._scheduledPostRender === null) {
      return;
    }
    this._scheduledPostRender();
    this._scheduledPostRender = null;
  }

  labelsCtx() {
    return this._labelsCanvas.getContext("2d");
  }

  clearLabelsCtx() {
    const ctx = this.labelsCtx();
    ctx.save();
    ctx.resetTransform();
    ctx.clearRect(0, 0, this._labelsCanvas.width, this._labelsCanvas.height);
    ctx.restore();
  }

  postRender() {
    this.cancelPostRender();
    this.schedulePostRender();

    if (this._renderedWorldLabels) {
      const cam = this.camera();
      const ctx = this.labelsCtx();
      ctx.resetTransform();
      ctx.scale(cam.scale(), cam.scale());
      ctx.translate(cam.x(), cam.y());
      this.clearLabelsCtx();
      if (this._showWorldLabels) {
        this._renderedWorldLabels.render(
          ctx,
          this.pageBackgroundColor(),
          cam.scale()
        );
      }
    }
    return false;
  }

  schedulePostRender() {
    if (this._scheduledPostRender || !this._worldLabels) {
      return;
    }
    const cam = this.camera();
    const ctx = this.labelsCtx();

    this._scheduledPostRender = this._worldLabels.prepareRender(
      ctx,
      cam.x(),
      cam.y(),
      cam.width(),
      cam.height(),
      cam.scale(),
      () => {
        requestAnimationFrame(() => {
          this._scheduledPostRender = null;
          this.clearLabelsCtx();
          ctx.resetTransform();
          ctx.scale(cam.scale(), cam.scale());
          ctx.translate(cam.x(), cam.y());
          if (this._showWorldLabels) {
            this._worldLabels.render(ctx, this.pageBackgroundColor());
          }
          this._renderedWorldLabels = this._worldLabels.clone();
        });
      }
    );
  }

  renderExtents(worldMatrix) {
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
    const gl = this.extentGlProvider().gl();
    const cam = this.camera();
    gl.viewport(0, 0, cam.width(), cam.height());

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
}
