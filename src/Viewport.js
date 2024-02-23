import { 
  Direction,
  DirectionNode,
  CommitLayout,
  paintNodeBounds,
  paintNodeLines,
  Alignment,
  DirectionCaret,
  Axis,
  reverseDirection,
  getDirectionAxis,
  PreferredAxis,
  Fit,
} from "parsegraph";
import Color from 'parsegraph-color';
import { BasicGLProvider } from 'parsegraph-compileprogram';
import { WebGLBlockPainter } from 'parsegraph-blockpainter';
import Camera from 'parsegraph-camera';
import {
  makeTranslation3x3,
  matrixMultiply3x3,
  makeScale3x3,
  midPoint
} from 'parsegraph-matrix';

const fontSize = 24;
const borderThickness = 3;
const borderRoundedness = 5;
const maxClickDelay = 1000;
const borderColor = new Color(0.7, 0.7, 0.7, 1);
const initialScale = 4;

let attempts = 0;

const distance = (x1, y1, x2, y2) => {
    return Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));
}

const nodeHasValue = (node) => typeof node.value() === "string" || typeof node.value() === "number";

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
export default class Viewport {
    constructor() {
        this._container = null;
        this._widget = null;
        this._painters = new WeakMap();

        // Create and restore the camera if possible
        this._cam = new Camera();
        this._showEditor = false;
    }

