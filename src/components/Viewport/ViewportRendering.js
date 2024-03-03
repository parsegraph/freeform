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
} from "parsegraph";
import Color from 'parsegraph-color';
import { BasicGLProvider } from 'parsegraph-compileprogram';
import { WebGLBlockPainter } from 'parsegraph-blockpainter';
import {
  makeTranslation3x3,
  matrixMultiply3x3,
  makeScale3x3,
} from 'parsegraph-matrix';
import { showNodeInCamera } from "parsegraph-showincamera";
import Rect from "parsegraph-rect";
import { USE_LOCAL_STORAGE, TEXT_IS_VISIBLE_SCALE, LABEL_IS_VISIBLE_SCALE, PAGE_BACKGROUND_COLOR, PRINT_PAINT_STATS, ENABLE_EXTENT_VIEWING, nodeHasValue, BORDER_ROUNDEDNESS, BORDER_THICKNESS, LINE_HEIGHT, FONT_SIZE } from "../../settings";
import { WorldLabels } from "../WorldLabel";
import { createLayoutPainter } from "./createLayoutPainter";

const minVisibleTextScale = 1;
const initialScale = 4;

const caretColor = new Color(.95, .9, 0, 1);

// Node colors
const borderColor = new Color(0, 0, 0, 0.5);

