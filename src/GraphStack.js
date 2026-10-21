import {
  readGraph,
  writeGraph,
  graphViewport,
  graphSelection,
} from "./graphDocument";
import { USE_LOCAL_STORAGE } from "./settings";

const loadGraph = () => {
  if (!USE_LOCAL_STORAGE) {
    return null;
  }
  try {
    return JSON.parse(localStorage.getItem("parsegraph-graph"));
  } catch (ex) {
    console.log(ex);
    return null;
  }
};

export default class GraphStack {
  constructor() {
    const loaded = loadGraph();
    if (loaded) {
      this._actions = [loaded];
    } else {
      this._actions = [];
    }
    this._actionIndex = this._actions.length - 1;
  }

  undoCount() {
    return this._actionIndex;
  }

  redoCount() {
    return this._actions.length - (this._actionIndex + 1);
  }

  hasWidget() {
    return this._actionIndex >= 0 && this._actionIndex < this._actions.length;
  }

  widget() {
    if (this.hasWidget()) {
      return readGraph(this._actions[this._actionIndex]);
    }
    return null;
  }

  viewportData() {
    if (this.hasWidget()) {
      return graphViewport(this._actions[this._actionIndex]);
    }
    return null;
  }

  selectedNode() {
    if (this.hasWidget()) {
      return graphSelection(this._actions[this._actionIndex]);
    }
    return null;
  }

  replace(...saveArgs) {
    this.save(...saveArgs);
    if (this._actionIndex < 1) {
      return;
    }
    this._actions[this._actionIndex - 1] = this._actions[this._actionIndex];
    this._actions.splice(this._actionIndex, 1);
    this._actionIndex--;
  }

  save(newGraph, selectedNode, viewport) {
    const newGraphData = writeGraph(
      newGraph,
      selectedNode,
      viewport?.toJSON ? viewport.toJSON() : viewport
    );
    if (
      this.hasWidget() &&
      JSON.stringify(this._actions[this._actionIndex]) ===
        JSON.stringify(newGraphData)
    ) {
      return;
    }
    if (this._actionIndex < this._actions.length - 1) {
      this._actions.splice(this._actionIndex + 1);
    }
    this._actions.push(newGraphData);
    this._actionIndex = this._actions.length - 1;
  }

  undo() {
    if (this._actionIndex > 0) {
      --this._actionIndex;
    }
  }

  redo() {
    if (this._actionIndex < this._actions.length - 1) {
      ++this._actionIndex;
    }
  }

  clear() {
    this._actions = [];
    this._actionIndex = -1;
  }
}
