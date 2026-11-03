import {
  deserializeParsegraphDocument,
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
  const legacyAppearance = !state || state.sourceVersion === 0;
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
