import {
  Axis,
  PreferredAxis,
  deserializeParsegraphDocument,
  getDirectionAxis,
  serializeParsegraphDocument,
  serializeParsegraph,
} from "parsegraph";
import Color from "parsegraph-color";
import { DEFAULT_NODE_STYLE, PAGE_BACKGROUND_COLOR } from "./settings";

// Keep state on the graph so live reload cannot detach its capabilities.
// Symbols are ignored by the graph serializers and do not enter document JSON.
const DOCUMENT_STATE = Symbol.for("parsegraph.freeform.document");
export const CURRENT_DOCUMENT_VERSION = 2;
export const documentState = (root) => root?.[DOCUMENT_STATE];
const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (object, key) =>
  Object.prototype.hasOwnProperty.call(object ?? {}, key);

// Attach native document state without serializing and rebuilding. New nodes
// retain their inherited direction; only legacy imports acquire an LTR root.
export function initializeGraphDocument(root) {
  Object.defineProperty(root, DOCUMENT_STATE, {
    value: {
      version: CURRENT_DOCUMENT_VERSION,
      sourceVersion: CURRENT_DOCUMENT_VERSION,
      root,
      capabilities: {},
      ignoredCapabilities: [],
      hasUnsupportedContent: graphNodes(root).some(
        (node) =>
          node.value() !== undefined &&
          typeof node.value() !== "string" &&
          typeof node.value() !== "number"
      ),
    },
    configurable: true,
  });
  return root;
}

// Parsegraph stores a detached node's preference as an absolute axis and keeps
// it when the node is connected. Both forms lay out identically; the document
// reader stores the parent-relative form, so normalized graphs do too. Inward
// children keep absolute preferences, as the reader also leaves them.
function hasAbsolutePreference(node) {
  if (node.neighbors().isRoot()) return false;
  const preference = node.siblings().getLayoutPreference();
  return (
    (preference === PreferredAxis.HORIZONTAL ||
      preference === PreferredAxis.VERTICAL) &&
    getDirectionAxis(node.neighbors().parentDirection()) !== Axis.Z
  );
}

/**
 * Finish a graph that was built in memory so it matches what readGraph would
 * produce for its saved document: attached document state and parent-relative
 * layout preferences. Existing document state is kept. IDs are left alone:
 * Parsegraph gives every node a unique string ID, and producers that replace
 * them use unique strings; isNormalizedGraph rejects anything else.
 */
export function normalizeGraph(root) {
  graphNodes(root).forEach((node) => {
    if (hasAbsolutePreference(node))
      node.siblings().setLayoutPreference(node.siblings().getLayoutPreference());
  });
  return documentState(root) ? root : initializeGraphDocument(root);
}

/** Whether a graph can be displayed without a serialization round trip. */
export function isNormalizedGraph(root) {
  if (documentState(root)?.version !== CURRENT_DOCUMENT_VERSION) return false;
  const ids = new Set();
  return graphNodes(root).every((node) => {
    const id = node.id();
    if (typeof id !== "string" || !id || ids.has(id)) return false;
    ids.add(id);
    return !hasAbsolutePreference(node);
  });
}

/**
 * Return a graph that is safe to display and edit as the open document. A
 * normalized graph is used as-is; anything else is rebuilt from its saved form,
 * so a producer that skips normalizeGraph still opens exactly as before.
 */
export function adoptGraph(root, selectedNode) {
  return isNormalizedGraph(root) ? root : readGraph(writeGraph(root, selectedNode));
}

// A v0 document keeps its styles in its viewport. Convert them to appearance/1
// once, on read, exactly as its first native save did, so the graph saves like
// any native document afterwards. sourceVersion still records the v0 source.
function migrateLegacyAppearance(loaded, viewport) {
  if (!viewport?.defaultNodeStyle && !viewport?.styles && !viewport?.pageBackgroundColor)
    return;
  const ids = new Set(graphNodes(loaded.root).map((node) => String(node.id())));
  const appearance = appearanceFromViewport(viewport);
  appearance.nodeStyles = Object.fromEntries(
    Object.entries(appearance.nodeStyles).filter(([id]) => ids.has(id))
  );
  loaded.capabilities = { ...loaded.capabilities, "appearance/1": appearance };
  loaded.appearance = appearance;
}