    mount(container) {
        if (this._container === container) {
            return;
        }
        this._container = container;
        container.tabIndex = '0';
        const canvas = container;
        //container.addEventListener('dragover', e => e.preventDefault());
        //container.addEventListener('drop', drop)

        // Input event callbacks
        let isDown = null;
        let [mouseX, mouseY] = [NaN, NaN];

        const spawnMove = (dir, pullIfOccupied) => {
        if (this._userCaret.node().neighbors().hasNode(dir)) {
            if (pullIfOccupied && !this._userCaret.node().neighbors().isRoot()) {
                console.log("Pulling!");
                this._userCaret.fitExact();
                this._userCaret.node().neighbors().parentNode().siblings().pull(
                    reverseDirection(this._userCaret.node().neighbors().parentDirection())
                )
            } else {
                this._userCaret.move(dir);
            }
            this.repaint();
        } else {
            this._userCaret.spawnMove(dir);
            this.repaint();
        }
        };


        const mouseDownPos = [0, 0];

        const size = [0, 0];
        canvas.addEventListener('mousedown', e => {
        isDown = null;
        [mouseX, mouseY] = [e.clientX, e.clientY];
        const [worldX, worldY] = this._cam.transform(mouseX, mouseY);
        mouseDownPos[0] = worldX;
        mouseDownPos[1] = worldY;
        let selectedNode = this._widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
        if (selectedNode) {
            touchingNode = true;
            if (this._userCaret.node() !== selectedNode) {
            this._userCaret.moveTo(selectedNode);
            this.refresh();
            }
        } else {
            isDown = Date.now();
        }
        });
        canvas.addEventListener('mouseup', e => {
        if (touchingNode) {
            gesture(mouseX, mouseY);
            this.repaint();
            touchingNode = false;
        }
        else if (!isNaN(isDown) && Date.now() - isDown < maxClickDelay) {
            const [worldX, worldY] = this._cam.transform(mouseX, mouseY);
            let selectedNode = this._widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
            if (selectedNode === this._userCaret.node()) {
            this._showEditor = false;
            this.toggleEditor();
            } else if (selectedNode) {
            this._userCaret.moveTo(selectedNode);
            this.refresh();
            }
        }
        isDown = null;
        [mouseX, mouseY] = [NaN, NaN];
        this.refresh();
        });
        canvas.addEventListener('mousemove', e => {
        const dx = e.clientX - mouseX;
        const dy = e.clientY - mouseY;
        //console.log("isDown", isDown, "touchingNode", touchingNode);
        if (isDown && !touchingNode) {
            this._cam.adjustOrigin(dx / this._cam.scale(), dy / this._cam.scale());
            this.refresh();
        }
        [mouseX, mouseY] = [e.clientX, e.clientY];
        });

        const ongoingTouches = new Map();
        const numActiveTouches = () => {
        let i = 0;
        for (let _foo of ongoingTouches.keys()) {
            ++i;
        }
        return i;
        };

        let touchingNode = false;
        canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; ++i) {
            const touch = e.changedTouches[i];
            [mouseX, mouseY] = [touch.clientX, touch.clientY];
            ongoingTouches.set(touch.identifier, {
            mouseX: touch.clientX,
            mouseY: touch.clientY
            });
            const [worldX, worldY] = cam.transform(mouseX, mouseY);
            const size = [0, 0];
            let selectedNode = this._widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
            if (selectedNode) {
            touchingNode = true;
            if (this._userCaret.node() !== selectedNode) {
                this._userCaret.moveTo(selectedNode);
            }
            isDown = Date.now();
            this.refresh();
            } else {
            isDown = Date.now();
            }
        }
        });

        const gesture = (mouseX, mouseY) => {
            const layout = this._userCaret.node().layout();
            const [worldX, worldY] = cam.transform(mouseX, mouseY);
            const dist = distance(
                worldX, worldY,
                layout.absoluteX(),
                layout.absoluteY()
            );
            const bodySize = [0, 0];
            this._userCaret.node().layout().size(bodySize);

            const dy = Math.abs(worldY - layout.absoluteY());
            const dx = Math.abs(worldX - layout.absoluteX());

            touchingNode = false;

            if (worldX === layout.absoluteX() || dy > dx) {
                if (dist > bodySize[1]/2) {
                if (worldY > layout.absoluteY()) {
                    spawnMove(Direction.DOWNWARD, true);
                } else {
                    spawnMove(Direction.UPWARD, true);
                }
                isDown = NaN;
                return;
                }
            } else {
                if (dist > bodySize[0]/2) {
                if (worldX > layout.absoluteX()) {
                    spawnMove(Direction.FORWARD, true);
                } else {
                    spawnMove(Direction.BACKWARD, true);
                }
                isDown = NaN;
                return;
                }
            }
        };

        canvas.addEventListener('touchend', e => {
        let [mouseX, mouseY] = [0, 0]
        const isGesture = numActiveTouches() === 1;
        for (let i = 0; i < e.changedTouches.length; ++i) {
            const touch = e.changedTouches[i];
            const touchData = ongoingTouches.get(touch.identifier);
            mouseX = touchData.mouseX;
            mouseY = touchData.mouseY;

            ongoingTouches.delete(touch.identifier);
        }
        if (touchingNode && isGesture) {
            gesture(mouseX, mouseY);
            this.repaint();

            if (!isNaN(isDown) && Date.now() - isDown < maxClickDelay) {
            this._showEditor = false;
            this.toggleEditor();
            }
        }
        });

        canvas.addEventListener('touchmove', e => {
        e.preventDefault();

        if (numActiveTouches() > 1) {
            const [first, second] = [...ongoingTouches.values()];
            const origDistance = distance(first.mouseX, first.mouseY, second.mouseX, second.mouseY);
            for (let i = 0; i < e.changedTouches.length; ++i) {
            const touch = e.changedTouches[i];
            const touchData = ongoingTouches.get(touch.identifier);
            touchData.mouseX = touch.clientX;
            touchData.mouseY = touch.clientY;
            }
            const newDistance = distance(first.mouseX, first.mouseY, second.mouseX, second.mouseY);
            cam.zoomToPoint(newDistance / origDistance, ...midPoint(first.mouseX, first.mouseY, second.mouseX, second.mouseY));
            this.refresh();
            return;
        }

        for (let i = 0; i < e.changedTouches.length; ++i) {
            const touch = e.changedTouches[i];
            const touchData = ongoingTouches.get(touch.identifier);
            const dx = touch.clientX - touchData.mouseX;
            const dy = touch.clientY - touchData.mouseY;
            if (!touchingNode) {
                cam.adjustOrigin(dx / cam.scale(), dy / cam.scale());
                this.refresh();
            }
            touchData.mouseX = touch.clientX;
            touchData.mouseY = touch.clientY;
        }
        });

        canvas.addEventListener('wheel', e => {
        if (!isNaN(mouseX)) {
            cam.zoomToPoint(Math.pow(1.1, e.deltaY > 0 ? -1 : 1), mouseX, mouseY);
            this.refresh();
        }
        });
        canvas.addEventListener('keydown', e => {
        if (this._showEditor) {
            return;
        }
        const pull = (dir) => {
            if (this._userCaret.node().neighbors().isRoot()) {
                return;
            }
            if (dir === this._userCaret.node().neighbors().parentDirection()) {
                this._userCaret.fitExact();
                this._userCaret.node().neighbors().parentNode().siblings().pull(
                    reverseDirection(this._userCaret.node().neighbors().parentDirection())
                );
                this.repaint();
            }
            return;
        };

        const toggleAlignment = () => {
            const node = this._userCaret.node();
            if (node.neighbors().isRoot()) {
                console.log("LAYOUTPREF", node.siblings().getLayoutPreference());
                node.setNodeFit(Fit.EXACT);
                node.siblings().setLayoutPreference(
                    node.siblings().getLayoutPreference() === PreferredAxis.HORIZONTAL ?
                    PreferredAxis.VERTICAL : PreferredAxis.HORIZONTAL
                );
                this.repaint();
                return;
            }
            node.setNodeFit(Fit.LOOSE);
            const childDir = reverseDirection(node.neighbors().parentDirection())
            const alignment = node.neighbors().parentNode().neighbors().getAlignment(childDir);
            node.neighbors().parentNode().neighbors().align(
                childDir,
                nextAlignment(alignment, childDir)
            )
            this.repaint();
        };

        switch (e.key) {
            case 'Escape':
            cam.setScale(initialScale);
            this.refresh();
            break;
            case 'x':
            case 'Backspace':
            if (this._userCaret.node().neighbors().isRoot()) {
                return;
            }
            const node = this._userCaret.node();
            this._userCaret.moveTo(node.neighbors().parentNode());
            node.disconnect();
            this.repaint();
            break;
            case 'o':
            if (this._userCaret.has(Direction.OUTWARD)) {
                this._userCaret.move(Direction.OUTWARD);
                this.refresh();
            } else if (!this._userCaret.node().neighbors().isRoot()) {
                this._userCaret.move(this._userCaret.node().neighbors().parentDirection());
                this.refresh();
            }
            break;
            case 'i':
            spawnMove(Direction.INWARD);
            break;
            case 'J':
            pull(Direction.DOWNWARD);
            break;
            case 'K':
            pull(Direction.UPWARD);
            break;
            case 'L':
            pull(Direction.FORWARD);
            break;
            case 'H':
            pull(Direction.BACKWARD);
            break;
            case 'v':
            toggleAlignment();
            break;
            case 'ArrowDown':
            case 'j':
            spawnMove(Direction.DOWNWARD);
            break;
            case 'ArrowUp':
            case 'k':
            spawnMove(Direction.UPWARD);
            break;
            case 'ArrowRight':
            case 'l':
            spawnMove(Direction.FORWARD);
            break;
            case 'ArrowLeft':
            case 'h':
            spawnMove(Direction.BACKWARD);
            break;
            case '`':
            case '~':
            if (this._userCaret.node().scale() !== 1) {
                this._userCaret.node().setScale(1);
            } else {
                this._userCaret.shrink();
            }
            this.repaint();
            break;
            case 'Enter':
            this.toggleEditor();
            this.refresh();
            break;
            default:
            return;
        }
        e.preventDefault();
        });

        const cam = this._cam;
        new ResizeObserver(() => {
            let needsPos = !cam.canProject();
            cam.setSize(canvas.offsetWidth, canvas.offsetHeight);
            if (needsPos) {
                cam.setScale(initialScale);
                cam.adjustOrigin(cam.width()/(2*initialScale), cam.height()/(2*initialScale));
            }
            this.refresh();
        }).observe(canvas);


        canvas.style.background = 'black';
        canvas.style.overflow = 'hidden';

        const textCanvas = document.createElement('canvas');
        textCanvas.style.position = 'absolute';
        textCanvas.style.left = 0;
        textCanvas.style.right = 0;
        textCanvas.style.top = 0;
        textCanvas.style.bottom = 0;
        this._textCanvas = textCanvas;

        this._ctx = textCanvas.getContext("2d");

        const glProvider = new BasicGLProvider();
        glProvider.container();
        glProvider.container().style.position = 'relative';
        glProvider.container().style.width = '100%';
        glProvider.container().style.height = '100%';
        canvas.appendChild(glProvider.container());
        this._glProvider = glProvider;
        canvas.appendChild(textCanvas);

        this._editor = this.createEditor();
        canvas.appendChild(this._editor);
    }

    repaint() {
        requestAnimationFrame(() => {
            this._layout = this.createLayout();
            this.paint();
        });
    }

    refresh() {
        requestAnimationFrame(() => {
            this.paint();
        });
    };

    show(widget) {
        if (this._widget === widget) {
            return;
        }
        this._widget = widget;
        this._userCaret = new DirectionCaret(widget);
        this.repaint();
    }

    createEditor() {
        const editor = document.createElement('input');
        editor.style.position = 'absolute';
        editor.style.bottom = '5%';
        editor.style.bottom = '5%';
        editor.style.left = '5%';
        editor.style.right = '5%';
        editor.style.fontSize = '24px';
        editor.style.display = 'none';
        editor.addEventListener('blur', e => {
        this._showEditor = false;
        this._userCaret.node().setValue(editor.value === '' ? undefined : editor.value);
        editor.style.display = 'none';
        this._container.focus();
        this.refresh();
        });
        editor.addEventListener('keypress', e => {
        if (e.key === 'Escape') {
            this._showEditor = false;
            editor.style.display = 'none';
            this._container.focus();
        } else if (e.key === 'Enter') {
            this._showEditor = false;
            this._userCaret.node().setValue(editor.value === '' ? undefined : editor.value);
            editor.style.display = 'none';
            this._container.focus();
            this.refresh();
        }
        })
        return editor;
    }

    toggleEditor() {
        this._showEditor = !this._showEditor;
        if (this._showEditor) {
            this._editor.style.display = 'block';
            this._editor.focus();
            if (nodeHasValue(this._userCaret.node())) {
            this._editor.value = this._userCaret.node().value();
            } else {
            this._editor.value = '';
            }
        } else {
            this._editor.style.display = 'none';
        }
    }

    createLayout() {
        console.log("New layout", this._widget.id());
        return new CommitLayout(this._widget, {
            size: (node, size) => {
            console.log("SIZE");
            size[0] = fontSize;
            if (nodeHasValue(node)) {
                const { width } = this._ctx.measureText(node.value());
                size[0] = Math.max(size[0], width + 6*borderThickness);
            }
            size[1] = fontSize;

            if (node.neighbors().hasNode(Direction.INWARD)) {
                const child = node.neighbors().nodeAt(Direction.INWARD);
                const childSize = [0, 0];
                child.layout().extentSize(childSize);

                if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
                if (!nodeHasValue(node)) {
                    size[0] = 4*borderThickness;
                    size[1] = 4*borderThickness;
                }
                // Vertically aligned inward node.
                size[0] = Math.max(size[0], 2*borderThickness + child.scale() * childSize[0]);
                size[1] += childSize[1] * child.scale();
                } else {
                if (!nodeHasValue(node)) {
                    size[0] = borderThickness;
                    size[1] = borderThickness;
                }
                // Default is horizontal
                size[0] += childSize[0] * child.scale();
                size[1] = Math.max(size[1], borderThickness + child.scale() * childSize[1]);
                }
            }
            },
            getSeparation: (node, axis) => {
            if (axis === Axis.Z) {
                return borderThickness;
            }
            return fontSize/2;
            },
            paint: (pg) => {
            console.log("PAINT", pg.id())
            let painter = this._painters.get(pg);
            if (!painter || painter.glProvider() !== this._glProvider) {
                painter = new WebGLBlockPainter(this._glProvider);
                painter.setBackgroundColor(new Color(1, 1, 1, 0.01));
                painter.setBorderColor(new Color(0.5, 0.5, 0.5, 0.1));
                this._painters.set(pg, painter);
            } else {
                painter.clear();
            }

            let numBlocks = 0;
            pg.siblings().forEach(node => {
                paintNodeLines(node, borderThickness, () => {
                ++numBlocks;
                });
                paintNodeBounds(node, () => {
                ++numBlocks;
                });
            });

            painter.initBuffer(numBlocks);

            pg.siblings().forEach(node => {
                paintNodeLines(node, borderThickness/2, (x, y, w, h) => {
                painter.setBackgroundColor(new Color(0.5, 0.5, 0.5, 0.5));
                painter.setBorderColor(borderColor);
                painter.drawBlock(x, y, w, h, 0, 0);
                });
                paintNodeBounds(node, (x, y, w, h) => {
                painter.setBackgroundColor(new Color(0, 0, 1, .1));
                painter.setBorderColor(borderColor);
                const scale = node.layout().groupScale();
                if (nodeHasValue(node) || node.neighbors().hasNode(Direction.INWARD)) {
                    painter.drawBlock(x, y, w, h, borderRoundedness * scale, borderThickness * scale);
                } else {
                    painter.drawBlock(x, y, w, h, w, 2 * borderThickness * scale);
                }
                });
            });
            }
        });
    }

    paint() {
        if (!this._layout || this._layout.startingNode() !== this._widget) {
            this._layout = this.createLayout();
        }
        const start = Date.now();
        while (this._layout.crank()) {
            if (Date.now() - start > 1000/60) {
            this.refresh();
            break;
            }
        }
        /*console.log("Layout phase", layout.layoutPhase);
        if (!layout.crank()) {
            console.log("Layout complete", layout.layoutPhase);
            layout = null;
        } else {
            console.log("Layout timeout", layout.layoutPhase);
        }*/

        this.render();
    };

    render() {
        if (!this._cam.canProject() || !this._glProvider.canProject()) {
            return;
        }
        const worldMatrix = this._cam.project();
        const userCaret = this._userCaret;
        const cam = this._cam;
        const glProvider = this._glProvider;
        const ctx = this._ctx;

        const gl = glProvider.gl();
        glProvider.render();
        gl.viewport(0, 0, cam.width(), cam.height());

        gl.clearColor(0.1, 0.1, 0.1, 1);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.DST_ALPHA);
        gl.clear(gl.COLOR_BUFFER_BIT);

        this._textCanvas.width = cam.width();
        this._textCanvas.height = cam.height();
        ctx.resetTransform();
        ctx.clearRect(0, 0, this._textCanvas.width, this._textCanvas.height);

        ctx.scale(cam.scale(), cam.scale());
        ctx.translate(cam.x(), cam.y());

        let pg = this._widget;
        let needsPaint = false;
        do {
            const painter = this._painters.get(pg);
            if (!painter) {
            console.log("No painter for node", pg.id());
            needsPaint = true;
            continue;
            }

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
            pg.siblings().forEach(node => {
            if (node.layout().needsAbsolutePos()) {
                console.log("Needs absolute pos");
                needsPaint = true;
                return;
            }
            if (!nodeHasValue(node)) {
                return;
            }
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
                } else {
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.translate(node.layout().groupX() - scale * nodeSize[0]/2 + scale * 3/2, node.layout().groupY());
                }
            } else {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.translate(node.layout().groupX(), node.layout().groupY());
            }
            ctx.scale(node.layout().groupScale(), node.layout().groupScale());
            ctx.fillText(node.value(), 0, 0)
            ctx.restore();
            });
            ctx.restore();

            pg = pg.paintGroup().next();
        } while (pg !== this._widget);

        if (userCaret.node()) {
            const layout = userCaret.node().layout();
            /*ctx.fillStyle = 'none';
            ctx.strokeStyle = 'yellow';
            const extentSize = [0, 0];
            layout.extentSize(extentSize);
            ctx.strokeRect(
            layout.absoluteX() - layout.extentOffsetAt(Direction.DOWNWARD),
            layout.absoluteY() - layout.extentOffsetAt(Direction.FORWARD), extentSize[0], extentSize[1]
            );*/
            ctx.lineWidth = borderThickness/2 * layout.absoluteScale();
            ctx.lineJoin = "round";
            ctx.strokeStyle = "orange";
            const bodySize = [0, 0];
            layout.size(bodySize);
            if (nodeHasValue(userCaret.node()) || userCaret.node().neighbors().hasNode(Direction.INWARD)) {
            ctx.strokeRect(
                layout.absoluteX() - layout.absoluteScale() * bodySize[0]/2,
                layout.absoluteY() - layout.absoluteScale() * bodySize[1]/2, layout.absoluteScale() * bodySize[0], layout.absoluteScale() * bodySize[1]
            );
            } else {
            ctx.beginPath();
            ctx.arc(
                layout.absoluteX(),
                layout.absoluteY(),
                bodySize[0]/2 * layout.absoluteScale(),
                0,
                Math.PI * 2
            )
            ctx.stroke();
            }

            ctx.resetTransform();
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(this._userCaret.node()?.value(), 0, 0);
        }

        if (needsPaint) {
            if (attempts > 10) {
            console.log("Failed to fully render after ", attempts, "attempts");
            return;
            }
            attempts++;
            console.log("Needs paint");
            this.refresh();
        } else {
            attempts = 0;
        }
    };

};