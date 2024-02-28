import { 
  Direction,
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
  serializeParsegraph,
  namePreferredAxis,
  nameDirection,
  nameAlignment,
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
import { showNodeInCamera } from "parsegraph-showincamera";
import Rect from "parsegraph-rect";
import { USE_LOCAL_STORAGE } from "./settings";
import { WorldLabels } from "./WorldLabel";

const fontSize = 10;
const lineHeight = fontSize;
const borderThickness = 1;
const lineThickness = 3;
const borderRoundedness = 5;
const maxClickDelay = 1000;
const initialScale = 4;
const moveSpeed = fontSize;
const minVisibleTextScale = 0.2;
const budSize = .75;
const inwardSeparation = lineThickness * 4;

const pageBackgroundColor = new Color(
    .2, .2, .9, 1
)
const caretColor = new Color(.95, .9, 0, 1);

// Node colors
const backgroundColor = new Color(0.5, 1, 0.5, 0.1);
const borderColor = new Color(0, 0, 0, 0.5);
const textColor = new Color(0, 0, 0, 1);
const lineColor = new Color(.9, .9, .9, .8);

let attempts = 0;

const distance = (x1, y1, x2, y2) => {
    return Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));
}

const findNodeById = (root, id) => {
    let foundNode = null;
    root.paintGroup().forEach(pg => {
        pg.siblings().forEach(node => {
            if (node.id() === id) {
                foundNode = node;
            }
        });
    });
    return foundNode;
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
        this._saveGraph = () => {};
        this._container = null;
        this._widget = null;
        this._painters = new WeakMap();
        this._mousePos = [NaN, NaN];

        this._worldLabels = new WorldLabels(minVisibleTextScale);

        this._showInCamera = true;

        // Create and restore the camera if possible
        this._cam = new Camera();
        if (USE_LOCAL_STORAGE) {
            try {
                this._cam.restore(JSON.parse(localStorage.getItem("parsegraph-camera")));
                this._showInCamera = false;
            } catch (ex) {
                console.log(ex);
            }
        }
        this._showEditor = false;
    }

    logMessage(...msgParts) {
        const msg = msgParts.join(" ");
        const elem = document.createElement('span');
        elem.style.display = 'inline';
        elem.style.pointerEvents = 'none';
        elem.style.userSelect = 'none';
        elem.innerText = msg;
        while(this._logContainer.childElementCount > 10) {
            this._logContainer.firstChild.remove();
        }
        this._logContainer.appendChild(elem);

        setTimeout(()=>{
            elem.remove();
        }, 5000);
    }

    logContainer() {
        if (!this._logContainer) {
            this._logContainer = document.createElement("div");
            this._logContainer.style.fontSize = '18px';
            this._logContainer.style.color = 'grey';
            this._logContainer.style.display = 'flex';
            this._logContainer.style.flexDirection = 'column';
        }
        return this._logContainer;
    }

    mountLog(logContainer) {
        logContainer.appendChild(this.logContainer());
    }

    setSaveGraph(saveGraph) {
        this._saveGraph = saveGraph;
    }

    moveToId(id) {
        const root = this._userCaret.root();
        const selectedNode = findNodeById(root, id);
        if (selectedNode) {
            this._userCaret.moveTo(selectedNode);
            this.refresh();
        }
    }

    save() {
        this._saveGraph(this._widget, this._userCaret.node());
    }

    showInCamera() {
        this._showInCamera = true;
        if (this._widget) {
            this.repaint();
        }
    }

    removeNode() {
        if (this._userCaret.node().neighbors().isRoot()) {
            this._userCaret.node().setValue(undefined);
            this.save();
            this.repaint();
            return;
        }
        const node = this._userCaret.node();
        this._userCaret.moveTo(node.neighbors().parentNode());
        node.disconnect();
        this.save();
        this.repaint();
    }

    toggleAlignment() {
        const node = this._userCaret.node();
        if (node.neighbors().isRoot()) {
            node.siblings().setLayoutPreference(
                node.siblings().getLayoutPreference() === PreferredAxis.HORIZONTAL ?
                PreferredAxis.VERTICAL : PreferredAxis.HORIZONTAL
            );
            this.logMessage("Preferred axis is now " + namePreferredAxis(node.siblings().getLayoutPreference()));
            this.save();
            this.repaint();
            return;
        }
        const childDir = reverseDirection(node.neighbors().parentDirection())
        const alignment = node.neighbors().parentNode().neighbors().getAlignment(childDir);
        node.neighbors().parentNode().neighbors().align(
            childDir,
            nextAlignment(alignment, childDir)
        )
        this.logMessage("Alignment is now " + nameAlignment(node.neighbors().parentNode().neighbors().getAlignment(childDir)))
        this.save();
        this.repaint();
    };

    spawnMove(dir, pullIfOccupied) {
        if (this._userCaret.node().neighbors().hasNode(dir)) {
            if (pullIfOccupied && !this._userCaret.node().neighbors().isRoot()) {
                this.pullNode();
            } else {
                this._userCaret.move(dir);
            }
            this.repaint();
        } else {
            this._userCaret.spawnMove(dir);
            this.repaint();
            this.save();
        }
    };

    absoluteSizeRect(node) {
        if (!node) {
            return null;
        }
        const boundsRect = new Rect();
        const layout = node.layout();
        boundsRect.setX(layout.absoluteX());
        boundsRect.setY(layout.absoluteY());
        const absSize = [0,0];
        layout.absoluteSize(absSize);
        boundsRect.setWidth(absSize[0]);
        boundsRect.setHeight(absSize[1]);
        return boundsRect;
    }

    mount(container) {
        if (this._container === container) {
            return;
        }
        this._container = container;
        const canvas = container;
        //container.addEventListener('dragover', e => e.preventDefault());
        //container.addEventListener('drop', drop)

        // Input event callbacks
        let isDown = null;
        let [mouseX, mouseY] = [NaN, NaN];


        const mouseDownPos = [0, 0];

        const size = [0, 0];

        let clickedOnSelected = false;
        canvas.addEventListener('mousedown', e => {
            if (!this._widget) {
                return;
            }
            if (this.carouselContainer().contains(e.target)) {
                return;
            }
            isDown = null;
            [mouseX, mouseY] = [e.clientX, e.clientY];
            this.setMousePos(mouseX, mouseY);
            const [worldX, worldY] = this._cam.transform(mouseX, mouseY);
            mouseDownPos[0] = worldX;
            mouseDownPos[1] = worldY;
            let selectedNode = this._widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
            isDown = Date.now();
            clickedOnSelected = this._userCaret.node() === selectedNode;
            const boundsRect = this.absoluteSizeRect(selectedNode);
            if (selectedNode && (clickedOnSelected || cam.containsAll(boundsRect) || selectedNode.neighbors().hasAncestor(this._userCaret.node()))) {
                if (!clickedOnSelected && cam.containsAll(boundsRect)) {
                    this._userCaret.moveTo(selectedNode);
                    this.refresh();
                }
                this.logMessage("Mouse down on node");
                touchingNode = true;
                this.refresh();
            }
        });
        canvas.addEventListener('mouseup', e => {
            if (!this._widget) {
                return;
            }
            let hadGesture = false;
            if (touchingNode) {
                hadGesture = gesture(mouseX, mouseY);
                if (hadGesture) {
                    this.repaint();
                }
            }

            if (!isNaN(isDown) && Date.now() - isDown < maxClickDelay) {
                const [worldX, worldY] = this._cam.transform(mouseX, mouseY);
                let selectedNode = this._widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
                if (clickedOnSelected && selectedNode === this._userCaret.node()) {
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
            if (!this._widget) {
                return;
            }
            const dx = e.clientX - mouseX;
            const dy = e.clientY - mouseY;
            if (isDown && !touchingNode) {
                this._cam.adjustOrigin(dx / this._cam.scale(), dy / this._cam.scale());
                this.refresh();
            }
            [mouseX, mouseY] = [e.clientX, e.clientY];
            });

            const ongoingTouches = new Map();
            const numActiveTouches = () => {
            let i = 0;
            // eslint-disable-next-line
            for (let _ of ongoingTouches.keys()) {
                ++i;
            }
            return i;
        };

        let touchingNode = false;
        canvas.addEventListener('touchstart', e => {
            if (!this._widget) {
                return;
            }
            if (this.carouselContainer().contains(e.target)) {
                return;
            }
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
                const boundsRect = this.absoluteSizeRect(selectedNode);
                if (selectedNode && cam.containsAll(boundsRect)) {
                    touchingNode = true;
                    clickedOnSelected = this._userCaret.node() === selectedNode;
                    if (!clickedOnSelected) {
                        this._userCaret.moveTo(selectedNode);
                        this.refresh();
                    }
                    isDown = Date.now();
                } else {
                    this.hideEditor();
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
            bodySize[0] *= layout.absoluteScale();
            bodySize[1] *= layout.absoluteScale();

            const dy = Math.abs(worldY - layout.absoluteY());
            const dx = Math.abs(worldX - layout.absoluteX());

            touchingNode = false;

            if (worldX === layout.absoluteX() || dy > dx) {
                if (dist > bodySize[1]/2) {
                    if (worldY > layout.absoluteY()) {
                        this.spawnMove(Direction.DOWNWARD, true);
                    } else {
                        this.spawnMove(Direction.UPWARD, true);
                    }
                    isDown = NaN;
                    return true;
                }
            } else {
                if (dist > bodySize[0]/2) {
                    if (worldX > layout.absoluteX()) {
                        this.spawnMove(Direction.FORWARD, true);
                    } else {
                        this.spawnMove(Direction.BACKWARD, true);
                    }
                    isDown = NaN;
                    return true;
                }
            }
            return false;
        };

        canvas.addEventListener('touchend', e => {
            if (!this._widget) {
                return;
            }
            let [mouseX, mouseY] = [NaN, NaN];
            const isGesture = numActiveTouches() === 1;
            for (let i = 0; i < e.changedTouches.length; ++i) {
                const touch = e.changedTouches[i];
                const touchData = ongoingTouches.get(touch.identifier);
                if (!touchData) {
                    continue;
                }
                mouseX = touchData.mouseX;
                mouseY = touchData.mouseY;
                this.setMousePos(mouseX, mouseY);

                ongoingTouches.delete(touch.identifier);
            }
            if (isNaN(mouseX)) {
                return;
            }
            if (touchingNode && isGesture) {
                if (gesture(mouseX, mouseY)) {
                    this.repaint();
                } else if (!isNaN(isDown) && Date.now() - isDown < maxClickDelay) {
                    const [worldX, worldY] = this._cam.transform(mouseX, mouseY);
                    let selectedNode = this._widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
                    if (clickedOnSelected && selectedNode === this._userCaret.node()) {
                        this.toggleEditor();
                    }
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
                    if (!touchData) {
                        continue;
                    }
                    touchData.mouseX = touch.clientX;
                    touchData.mouseY = touch.clientY;
                }
                const newDistance = distance(first.mouseX, first.mouseY, second.mouseX, second.mouseY);
                cam.zoomToPoint(newDistance / origDistance, ...midPoint(first.mouseX, first.mouseY, second.mouseX, second.mouseY));
                this._checkScale = true;
                this.refresh();
                return;
            }

            for (let i = 0; i < e.changedTouches.length; ++i) {
                const touch = e.changedTouches[i];
                const touchData = ongoingTouches.get(touch.identifier);
                if (!touchData) {
                    continue;
                }
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
                this._checkScale = true;
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

        switch (e.key) {
            case '-':
                if (!isNaN(mouseX)) {
                    this._checkScale = true;
                    cam.zoomToPoint(Math.pow(1.1, -1), mouseX, mouseY);
                    this.refresh();
                }
                break;
            case '+':
            case '=':
                if (!isNaN(mouseX)) {
                    this._checkScale = true;
                    cam.zoomToPoint(Math.pow(1.1, 1), mouseX, mouseY);
                    this.refresh();
                }
                break;
            case 'Escape':
                this.showInCamera();
                break;
            case 'x':
            case 'Backspace':
                this.removeNode();
            break;
            case 'o':
                this.moveOutward();
            break;
            case 'i':
            this.spawnMove(Direction.INWARD);
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
            this.toggleAlignment();
            break;
            case 'j':
            this.spawnMove(Direction.DOWNWARD);
            break;
            case 'k':
            this.spawnMove(Direction.UPWARD);
            break;
            case 'l':
            this.spawnMove(Direction.FORWARD);
            break;
            case 'h':
            this.spawnMove(Direction.BACKWARD);
            break;
            case 'ArrowUp':
                cam.adjustOrigin(0, moveSpeed/cam.scale());
                this.refresh();
                break;
            case 'ArrowDown':
                cam.adjustOrigin(0, -moveSpeed/cam.scale());
                this.refresh();
                break;
            case 'ArrowRight':
                cam.adjustOrigin(-moveSpeed/cam.scale(), 0);
                this.refresh();
                break;
            case 'ArrowLeft':
                cam.adjustOrigin(moveSpeed/cam.scale(), 0);
                this.refresh();
                break;
            case '`':
            case '~':
                this.toggleNodeScale();
                break;
            case 'u':
                this.undo();
                break;
            case 'R':
                this.redo()
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
            cam.setSize(canvas.offsetWidth, canvas.offsetHeight);
            this.refresh();
        }).observe(canvas);


        canvas.style.background = pageBackgroundColor.asRGBA();
        //canvas.style.overflow = 'hidden';

        const textCanvas = document.createElement('canvas');
        textCanvas.style.position = 'fixed';
        textCanvas.style.inset = 0;
        this._textCanvas = textCanvas;

        this._ctx = textCanvas.getContext("2d");

        const glProvider = new BasicGLProvider();
        glProvider.container();
        glProvider.container().style.position = 'fixed';
        glProvider.container().style.inset = 0;
        canvas.appendChild(glProvider.container());
        this._glProvider = glProvider;
        canvas.appendChild(textCanvas);

        canvas.appendChild(this.carouselContainer());


        canvas.addEventListener("focus", () => {
            if (this._showEditor) {
                this.toggleEditor();
            }
        });
    }

    moveOutward() {
            if (this._userCaret.has(Direction.OUTWARD)) {
                this._userCaret.move(Direction.OUTWARD);
                this.refresh();
            } else if (!this._userCaret.node().neighbors().isRoot()) {
                this._userCaret.move(this._userCaret.node().neighbors().parentDirection());
                this.refresh();
            }
        }

    mountEditor(editorContainer) {
        this.createEditor();
        editorContainer.appendChild(this._editorContainer);
    }

    undo() {
        if (this._undo) {
            this._undo();
        }
    }

    redo() {
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

    repaint() {
        requestAnimationFrame(() => {
            this._layout = this.createLayout();
            this._worldLabels = new WorldLabels(minVisibleTextScale);
            this._ensureVisible = true;
            this.paint();
        });
    }

    node() {
        return this._userCaret.node();
    }

    layout() {
        return this._userCaret.node().layout();
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
            this._userCaret.node().neighbors().parentNode().siblings().pull(reverseDirection(dir));
        }
        this.save();
        this.repaint();
    }

    toggleNodeFit() {
        if (this.node().nodeFit() === Fit.EXACT) {
            this.node().setNodeFit(Fit.LOOSE);
            this.logMessage("Fit is now LOOSE")
        } else {
            this.node().setNodeFit(Fit.EXACT);
            this.logMessage("Fit is now EXACT")
        }
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
            switch(curAxis) {
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

        this.node().siblings().setLayoutPreference(nextAxis(
            this.node().siblings().getLayoutPreference()
        ));
        this.logMessage("Preferred axis is now " + 
            namePreferredAxis(this.node().siblings().getLayoutPreference())
        );

        this.repaint();
        this.save();
    }

    refresh() {
        requestAnimationFrame(() => {
            this.paint();
        });
    };

    show(widget) {
        if (!widget) {
            throw new Error("Refusing to show falsy widget");
        }
        if (this._widget === widget) {
            this.repaint();
            return;
        }
        this._widget = widget;
        this._userCaret = new DirectionCaret(widget);
        this.repaint();
    }

    createEditor() {
        const editorContainer = document.createElement('div');
        editorContainer.style.display = 'none';
        editorContainer.style.flexGrow = '1';

        this._editorContainer = editorContainer;

        const editor = this.createEditorComp();

        editorContainer.appendChild(editor);
        this._editor = editor;

        const buttons = document.createElement('div');
        buttons.className = 'buttons';
        editorContainer.appendChild(buttons);

        const saveBtn = document.createElement("button");

        const save = () => {
            this._userCaret.node().setValue(editor.value === '' ? undefined : editor.value);
            this.toggleEditor();
            this.repaint();
            this.save();
        };
        saveBtn.addEventListener('click', save);
        saveBtn.addEventListener('touchend', save);
        saveBtn.innerHTML = "Save";
        buttons.appendChild(saveBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.addEventListener('click', () => this.toggleEditor());
        cancelBtn.addEventListener('touchend', () => this.toggleEditor());
        cancelBtn.innerHTML = "Cancel";
        buttons.appendChild(cancelBtn);

        return editorContainer;
    }

    setToggleNodeActions(cb) {
        this._toggleNodeActions = cb;
    }

    createEditorComp() {
        const editor = document.createElement('textarea');
        editor.style.width = '100%';
        editor.style.boxSizing = 'border-box';
        editor.addEventListener('keypress', e => {
        if (e.key === 'Escape') {
            this.toggleEditor();
            this._container.focus();
        } else if (e.key === 'Enter') {
            if (e.shiftKey) {
                return;
            }
            this._userCaret.node().setValue(editor.value === '' ? undefined : editor.value);
            this.toggleEditor();
            this._container.focus();
            this.repaint();
            this.save();
        }
        })
        return editor;
    }

    hideEditor() {
        if (!this._showEditor) {
            return;
        }
        if (this._toggleNodeActions) {
            this._toggleNodeActions();
        }
        this._showEditor = false;
        this._editorContainer.style.display = 'none';
        this.refresh();
    }

    showEditor() {
        if (this._showEditor) {
            return;
        }
        if (this._toggleNodeActions) {
            this._toggleNodeActions();
        }
        this._showEditor = true;
        this._editorContainer.style.display = 'block';
        this._editor.focus();
        if (nodeHasValue(this._userCaret.node())) {
            this._editor.value = this._userCaret.node().value();
        } else {
            this._editor.value = '';
        }
        this.refresh();
    }

    toggleEditor() {
        if (this._showEditor) {
            this.hideEditor();
        } else {
            this.showEditor();
        }
    }

    createLayout() {
        return new CommitLayout(this._widget, {
            size: (node, size) => {
            size[0] = fontSize;
            if (nodeHasValue(node)) {
                size[1] = 0;
                node.value().toString().split('\n').forEach(line => {
                    size[1] += lineHeight;
                    this._ctx.resetTransform();
                    this._ctx.font = `${fontSize}px sans-serif`;
                    const { width } = this._ctx.measureText(line);
                    size[0] = Math.max(size[0], width + 6*borderThickness);
                });
                size[1] = Math.max(size[1], lineHeight);
                size[1] += lineHeight/2;
            } else {
                size[0] = fontSize * budSize;
                size[1] = fontSize * budSize;
            }

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
                    size[0] += lineHeight/8;
                    size[1] += (inwardSeparation/2 + childSize[1]) * child.scale();
                } else {
                    if (!nodeHasValue(node)) {
                        size[0] = borderThickness;
                        size[1] = borderThickness;
                    }
                    // Default is horizontal
                    size[0] += (inwardSeparation/2 + childSize[0]) * child.scale();
                    size[1] = Math.max(size[1], borderThickness + child.scale() * childSize[1]);
                    size[1] += lineHeight/4;
                }
            }
            },
            getSeparation: (node, axis) => {
                if (axis === Axis.Z) {
                    return inwardSeparation/2;
                }
                return fontSize/2;
            },
            paint: (pg) => {
            let painter = this._painters.get(pg);
            if (!painter || painter.glProvider() !== this._glProvider) {
                painter = new WebGLBlockPainter(this._glProvider);
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
                paintNodeLines(node, lineThickness/2, (x, y, w, h) => {
                    painter.setBorderColor(new Color(0, 0, 0, 0));
                    painter.setBackgroundColor(lineColor);
                    painter.drawBlock(x, y, w, h, 0, 0);
                });
                paintNodeBounds(node, (x, y, w, h) => {
                    painter.setBackgroundColor(backgroundColor);
                    painter.setBorderColor(borderColor);
                    const scale = node.layout().groupScale();
                    if (nodeHasValue(node) || node.neighbors().hasNode(Direction.INWARD)) {
                        painter.drawBlock(x, y, w, h, borderRoundedness * scale, borderThickness * scale);
                    } else {
                        painter.drawBlock(x, y, w, h, w, borderThickness * scale);
                    }
                    });
                });
                }
            });
        }

        canPaint() {
            return this._container && this._widget;
        }

        paint() {
            if (!this.canPaint()) {
                return;
            }
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
            if (USE_LOCAL_STORAGE) {
                localStorage.setItem("parsegraph-camera", JSON.stringify(this._cam.toJSON()));
                localStorage.setItem("parsegraph-graph", JSON.stringify(serializeParsegraph(this._widget)));
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
            if (!this.canPaint()) {
                return;
            }
            if (!this._cam.canProject() || !this._glProvider.canProject()) {
                return;
            }
            const cam = this._cam;
            if (this._showInCamera) {
                const scale = initialScale/this._userCaret.node().layout().absoluteScale();
                if (!isNaN(scale) && isFinite(scale)) {
                    cam.setScale(initialScale/this._userCaret.node().layout().absoluteScale());
                    showNodeInCamera(this._userCaret.node(), cam);
                    this._showInCamera = false;
                }
                this.refresh();
                return;
            }

            const graphSize = [NaN, NaN];
            const layout = this._userCaret.node().layout();
            this._widget.layout().extentSize(graphSize);
            if (graphSize[0] > 0 && graphSize[1] > 0) {
                const scaleFactor = 4;
                if (this._checkScale && (Math.max(...graphSize) * cam.scale() < Math.min(cam.height(), cam.width())/(scaleFactor))) {
                    const scale = (Math.min(cam.height(), cam.width())/scaleFactor) / (cam.scale() * Math.max(...graphSize));
                    if (!isNaN(scale)) {
                        cam.zoomToPoint(
                            scale,
                            cam.width()/2,
                            cam.height()/2
                        );
                        this._checkScale = false;
                    }
                    this.refresh();
                    return;
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
                showNodeInCamera(this._userCaret.node(), cam);
                this.refresh();
                return;
            }
            this._ensureVisible = false;

            const worldMatrix = this._cam.project();
            const userCaret = this._userCaret;
            const glProvider = this._glProvider;
            const ctx = this._ctx;


        const gl = glProvider.gl();
        glProvider.render();
        gl.viewport(0, 0, cam.width(), cam.height());

        gl.clearColor(pageBackgroundColor.r(),
            pageBackgroundColor.g(),
            pageBackgroundColor.b(),
            pageBackgroundColor.a()
        );
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
                needsPaint = true;
                return;
            }
            if (!nodeHasValue(node)) {
                return;
            }
            ctx.fillStyle = borderColor.asRGBA();
            ctx.save();
            const lines = node.value().toString().split('\n');
            if (node.neighbors().hasNode(Direction.INWARD)) {
                const nodeSize = [0, 0]
                node.layout().size(nodeSize);
                const scale = node.layout().groupScale();
                if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.translate(node.layout().groupX(), node.layout().groupY() - scale * nodeSize[1]/2 + scale * 3);
                    if (lines.length > 1) {
                        ctx.translate(0, node.layout().groupScale() * (-(lines.length - 1) * lineHeight / 2 + lineHeight/2));
                    }
                } else {
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.translate(node.layout().groupX() - scale * nodeSize[0]/2 + 3*borderThickness, node.layout().groupY());
                    if (lines.length > 1) {
                        ctx.translate(0, -(lines.length - 1) * (node.layout().groupScale() * lineHeight) / 2);
                    }
                }
            } else {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.translate(node.layout().groupX(), node.layout().groupY());
                if (lines.length > 1) {
                    ctx.translate(0, -(lines.length - 1) * (node.layout().groupScale() * lineHeight) / 2);
                }
            }
                this._ctx.font = `${fontSize}px sans-serif`;
                ctx.scale(node.layout().groupScale(), node.layout().groupScale());
                ctx.fillStyle = textColor.asRGBA();
                lines.forEach(line => {
                    ctx.fillText(line, 0, 0)
                    ctx.translate(0, lineHeight);
                });
            this._worldLabels.draw(lines[0], node.layout().absoluteX(), node.layout().absoluteY(), 1.5*fontSize,
                cam.scale()/node.layout().absoluteScale(), new Color(1, 1, 1, 1), new Color(0, 0, 0, 1));
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
            ctx.strokeStyle = caretColor.asRGBA();
            const bodySize = [0, 0];
            layout.size(bodySize);
            if (nodeHasValue(userCaret.node()) || userCaret.node().neighbors().hasNode(Direction.INWARD)) {
                ctx.beginPath();
                ctx.roundRect(
                    layout.absoluteX() - layout.absoluteScale() * bodySize[0]/2 + borderThickness/4 * layout.absoluteScale(),
                    layout.absoluteY() - layout.absoluteScale() * bodySize[1]/2 + borderThickness/4 * layout.absoluteScale(),
                    layout.absoluteScale() * bodySize[0] - borderThickness/2 * layout.absoluteScale(),
                    layout.absoluteScale() * bodySize[1] - borderThickness/2 * layout.absoluteScale(),
                    borderRoundedness * layout.absoluteScale() /2.13
                );
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(
                    layout.absoluteX(),
                    layout.absoluteY(),
                    bodySize[0]/2 * layout.absoluteScale() - borderThickness/4 * layout.absoluteScale(),
                    0,
                    Math.PI * 2
                )
                ctx.stroke();
            }

            ctx.resetTransform();
            //ctx.textAlign = 'left';
            //ctx.textBaseline = 'top';
            //ctx.fillText(this._userCaret.node()?.value(), 0, 0);
    
            if (this.showNodeActions()) {
                this.carouselContainer().style.display = 'block';
                this.carouselContainer().style.transform = `scale(${cam.scale()}) translate(${layout.absoluteX() + cam.x()}px, ${layout.absoluteY() + cam.y()}px) scale(${1/cam.scale()}) translate(-${cam.width()/2}px, -${cam.height()/2}px) translate(-50%, -50%)`;

                this.carouselAnchor().style.width = `${bodySize[0] * layout.absoluteScale() * cam.scale()}px`;
                this.carouselAnchor().style.height = `${bodySize[1] * layout.absoluteScale() * cam.scale()}px`;
            } else {
                this.carouselContainer().style.display = 'none';
            }
        }

        if (needsPaint) {
            if (attempts > 1000) {
                console.log("Failed to fully render after ", attempts, "attempts");
                return;
            }
            attempts++;
            //console.log("Needs paint");
            this.refresh();
        } else {
            attempts = 0;
            ctx.scale(cam.scale(), cam.scale());
            ctx.translate(cam.x(), cam.y());
            this._worldLabels.render(
                ctx, 
                cam.x(),
                cam.y(),
                cam.width(),
                cam.height(),
                cam.scale()
            )
        }
    };

    showNodeActions() {
        return this._showEditor;
    }

    carouselAnchor() {
        if (!this._carouselAnchor) {
            this._carouselAnchor = document.createElement('div');
            this._carouselAnchor.style.position = 'relative';
            this._carouselAnchor.style.pointerEvents = 'none';
            this.carouselContainer().appendChild(this._carouselAnchor);
        }
        return this._carouselAnchor;
    }

    carouselContainer() {
        if (!this._carouselContainer) {
            this._carouselContainer = document.createElement("div");
            this._carouselContainer.style.position = "absolute";
            this._carouselContainer.style.left = "50%";
            this._carouselContainer.style.top = "50%";
            this._carouselContainer.style.transformOrigin = "center";
        }
        return this._carouselContainer;
    }

    setMousePos(mouseX, mouseY) {
        this._mousePos[0] = mouseX;
        this._mousePos[1] = mouseY;
    }
};