export function readGraph(data) {
  const loaded = deserializeParsegraphDocument(data);
  loaded.sourceVersion = loaded.version;
  loaded.version = CURRENT_DOCUMENT_VERSION;
  const formats = loaded.metadata?.freeform;
  if (own(formats, "structuredJson") && own(formats, "structuredLisp"))
    throw new Error(
      "A structured document must declare one language, not both JSON and Lisp/Scheme."
    );
  loaded.hasUnsupportedContent = graphNodes(loaded.root).some(
    (node) =>
      node.value() !== undefined &&
      typeof node.value() !== "string" &&
      typeof node.value() !== "number"
  );
  if (loaded.sourceVersion === 0) migrateLegacyAppearance(loaded, data?.viewport);
  Object.defineProperty(loaded.root, DOCUMENT_STATE, {
    value: loaded,
    configurable: true,
  });
  return loaded.root;
}

export function graphViewport(data) {
  if (data?.format !== "parsegraph") return data?.viewport;
  const viewport = data.metadata?.freeform?.viewport;
  if (!viewport || typeof viewport !== "object") return undefined;
  const camera = viewport.cam;
  return {
    ...(camera &&
    [camera.cameraX, camera.cameraY, camera.scale].every(Number.isFinite) &&
    camera.scale > 0
      ? {
          cam: {
            cameraX: camera.cameraX,
            cameraY: camera.cameraY,
            scale: camera.scale,
          },
        }
      : {}),
    ...(typeof viewport.showingUI === "boolean"
      ? { showingUI: viewport.showingUI }
      : {}),
  };
}

export function graphSelection(data) {
  if (data?.format !== "parsegraph") return data?.selectedNode;
  const selected = data.metadata?.freeform?.selectedNode;
  return typeof selected === "string" || selected === null
    ? selected
    : undefined;
}

export function graphNodes(root) {
  const nodes = [];
  root
    .paintGroup()
    .forEach((pg) => pg.siblings().forEach((node) => nodes.push(node)));
  return nodes;
}

export function ensureStringIds(root) {
  const nodes = graphNodes(root);
  const reserved = new Set(
    nodes.map((node) => node.id()).filter((id) => typeof id === "string")
  );
  const used = new Set();
  let nextId = 0;
  nodes.forEach((node) => {
    const original = node.id();
    let id = original === undefined ? "" : String(original);
    if (
      !id ||
      used.has(id) ||
      (typeof original !== "string" && reserved.has(id))
    ) {
      do {
        id = `freeform-${++nextId}`;
      } while (used.has(id) || reserved.has(id));
    }
    used.add(id);
    node.setId(id);
  });
  return used;
}

export function appearanceFromViewport(viewport) {
  const pageColor = viewport.pageBackgroundColor;
  const page = pageColor
    ? pageColor.startsWith("#")
      ? Color.fromHex(pageColor)
      : Color.fromRGB(pageColor)
    : PAGE_BACKGROUND_COLOR;
  // Legacy files and generated color examples may supply only sparse styles.
  // Their first history snapshot precedes viewport.show(), so fill the same
  // defaults that the viewport would have applied before writing native data.
  const defaults = Object.fromEntries(
    COLOR_FIELDS.flatMap((name) => [
      [name, DEFAULT_NODE_STYLE[name].asHex()],
      [name.replace("Color", "Alpha"), DEFAULT_NODE_STYLE[name].a()],
    ])
  );
  return {
    defaults: appearanceFields({ ...defaults, ...viewport.defaultNodeStyle }),
    nodeStyles: Object.fromEntries(
      Object.entries(viewport.styles ?? {}).map(([id, style]) => [
        id,
        appearanceFields(style),
      ])
    ),
    pageBackgroundColor: page.asHex(),
    pageBackgroundAlpha: page.a(),
  };
}

