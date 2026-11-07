import {
  isNormalizedGraph,
  readGraph,
  writeGraph,
  graphViewport,
  graphSelection,
} from "./graphDocument";
import { USE_LOCAL_STORAGE } from "./settings";
import { Direction, PreferredAxis } from "parsegraph";

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

const snapshot = (root, selectedNode, viewport) => writeGraph(
  root,
  selectedNode,
  viewport?.toJSON ? viewport.toJSON() : viewport
);

const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;

function comparableNode(node) {
  const preference = node.layoutPreference;
  const horizontalParent = ["forward", "backward", Direction.FORWARD, Direction.BACKWARD].includes(node.parentDir);
  // Reloading canonicalizes an absolute axis to its equivalent parent-relative
  // preference. That representation change is not an edit to the document.
  const horizontal = ["horizontal", PreferredAxis.HORIZONTAL].includes(preference) ||
    (["parent", PreferredAxis.PARENT].includes(preference) && horizontalParent) ||
    (["perpendicular", PreferredAxis.PERPENDICULAR].includes(preference) && !horizontalParent);
  return { ...node,
    parentId: node.parentId === null ? null : String(node.parentId),
    layoutPreference: horizontal ? "horizontal" : "vertical",
  };
}

// Navigation is restored with a snapshot, but does not itself create a grouped
// edit. Native styles/capabilities and all other document metadata still count.
function contentKey(snapshot) {
  const data = { ...snapshot };
  if (data.format === "parsegraph") {
    // Group traversal follows the current preferred axis, so record order is
    // not document content. IDs and parent connections describe the topology.
    data.nodes = data.nodes.map(comparableNode).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    if (record(data.metadata)) {
      data.metadata = { ...data.metadata };
      if (record(data.metadata.freeform)) {
        const freeform = { ...data.metadata.freeform };
        delete freeform.selectedNode;
        if (record(freeform.viewport)) {
          freeform.viewport = { ...freeform.viewport };
          delete freeform.viewport.cam;
          delete freeform.viewport.showingUI;
          delete freeform.viewport.appearanceChanged;
          if (!Object.keys(freeform.viewport).length) delete freeform.viewport;
        }
        if (Object.keys(freeform).length) data.metadata.freeform = freeform;
        else delete data.metadata.freeform;
      }
      if (!Object.keys(data.metadata).length) delete data.metadata;
    }
  } else {
    if (record(data.__parsegraph)) data.__parsegraph = Object.fromEntries(
      Object.entries(data.__parsegraph).map(([id, node]) => [id, comparableNode(node)])
    );
    delete data.selectedNode;
    if (record(data.viewport)) {
      data.viewport = { ...data.viewport };
      // Legacy viewport snapshots also carry persistent visual styles.
      delete data.viewport.cam;
      delete data.viewport.showingUI;
      delete data.viewport.appearanceChanged;
      if (!Object.keys(data.viewport).length) delete data.viewport;
    } else delete data.viewport;
  }
  return JSON.stringify(canonical(data));
}

export default class GraphStack {
  constructor() {
    const loaded = loadGraph();
    this._live = null;
    if (loaded) {
      const root = readGraph(loaded);
      this._actions = [writeGraph(root, graphSelection(loaded), graphViewport(loaded))];
      // Writing the snapshot assigned any missing IDs, so a normalized root
      // now matches it and can be displayed without deserializing again.
      if (isNormalizedGraph(root)) this._live = root;
    } else {
      this._actions = [];
    }
    this._actionIndex = this._actions.length - 1;
    this._group = null;
  }

  /**
   * The graph to display for the current entry: the one already built for it
   * when history has not moved since, otherwise a fresh copy. Handed out once.
   */
  liveWidget() {
    const live = this._live;
    this._live = null;
    return live ?? this.widget();
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
    this.endGroup();
    const previousIndex = this._actionIndex;
    this.save(...saveArgs);
    if (this._actionIndex < 1 || this._actionIndex === previousIndex) {
      return;
    }
    this._actions[this._actionIndex - 1] = this._actions[this._actionIndex];
    this._actions.splice(this._actionIndex, 1);
    this._actionIndex--;
  }

  save(newGraph, selectedNode, viewport) {
    this._live = null;
    const newGraphData = snapshot(newGraph, selectedNode, viewport);
    if (this._group) {
      const group = this._group;
      const changed = contentKey(newGraphData) !== group.content;
      if (changed) {
        if (!group.changed) this._actions = group.actions.slice(0, group.index + 1);
        this._actions[group.index + 1] = newGraphData;
        this._actionIndex = group.index + 1;
      } else {
        if (group.changed) this._actions = group.actions.slice();
        this._actions[group.index] = newGraphData;
        this._actionIndex = group.index;
      }
      group.changed = changed;
      return;
    }
    this._saveSnapshot(newGraphData);
  }

  _saveSnapshot(newGraphData) {
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

  /** Start one reversible edit while retaining a redo branch until it changes. */
  beginGroup(newGraph, selectedNode, viewport) {
    this._live = null;
    this.endGroup();
    const baseline = snapshot(newGraph, selectedNode, viewport);
    const content = contentKey(baseline);
    if (!this.hasWidget() || contentKey(this._actions[this._actionIndex]) !== content) {
      this._saveSnapshot(baseline);
    } else this._actions[this._actionIndex] = baseline;
    this._group = {
      actions: this._actions.slice(),
      index: this._actionIndex,
      content,
      changed: false,
    };
    // readGraph can expose metadata objects from the current snapshot. Keep the
    // protected undo baseline independent of edits to that current graph.
    this._actions[this._actionIndex] = JSON.parse(JSON.stringify(baseline));
  }

  /** Undefined means inactive; otherwise report whether the group changed content. */
  endGroup() {
    if (!this._group) return undefined;
    const changed = this._group.changed;
    this._group = null;
    return changed;
  }

  undo() {
    this._live = null;
    this.endGroup();
    if (this._actionIndex > 0) {
      --this._actionIndex;
    }
  }

  redo() {
    this._live = null;
    this.endGroup();
    if (this._actionIndex < this._actions.length - 1) {
      ++this._actionIndex;
    }
  }

  clear() {
    this._live = null;
    this.endGroup();
    this._actions = [];
    this._actionIndex = -1;
  }
}