export default class ViewportRendering {
    constructor(viewport) {
        this._phase = 0;
        this._scheduledPostRender = null;

        const container = viewport.container();

        this._pageBackgroundColor = PAGE_BACKGROUND_COLOR;

        container.style.background = this._pageBackgroundColor.asRGBA();
        //canvas.style.overflow = 'hidden';

        const textCanvas = document.createElement('canvas');
        textCanvas.className = 'viewport-text-canvas';
        textCanvas.style.position = 'fixed';
        textCanvas.style.inset = 0;
        this._textCanvas = textCanvas;

        this._ctx = textCanvas.getContext("2d");

        const glProvider = new BasicGLProvider();
        glProvider.container();
        glProvider.container().className = "viewport-webgl-container";
        glProvider.canvas().className = "viewport-webgl-canvas";
        glProvider.container().style.position = 'fixed';
        glProvider.container().style.inset = 0;
        container.appendChild(glProvider.container());
        this._glProvider = glProvider;
        container.appendChild(textCanvas);

        this._viewport = viewport;

        this._painters = new WeakMap();
        this._worldLabels = null;
        this._bounds = new WeakMap();
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

    focusCamera() {
        if (!this.camera().canProject()) {
            return true;
        }
        const viewport = this.viewport();
        const cam = this.camera();
        if (this._showInCamera) {
            viewport.logMessage("showing in camera");
            const scale = initialScale/this.layout().absoluteScale();
            if (!isNaN(scale) && isFinite(scale)) {
                cam.setScale(initialScale/this.layout().absoluteScale());
                showNodeInCamera(this.viewport().node(), cam);
                this._showInCamera = false;
            }
            return true;
        }

        const graphSize = [NaN, NaN];
        const layout = this.layout();
        this.layout().extentSize(graphSize);
        if (graphSize[0] > 0 && graphSize[1] > 0) {
            const scaleFactor = 4;
            if (this._checkScale && (Math.max(...graphSize) * cam.scale() < Math.min(cam.height(), cam.width())/(scaleFactor))) {
                viewport.logMessage("checking scale");
                const scale = (Math.min(cam.height(), cam.width())/scaleFactor) / (cam.scale() * Math.max(...graphSize));
                if (!isNaN(scale)) {
                    cam.zoomToPoint(
                        scale,
                        cam.width()/2,
                        cam.height()/2
                    );
                    this._checkScale = false;
                }
                return true;
            }
        }

        const bodySize = [NaN, NaN];
        layout.absoluteSize(bodySize);
        if (bodySize[0] > 0 && bodySize[1] > 0 && this._ensureVisible && !cam.containsAny(new Rect(
            layout.absoluteX(),
            layout.absoluteY(),
            bodySize[0],
            bodySize[1]
        ))) {
            viewport.logMessage("ensuring visible");
            showNodeInCamera(this._userCaret.node(), cam);
            this._ensureVisible = false;
            return true;
        }
        return false;
    }

    glProvider() {
        return this._glProvider;
    }

    ctx() {
        return this._ctx;
    }

    clearBackground() {
        this.viewport().container().style.background = this._pageBackgroundColor.asRGBA();

        const glProvider = this.glProvider();
        const cam = this.camera();
        const ctx = this.ctx();
        const gl = glProvider.gl();
        glProvider.render();
        gl.viewport(0, 0, cam.width(), cam.height());

        gl.clearColor(this._pageBackgroundColor.r(),
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
        this._layout = null;
        if (this._worldLabels) {
            this._worldLabels.clear();
        }
    }

    crank() {
        if (!this.phase()) {
            this.nextPhase();
        }

        let steps = [
            null,
            () => this.clearBackground(),
            () => this.focusCamera(),
            () => this.paint(),
            () => this.render(),
            () => {
                this.cancelPostRender();
                this.schedulePostRender();
                return false;
            },
            () => this.persist(),
        ];
        if (!steps[this.phase()]) {
            return false;
        }

        if (!steps[this.phase()]()) {
            this.nextPhase();
        }
        return true;
    }

    persist() {
        if (!USE_LOCAL_STORAGE) {
            return;
        }
        localStorage.setItem("parsegraph-camera", JSON.stringify(this.camera().toJSON()));
        // TODO This does not persist colors?
        localStorage.setItem("parsegraph-graph", JSON.stringify(serializeParsegraph(this.widget())));
    }

    createLayout() {
        return new CommitLayout(this.widget(), createLayoutPainter(
            this._painters, this._bounds, this.glProvider(), this.ctx(), (node) => this.viewport().getNodeStyle(node)
        ));
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
        if (!painter || pg.layout().needsCommit() || pg.layout().needsAbsolutePos()) {
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
                this._bounds.set({dirty: false, bounds});
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

        painter.render(matrixMultiply3x3(
            makeScale3x3(
                pg.layout().absoluteScale()
            ),
            makeTranslation3x3(
                pg.layout().absoluteX(), pg.layout().absoluteY()
            ),
            worldMatrix
        ));

        ctx.save();
        ctx.translate(pg.layout().absoluteX(), pg.layout().absoluteY());
        ctx.scale(pg.layout().absoluteScale(), pg.layout().absoluteScale());
        // eslint-disable-next-line no-loop-func
        let needsPaint = false;
        pg.siblings().forEach(node => {
            if (node.layout().needsAbsolutePos()) {
                needsPaint = true;
                return;
            }
            if (!nodeHasValue(node)) {
                return;
            }
            const lines = node.value().toString().split('\n');
            if(node.layout().absoluteScale() * cam.scale() < LABEL_IS_VISIBLE_SCALE) {
                if (!this._worldLabels) {
                    this._worldLabels = new WorldLabels(minVisibleTextScale);
                }
                ++renderData.k;
                this._worldLabels.draw(lines[0], node.layout().absoluteX(), node.layout().absoluteY(), 1.5*FONT_SIZE,
                    node.layout().absoluteScale(), new Color(1, 1, 1, 1), new Color(0, 0, 0, 1));
            }
            if(node.layout().absoluteScale() * cam.scale() < TEXT_IS_VISIBLE_SCALE) {
                return;
            }
            ++renderData.j;
            ctx.fillStyle = borderColor.asRGBA();
            ctx.save();
            if (node.neighbors().hasNode(Direction.INWARD)) {
                const nodeSize = [0, 0]
                node.layout().size(nodeSize);
                const scale = node.layout().groupScale();
                if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.translate(node.layout().groupX(), node.layout().groupY() - scale * nodeSize[1]/2 + scale * 3);
                    if (lines.length > 1) {
                        ctx.translate(0, node.layout().groupScale() * (-(lines.length - 1) * LINE_HEIGHT / 2 + LINE_HEIGHT/2));
                    }
                } else {
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.translate(node.layout().groupX() - scale * nodeSize[0]/2 + 3*BORDER_THICKNESS, node.layout().groupY());
                    if (lines.length > 1) {
                        ctx.translate(0, -(lines.length - 1) * (node.layout().groupScale() * LINE_HEIGHT) / 2);
                    }
                }
            } else {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.translate(node.layout().groupX(), node.layout().groupY());
                if (lines.length > 1) {
                    ctx.translate(0, -(lines.length - 1) * (node.layout().groupScale() * LINE_HEIGHT) / 2);
                }
            }
                ctx.font = `${FONT_SIZE}px sans-serif`;
                const style = this.viewport().getNodeStyle(node);
                ctx.scale(node.layout().groupScale(), node.layout().groupScale());
                ctx.fillStyle = Color.fromHex(style.textColor).setA(style.textAlpha).asRGBA();
                lines.forEach(line => {
                    ctx.fillText(line, 0, 0)
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
            return true;
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
            offscreenGroups: 0
        }
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

        this.renderCaret();
        this.renderExtents(worldMatrix);

        if (PRINT_PAINT_STATS) {
            const {i, j, k, dirtyGroups, offscreenGroups, allGroups } = renderData;
            ctx.resetTransform();
            ctx.font = "18px sans-serif";
            ctx.textBaseline = "bottom";
            ctx.textAlign = "left";
            ctx.fillStyle = "white";
            ctx.fillText(`groups=${i}/${allGroups} (dirty=${dirtyGroups}, offscreen=${offscreenGroups}), text=${j}, labels=${k}`, 0, cam.height());
            console.log(`groups=${i}/${allGroups} (dirty=${dirtyGroups}, offscreen=${offscreenGroups}), text=${j}, labels=${k}`, 0, cam.height());
            ctx.textAlign = "right";
            ctx.fillText(cam.toString(), cam.width(), cam.height());
        }

        return needsPaint;
    };

    renderCaret() {
        const ctx = this.ctx();
        const layout = this.layout();
        const cam = this.camera();

        if (this.node()) {
            ctx.lineWidth = BORDER_THICKNESS/2 * layout.absoluteScale();
            ctx.lineJoin = "round";
            ctx.strokeStyle = caretColor.asRGBA();
            const bodySize = [0, 0];
            layout.size(bodySize);
            if (this.viewport().showingCaret()) {
                if (nodeHasValue(this.node()) || this.node().neighbors().hasNode(Direction.INWARD)) {
                    ctx.beginPath();
                    ctx.roundRect(
                        layout.absoluteX() - layout.absoluteScale() * bodySize[0]/2 + BORDER_THICKNESS/4 * layout.absoluteScale(),
                        layout.absoluteY() - layout.absoluteScale() * bodySize[1]/2 + BORDER_THICKNESS/4 * layout.absoluteScale(),
                        layout.absoluteScale() * bodySize[0] - BORDER_THICKNESS/2 * layout.absoluteScale(),
                        layout.absoluteScale() * bodySize[1] - BORDER_THICKNESS/2 * layout.absoluteScale(),
                        BORDER_ROUNDEDNESS * layout.absoluteScale() /2.13
                    );
                    ctx.stroke();
                } else {
                    ctx.beginPath();
                    ctx.arc(
                        layout.absoluteX(),
                        layout.absoluteY(),
                        bodySize[0]/2 * layout.absoluteScale() - BORDER_THICKNESS/4 * layout.absoluteScale(),
                        0,
                        Math.PI * 2
                    )
                    ctx.stroke();
                }
            } else {
                ctx.lineWidth = .1;
                ctx.lineJoin = "round";
                ctx.strokeRect(
                    layout.absoluteX() - layout.absoluteScale() * bodySize[0]/2,
                    layout.absoluteY() - layout.absoluteScale() * bodySize[1]/2,
                    layout.absoluteScale() * bodySize[0],
                    layout.absoluteScale() * bodySize[1]
                );
            }

            ctx.resetTransform();
            //ctx.textAlign = 'left';
            //ctx.textBaseline = 'top';
            //ctx.fillText(this.node()?.value(), 0, 0);
    
            if (this.viewport().showNodeActions() && this.viewport().showingCaret()) {
                this.carouselContainer().style.display = 'block';
                this.carouselContainer().style.transform = `scale(${cam.scale()}) translate(${layout.absoluteX() + cam.x()}px, ${layout.absoluteY() + cam.y()}px) scale(${1/cam.scale()}) translate(-${cam.width()/2}px, -${cam.height()/2}px) translate(-50%, -50%)`;
                console.log(this.carouselContainer(), `scale(${cam.scale()}) translate(${layout.absoluteX() + cam.x()}px, ${layout.absoluteY() + cam.y()}px) scale(${1/cam.scale()}) translate(-${cam.width()/2}px, -${cam.height()/2}px) translate(-50%, -50%)`);

                this.carouselAnchor().style.width = `${bodySize[0] * layout.absoluteScale() * cam.scale()}px`;
                this.carouselAnchor().style.height = `${bodySize[1] * layout.absoluteScale() * cam.scale()}px`;
            } else {
                this.carouselContainer().style.display = 'none';
            }
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

    schedulePostRender() {
        if (this._scheduledPostRender || !this._worldLabels) {
            return;
        }
        const cam = this.camera();
        const ctx = this.ctx();

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
                    ctx.resetTransform();
                    ctx.scale(cam.scale(), cam.scale());
                    ctx.translate(cam.x(), cam.y());
                    this._worldLabels.render(ctx, this.pageBackgroundColor());
                });
            }
        );
    };

    renderExtents(worldMatrix) {
        if (!this.node() || !this._extentPainter) {
            return;
        }
        const layout = this.layout();
        this._extentPainter.render(matrixMultiply3x3(
            makeScale3x3(
                layout.absoluteScale()
            ),
            makeTranslation3x3(
                layout.absoluteX(), layout.absoluteY()
            ),
            worldMatrix
        ));
    }

    paintExtents() {
        if (!ENABLE_EXTENT_VIEWING) {
            return;
        }

        if (!this._extentPainter) {
            this._extentPainter = new WebGLBlockPainter(this._glProvider);
        } else {
            this._extentPainter.clear();
        }
        this._extentPainter.setBackgroundColor(new Color(1, 0, 0, 0.2));
        this._extentPainter.setBorderColor(new Color(1, 0, 0, 0.5));

        const layout = this._userCaret.node().layout();
        const extentSize = [NaN, NaN];
        layout.extentSize(extentSize);

        const showExtents = (dir) => {
            let offset = 0;
            const dirSign = directionSign(dir);

            layout.extentsAt(dir).forEach((length, size) => {
                if (getDirectionAxis(dir) === Axis.VERTICAL) {
                    if (dir === Direction.UPWARD) {
                        this._extentPainter.drawBlock(
                            dirSign*layout.extentOffsetAt(dir) - dirSign * offset - dirSign*length/2,
                            dirSign*size/2,
                            length,
                            size,
                            0, 0
                        );
                    } else {
                        this._extentPainter.drawBlock(
                            -dirSign*layout.extentOffsetAt(dir) + dirSign * offset + dirSign*length/2,
                            dirSign*size/2,
                            length,
                            size,
                            0, 0
                        );
                    }
                } else {
                    // Axis.HORIZONTAL
                    if (dir === Direction.BACKWARD) {
                        this._extentPainter.drawBlock(
                            dirSign*size/2,
                            dirSign*layout.extentOffsetAt(dir) - dirSign * offset - dirSign*length/2,
                            size,
                            length,
                            0, 0
                        );
                    } else {
                        this._extentPainter.drawBlock(
                            dirSign*size/2,
                            -dirSign*layout.extentOffsetAt(dir) + dirSign * offset + dirSign*length/2,
                            size,
                            length,
                            0, 0
                        );
                    }
                }
                offset += length;
            });
        };

        const showAxisExtents = (axis, colors) => {
            this._extentPainter.initBuffer(
                layout.extentsAt(getNegativeDirection(axis)).numBounds() +layout.extentsAt(getPositiveDirection(axis)).numBounds()
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

        switch (this._extentMode) {
            case "vertical":
                showAxisExtents(Axis.VERTICAL, [
                    new Color(.2, .2, 0.5, .5), // blue=upward
                    new Color(1, 1, 0, .5), // yellow=downward
                ]);
                break;
            case "horizontal":
                showAxisExtents(Axis.HORIZONTAL, [
                    new Color(1, 0, 0, .5), // red=backward
                    new Color(0, 1, 0, .5), // green=forward
                ]);
                break;
            case "none":
            default:
                break;
        }
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
            b.include(
                layout.groupX(),
                layout.groupY(),
                ...size
            );
        });
        return b;
    }
}