const COLOR_FIELDS = [
  "backgroundColor",
  "borderColor",
  "textColor",
  "lineColor",
];
function appearanceFields(style) {
  return Object.fromEntries(
    Object.entries(style)
      .filter(
        ([key]) =>
          COLOR_FIELDS.includes(key) ||
          COLOR_FIELDS.some((name) => key === name.replace("Color", "Alpha"))
      )
      .map(([key, value]) => [
        key,
        key.endsWith("Alpha") ? Number(value) : value,
      ])
  );
}

export function writeGraph(
  root,
  selectedNode,
  viewport,
  version = CURRENT_DOCUMENT_VERSION
) {
  const state = documentState(root);
  const selection =
    selectedNode && typeof selectedNode === "object"
      ? selectedNode.id()
      : selectedNode;
  if (version === 0) {
    if (
      state?.metadata?.freeform?.structuredJson !== undefined ||
      state?.metadata?.freeform?.structuredLisp !== undefined
    ) {
      throw new Error(
        "Structured drafts require the native Parsegraph format to preserve slots and node types."
      );
    }
    return {
      ...serializeParsegraph(root),
      ...(selection !== undefined ? { selectedNode: selection } : {}),
      ...(viewport !== undefined ? { viewport } : {}),
    };
  }
  // Older callers requested v1 explicitly. The library's native writer now
  // migrates those saves to v2; only the explicit v0 branch is a legacy export.
  if (version !== 1 && version !== CURRENT_DOCUMENT_VERSION)
    throw new Error(`Unsupported Parsegraph export version: ${version}`);
  const ids = ensureStringIds(root);
  const capabilities = clone(state?.capabilities ?? {});
  // Graphs without document state predate native appearance; readGraph has
  // already migrated v0 documents' viewport styles.
  const legacyAppearance = !state;
  if (
    (viewport?.defaultNodeStyle &&
      viewport?.pageBackgroundColor &&
      (state?.appearance || legacyAppearance || viewport.appearanceChanged)) ||
    (legacyAppearance &&
      (viewport?.defaultNodeStyle ||
        viewport?.styles ||
        viewport?.pageBackgroundColor))
  ) {
    capabilities["appearance/1"] = appearanceFromViewport(viewport);
  }
  // Only supported, understood references can be repaired after deletion.
  for (const name of ["presentation/1", "appearance/1"]) {
    const capability = capabilities[name];
    if (capability) {
      capability.nodeStyles = Object.fromEntries(
        Object.entries(capability.nodeStyles).filter(([id]) => ids.has(id))
      );
    }
  }
  const metadata = clone(state?.metadata ?? {});
  const previous = metadata.freeform;
  const freeform =
    previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous
      : {};
  const camera = viewport?.cam;
  const cameraState =
    camera &&
    [camera.cameraX, camera.cameraY, camera.scale].every(Number.isFinite) &&
    camera.scale > 0
      ? {
          cameraX: camera.cameraX,
          cameraY: camera.cameraY,
          scale: camera.scale,
        }
      : null;
  if (selection !== undefined || viewport)
    metadata.freeform = {
      ...freeform,
      ...(selection !== undefined
        ? { selectedNode: selection === null ? null : String(selection) }
        : {}),
      ...(viewport
        ? {
            viewport: {
              ...freeform.viewport,
              ...(cameraState ? { cam: cameraState } : {}),
              ...(typeof viewport.showingUI === "boolean"
                ? { showingUI: viewport.showingUI }
                : {}),
            },
          }
        : {}),
    };
  return serializeParsegraphDocument(root, {
    capabilities,
    ...(state?.metadata !== undefined || Object.keys(metadata).length
      ? { metadata }
      : {}),
  });
}

export function presentationStyle(presentation, node) {
  const name = own(presentation.nodeStyles, String(node.id()))
    ? presentation.nodeStyles[String(node.id())]
    : presentation.defaultStyle;
  return presentation.styles[name];
}

// Structured JSON is retained without inventing a standard text interpretation.
export function nodeLabel(node, presentation) {
  const value = node.value();
  if (presentation) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    return (typeof value === "number" ? JSON.stringify(value) : value).replace(
      /\r\n?/g,
      "\n"
    );
  }
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}
