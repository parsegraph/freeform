import fs from "fs";
import path from "path";
import { Direction, DirectionNode, PreferredAxis } from "parsegraph";
import { loadExample } from "./examples";
import {
  adoptGraph,
  documentState,
  graphNodes,
  graphSelection,
  graphViewport,
  isNormalizedGraph,
  normalizeGraph,
  readGraph,
  writeGraph,
} from "./graphDocument";
import * as importers from "./importers";
import { createJsonDraft, createStructuredJson } from "./structuredJson";
import { createLispDraft } from "./structuredLisp";
import { DEFAULT_NODE_STYLE, PAGE_BACKGROUND_COLOR } from "./settings";
import bidi from "./fixtures/v2/bidi-contexts.json";
import colors from "./fixtures/v1/appearance-colors.json";
import memory from "./fixtures/v1/memory-piers.json";


const sample = (name) =>
  fs.readFileSync(path.join(__dirname, "..", "public", "examples", name), "utf8");

// Shaped like Viewport.toJSON(), the viewport every editor save passes.
const viewport = (appearanceChanged) => ({
  styles: {},
  defaultNodeStyle: Object.fromEntries(
    ["background", "border", "line", "text"].flatMap((kind) => [
      [`${kind}Color`, DEFAULT_NODE_STYLE[`${kind}Color`].asHex()],
      [`${kind}Alpha`, DEFAULT_NODE_STYLE[`${kind}Color`].a()],
    ])
  ),
  pageBackgroundColor: PAGE_BACKGROUND_COLOR.asRGBA(),
  cam: { cameraX: 3, cameraY: -4, scale: 2 },
  showingUI: true,
  appearanceChanged,
});

const json = (value) => JSON.stringify(value);

// A graph is equivalent to its round trip when every save of it, with no
// viewport and with the editor's viewport, is byte-identical to the same save
// of the graph that readGraph(writeGraph(graph)) would have displayed.
function expectEquivalentToRoundTrip(graph, selectedNode) {
  const reloaded = readGraph(writeGraph(graph, selectedNode));
  for (const data of [undefined, viewport(false), viewport(true)]) {
    expect(json(writeGraph(graph, selectedNode, data))).toBe(
      json(writeGraph(reloaded, selectedNode, data))
    );
  }
}

const selection = (node) => (typeof node?.id === "function" ? node.id() : node);

const producers = [
  ...[
    "blank", "grid", "daily_planner_15", "random", "alt_columns",
    "march_madness", "march_madness_vert", "playoffs", "playoffs_vert",
    "march", "rainbow", "rainbow_vert", "rainbow_random", "cross", "svg",
    "primes", "proportion_v1", "appearance_v1", "memory_piers_v1",
  ].map((type) => [`example ${type}`, () => loadExample({ type, seed: 7, rounds: 3, size: 6 })]),
  ["example json", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => sample("sample.json") }));
    return loadExample({ type: "json" });
  }],
  ["example lisp", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => sample("sample.lisp") }));
    return loadExample({ type: "lisp" });
  }],
  ["new JSON draft", () => ({ graph: createJsonDraft() })],
  ["new Lisp draft", () => ({ graph: createLispDraft() })],
  ["JSON import", () => ({ graph: createStructuredJson({ a: [1, { b: null }], c: "d" }) })],
  ["words import", () => ({ graph: importers.graphWords("one two\nthree") })],
  ["lines import", () => ({ graph: importers.graphLines("one\ntwo") })],
  ["Lisp import", () => ({ graph: importers.graphLisp("(define (f x) (* x 2))") })],
  ["XML import", () => ({ graph: importers.graphXml("<a b=\"c\"><d/>text</a>") })],
  ["v1 document", () => ({ graph: readGraph(memory) })],
  ["v1 appearance", () => ({ graph: readGraph(colors) })],
  ["v2 document", () => ({ graph: readGraph(bidi) })],
];

describe.each(producers)("%s", (name, load) => {
  test("produces a normalized graph equivalent to its round trip", async () => {
    const { graph, selectedNode } = await load();
    expect(isNormalizedGraph(graph)).toBe(true);
    expect(adoptGraph(graph, selection(selectedNode))).toBe(graph);
    expectEquivalentToRoundTrip(graph, selection(selectedNode));
  });
});

// How openGraph displayed an example before graphs were shown as built: the
// first history entry was written from the graph and the example's own
// viewport data (stateless graphs under the legacy appearance rule), and the
// display was rebuilt from that entry.
function openedBefore(graph, selectedNode, viewportData, stateless) {
  const copy = readGraph(writeGraph(graph, selectedNode));
  if (stateless) delete copy[Symbol.for("parsegraph.freeform.document")];
  return readGraph(writeGraph(copy, selectedNode, viewportData));
}

// Examples whose producers returned graphs without document state.
const STATELESS = new Set([
  "blank", "grid", "daily_planner_15", "random", "alt_columns", "march_madness",
  "march_madness_vert", "playoffs", "playoffs_vert", "march", "rainbow",
  "rainbow_vert", "rainbow_random", "cross", "json",
]);

