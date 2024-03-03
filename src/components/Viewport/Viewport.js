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
import Color from 'parsegraph-color';
import Camera from 'parsegraph-camera';
import Rect from "parsegraph-rect";
import { DEFAULT_NODE_STYLE, USE_LOCAL_STORAGE, SHOW_KEY_STROKES, ENABLE_EXTENT_VIEWING, nodeHasValue, MAX_PAINT_TIME_MS } from "../../settings";
import ViewportRendering from "./ViewportRendering";
import ViewportInput from "./ViewportInput";
import Carousel from "../Carousel";

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

const invalidateAll = (root) => {
    root.paintGroup().forEach(pg => {
        pg.siblings().forEach(node => node.invalidate());
    });
}

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

        this._keyStrokeElem = null;
        this._keyStrokeTime = NaN;

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

        this._nodeStyles = new WeakMap();
        this._defaultNodeStyle = {
            backgroundColor: DEFAULT_NODE_STYLE.backgroundColor.asHex(),
            borderColor: DEFAULT_NODE_STYLE.borderColor.asHex(),
            lineColor: DEFAULT_NODE_STYLE.lineColor.asHex(),
            textColor: DEFAULT_NODE_STYLE.textColor.asHex(),
            backgroundAlpha: DEFAULT_NODE_STYLE.backgroundColor.a(),
            borderAlpha: DEFAULT_NODE_STYLE.borderColor.a(),
            lineAlpha: DEFAULT_NODE_STYLE.lineColor.a(),
            textAlpha: DEFAULT_NODE_STYLE.textColor.a(),
        };

        this._rendering = null;
        this._showEditor = false;
    }

    input() {
        return this._input;
    }

    rendering() {
        return this._rendering;
    }

    refreshKeystrokes() {
        if (!SHOW_KEY_STROKES || !this._keyStrokeElem) {
            return;
        }
        if (Date.now() - this._keyStrokeTime > 1000) {
            this._keyStrokeElem.style.display = 'none';

            this._keyStrokeElem.innerText = '';
        }
    }

    logMessage(...msgParts) {
        const msg = msgParts.join(" ");
        const elem = document.createElement('span');
        elem.style.display = 'inline';
        elem.style.pointerEvents = 'none';
        elem.style.userSelect = 'none';
        elem.innerText = msg;
        const logContainer = this.logContainer();
        while(logContainer.childElementCount > 10) {
            logContainer.firstChild.remove();
        }
        logContainer.appendChild(elem);

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
        const root = this.widget();
        const selectedNode = findNodeById(root, id);
        if (selectedNode) {
            this.caret().moveTo(selectedNode);
            this.refresh();
        }
    }

    save() {
        if (this._saveGraph) {
            this._saveGraph(this.widget(), this.caret().node());
        }
    }

    showInCamera() {
        this._showInCamera = true;
        this.repaint();
    }

    removeNode() {
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
        let idx = order.indexOf(this._extentMode);
        if (idx < 0) {
            idx = 0;
        }
        this._extentMode = order[(idx + 1) % order.length];
        switch(this._extentMode) {
            case "vertical":
                this.logMessage("Showing vertical extents");
                break;
            case "horizontal":
                this.logMessage("Showing horizontal extents");
                break;
            case "none":
                this.logMessage("Hiding all extents");
                break;
            default:
                break;
        }
        this.refresh();
    }

    toggleAlignment() {
        const node = this.node();
        if (node.neighbors().isRoot()) {
            this.togglePreferredAxis();
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
        if (this.node().neighbors().hasNode(dir)) {
            if (pullIfOccupied && !this.node().neighbors().isRoot()) {
                this.pullNode();
            } else {
                this.caret().move(dir);
            }
            this.repaint();
        } else {
            this.caret().spawnMove(dir);
            this.repaint();
            this.save();
        }
    };

    container() {
        return this._container;
    }

    mount(container) {
        if (!container || (this.hasContainer() && this.container() === container)) {
            return;
        }
        this._container = container;

        this._rendering = new ViewportRendering(this);

        if (this.hasWidget()) {
            this._container.appendChild(this.carouselContainer());
            this.carouselRoot().render(<Carousel viewport={this}/>);
            this.attachInput();
        }
    }

    carouselRoot() {
        // Generate if needed.
        this.carouselContainer();

        return this._carouselRoot;
    }

    carouselContainer() {
        if (!this._carouselContainer) {
            this._carouselContainer = document.createElement("div");
            this._carouselContainer.style.position = "absolute";
            this._carouselContainer.style.left = "50%";
            this._carouselContainer.style.top = "50%";
            this._carouselContainer.style.transformOrigin = "center";
            this._carouselRoot = require('react-dom/client').createRoot(this.carouselContainer());
        }
        return this._carouselContainer;
    }

    attachInput() {
        if (this._input) {
            this._input = null;
        }

        this._input = new ViewportInput(this);
    }

    caret() {
        return this._userCaret;
    }

    toJSON() {
        const styles = {};
        this._userCaret.root().paintGroup().forEach(pg => {
            pg.siblings().forEach(node => {
                if (this._nodeStyles.has(node)) {
                    styles[node.id()] = this._nodeStyles.get(node);
                }
            });
        });
        return {
            styles,
            defaultNodeStyle: this.defaultNodeStyle(),
            pageBackgroundColor: this.rendering().pageBackgroundColor().asRGBA(),
            cam: this.camera().toJSON()
        };
    }

    camera() {
        return this._cam;
    }

    load(viewportData) {
        if (!viewportData) {
            return;
        }
        if (viewportData.defaultNodeStyle) {
            this.updateDefaultNodeStyle(viewportData.defaultNodeStyle);
        }
        if (viewportData.styles) {
            this._userCaret.root().paintGroup().forEach(pg => {
                pg.siblings().forEach(node => {
                    if (viewportData.styles[node.id()]) {
                        this.updateNodeStyle(node, viewportData.styles[node.id()]);
                    }
                });
            });
        }
        if (viewportData.cam) {
            this.camera().restore(viewportData.cam);
            this._showInCamera = false;
            this._checkScale = false;
        }
        if (viewportData.pageBackgroundColor) {
            this.rendering().setPageBackgroundColor(Color.fromRGB(viewportData.pageBackgroundColor));
        }
        this.refresh();
    }

    toggleNodeStyling() {
        this._showingStyling = !this._showingStyling;
        if (this._showingStyling) {
            this.carouselContainer().style.display = 'none';
        } else {
            this.carouselContainer().style.display = 'block';
        }
        if (this._toggleNodeStyling !== null) {
            this._toggleNodeStyling(this._showingStyling);
        }
        this.refresh();
    }

    setToggleNodeStyling(toggleNodeStyling) {
        this._toggleNodeStyling = toggleNodeStyling;
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

    refresh() {
        this.scheduleRepaint();
    };

    scheduleRepaint() {
        this.rendering().reset();
        this.scheduleRender();
    }

    scheduleRender() {
        if (this._scheduledRender) {
            return;
        }
        let attempts = 0;
        const loop = () => {
            this._scheduledRender = null;

            console.log(attempts);
            if (this.paint()) {
                if (attempts++ > 1000) {
                    throw new Error("Failed to render after " + attempts + " attempts")
                }
                schedule();
            }
        };
        const schedule = () => {
            this._scheduledRender = requestAnimationFrame(loop);
        };
        schedule();
    }

    cancelScheduledRender() {
        if (!this._scheduledRender) {
            return;
        }
        cancelAnimationFrame(this._scheduledRender);
        this._scheduledRender = null;
    }

    repaint() {
        this._ensureVisible = true;
        this.scheduleRepaint();
    }

    paint() {
        if (!this.canPaint()) {
            console.log("Painting");
            return false;
        }
        const start = Date.now();
        while (this.rendering().crank()) {
            console.log("crank");
            if (Date.now() - start > MAX_PAINT_TIME_MS) {
                this.refresh();
                return true;
            }
        }
        return false;
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
        this.node().invalidate();
        this.logMessage("Preferred axis is now " + 
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
        if (!widget) {
            throw new Error("Refusing to show falsy widget");
        }
        if (this.widget() !== widget) {
            this._userCaret = new DirectionCaret(widget);
            if (this.hasContainer()) {
                this.attachInput();
            }
        }
        if (viewport) {
            this.load(viewport);
        }
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
            this.node().setValue(editor.value === '' ? undefined : editor.value);
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
            this.node().setValue(editor.value === '' ? undefined : editor.value);
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
        if (nodeHasValue(this.node())) {
            this._editor.value = this.node().value();
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

    updateDefaultNodeStyle(newRules) {
        this._defaultNodeStyle = {
            ...this.defaultNodeStyle,
            ...newRules
        };
        invalidateAll(this.widget());
    }

    defaultNodeStyle() {
        return this._defaultNodeStyle;
    }

    getNodeStyle(node) {
        node = node ??  this.node();
        let curStyle = this._nodeStyles.get(node);
        if (curStyle === undefined) {
            return this.defaultNodeStyle();
        }
        return {
            ...this.defaultNodeStyle(),
            ...curStyle
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

        if (newRules.pageBackgroundColor) {
            this.setPageBackgroundColor(Color.fromHex(newRules.pageBackgroundColor));
            delete newRules.pageBackgroundColor;
        }

        if (Object.keys(newRules).length === 0) {
            return;
        }

        this._nodeStyles.set(node, {
            ...(this._nodeStyles.get(node) ?? {}),
            ...newRules
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
        return !this._showingStyling;
    }

    showNodeActions() {
        return this._showEditor;
    }

    checkScale() {
        this._checkScale = true;
    }

    showingEditor() {
        return this._showEditor;
    }
};