describe.each(producers.filter(([name]) => name.startsWith("example ")))("%s", (name, load) => {
  test("opens with the same appearance and saves as before", async () => {
    const { graph, selectedNode, viewportData } = await load();
    const selected = selection(selectedNode);
    const type = name.slice("example ".length);
    const before = openedBefore(graph, selected, viewportData, STATELESS.has(type));
    expect(documentState(graph).appearance).toEqual(documentState(before).appearance);
    for (const data of [viewportData ?? undefined, viewport(false), viewport(true)]) {
      expect(json(writeGraph(graph, selected, data))).toBe(json(writeGraph(before, selected, data)));
    }
  });
});

function absoluteGraph() {
  // Preferences set before connecting stay absolute, as parsegraph leaves them.
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  child.siblings().setLayoutPreference(PreferredAxis.VERTICAL);
  root.connect(Direction.FORWARD, child);
  child.connect(Direction.DOWNWARD, new DirectionNode("grandchild"));
  return root;
}

test("bare and absolute-preference graphs are not normalized until finished", () => {
  const root = absoluteGraph();
  expect(isNormalizedGraph(root)).toBe(false);
  expect(isNormalizedGraph(initializeOnly(absoluteGraph()))).toBe(false);
  const child = root.neighbors().nodeAt(Direction.FORWARD);
  const ids = graphNodes(root).map((node) => node.id());
  expect(normalizeGraph(root)).toBe(root);
  // Parsegraph's own IDs are already unique strings and are kept as-is.
  expect(graphNodes(root).map((node) => node.id())).toEqual(ids);
  expect(isNormalizedGraph(root)).toBe(true);
  expect(child.siblings().getLayoutPreference()).toBe(PreferredAxis.PERPENDICULAR);
  expectEquivalentToRoundTrip(root, null);
});

function initializeOnly(root) {
  // Document state alone does not normalize preferences.
  graphNodes(root).forEach((node, index) => node.setId(`n${index}`));
  Object.defineProperty(root, Symbol.for("parsegraph.freeform.document"), {
    value: { version: 2, sourceVersion: 2, root, capabilities: {}, ignoredCapabilities: [] },
    configurable: true,
  });
  return root;
}

test("unnormalized graphs are adopted through the round trip", () => {
  const root = absoluteGraph();
  const adopted = adoptGraph(root, null);
  expect(adopted).not.toBe(root);
  expect(isNormalizedGraph(adopted)).toBe(true);
  expect(json(writeGraph(adopted, null, viewport(false)))).toBe(
    json(writeGraph(readGraph(writeGraph(root, null)), null, viewport(false)))
  );
});

test("duplicate or missing IDs are not normalized", () => {
  const root = normalizeGraph(absoluteGraph());
  root.neighbors().nodeAt(Direction.FORWARD).setId(root.id());
  expect(isNormalizedGraph(root)).toBe(false);
});

// A v0 document, optionally carrying the viewport styles v0 kept.
function legacyDocument(styled) {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  root.connect(Direction.FORWARD, child);
  const styles = styled
    ? {
        defaultNodeStyle: { backgroundColor: "#ffeedd", backgroundAlpha: 0.5 },
        styles: { [child.id()]: { textColor: "#112233" }, missing: { textColor: "#000000" } },
        pageBackgroundColor: "#203040",
      }
    : undefined;
  return writeGraph(root, root, styles, 0);
}

// How a v0 document opened before readGraph migrated it: its first native
// save applied the legacy appearance rule, then the display was rebuilt.
function openedByRoundTrip(data) {
  const root = readGraph(data);
  delete root[Symbol.for("parsegraph.freeform.document")];
  return readGraph(writeGraph(root, graphSelection(data), graphViewport(data)));
}

test.each([
  ["unstyled", false],
  ["styled", true],
])("%s v0 documents migrate on read and save as they did after a round trip", (name, styled) => {
  const data = legacyDocument(styled);
  const graph = readGraph(data);
  expect(documentState(graph).sourceVersion).toBe(0);
  expect(isNormalizedGraph(graph)).toBe(true);
  expect(Boolean(documentState(graph).appearance)).toBe(styled);
  const previous = openedByRoundTrip(data);
  // Editor saves always pass the viewport. Without one, the rebuilt copy also
  // repeats its first history entry's viewport metadata, which this does not.
  for (const data of [viewport(false), viewport(true)]) {
    expect(json(writeGraph(graph, null, data))).toBe(json(writeGraph(previous, null, data)));
  }
  expectEquivalentToRoundTrip(graph, null);
});

test("the stored startup graph is displayed once, until history moves", () => {
  jest.isolateModules(() => {
    jest.doMock("./settings", () => ({ ...jest.requireActual("./settings"), USE_LOCAL_STORAGE: true }));
    const saved = writeGraph(readGraph(bidi), null);
    localStorage.setItem("parsegraph-graph", JSON.stringify(saved));
    try {
      const GraphStack = require("./GraphStack").default;
      const stack = new GraphStack();
      const live = stack.liveWidget();
      expect(isNormalizedGraph(live)).toBe(true);
      expect(json(writeGraph(live, null))).toBe(json(stack._actions[0]));
      // Handed out once; later reads rebuild from history as before.
      expect(stack.liveWidget()).not.toBe(live);
      const next = new GraphStack();
      next.save(next.widget(), null);
      expect(next.liveWidget()).not.toBe(live);
    } finally {
      localStorage.removeItem("parsegraph-graph");
    }
  });
});
