import {
  Bidi,
  Direction,
  DirectionNode,
  Fit,
  serializeParsegraph,
  resolveNodeAppearance,
} from "parsegraph";
import {
  readGraph,
  writeGraph,
  documentState,
  graphNodes,
  graphSelection,
  graphViewport,
  initializeGraphDocument,
  CURRENT_DOCUMENT_VERSION,
} from "./graphDocument";
import GraphStack from "./GraphStack";
import Viewport from "./components/Viewport/Viewport";
import Color from "parsegraph-color";
import fixture from "./fixtures/v1/appearance-colors.json";
import { DEFAULT_NODE_STYLE, PAGE_BACKGROUND_COLOR } from "./settings";

const copy = (value) => JSON.parse(JSON.stringify(value));

test("native v2 preserves inherited and explicit bidi declarations with opaque document data", () => {
  const data = copy(fixture);
  data.version = 2;
  data.nodes = data.nodes.map(({ rightToLeft, ...node }, index) => ({
    ...node, bidi: [Bidi.INHERIT, Bidi.RTL, Bidi.LTR][index],
  }));
  data.capabilities["future/42"] = { nodes: ["root", { data: false }] };
  data.metadata = { custom: { payload: [null, 0] }, freeform: { custom: "keep" } };
  const root = readGraph(data);
  expect(documentState(root)).toMatchObject({ version: 2, sourceVersion: 2 });
  const saved = writeGraph(root, "child", {
    cam: { cameraX: 4, cameraY: -5, scale: 2 }, showingUI: false,
  });
  expect(saved.version).toBe(2);
  expect(saved.capabilities).toEqual(data.capabilities);
  expect(saved.metadata.custom).toEqual(data.metadata.custom);
  expect(saved.metadata.freeform.custom).toBe("keep");
  const declarations = (nodes) => Object.fromEntries(nodes.map((node) => [node.id, node.bidi]));
  expect(declarations(saved.nodes)).toEqual(declarations(data.nodes));
  expect(saved.nodes.every((node) => !Object.hasOwn(node, "rightToLeft"))).toBe(true);
  expect(graphSelection(saved)).toBe("child");
  expect(graphViewport(saved)).toEqual({ cam: { cameraX: 4, cameraY: -5, scale: 2 }, showingUI: false });
});

test.each([0, 1])("legacy v%s imports discard inert RTL flags and save an explicit LTR root", (version) => {
  const data = copy(fixture);
  data.nodes.forEach((node) => { node.rightToLeft = true; });
  const input = version === 1 ? data : serializeParsegraph(readGraph(data));
  if (version === 0) Object.values(input.__parsegraph).forEach((node) => { node.rightToLeft = true; });
  const root = readGraph(input);
  expect(documentState(root)).toMatchObject({ version: 2, sourceVersion: version });
  expect(root.bidi()).toBe(Bidi.LTR);
  expect(graphNodes(root).filter((node) => node !== root).every((node) => node.bidi() === Bidi.INHERIT)).toBe(true);
  const saved = writeGraph(root);
  expect(saved.version).toBe(2);
  expect(saved.nodes.find((node) => node.id === saved.root).bidi).toBe(Bidi.LTR);
});

test("fresh graphs save inherited direction without requiring document initialization", () => {
  const root = new DirectionNode("new graph");
  const saved = writeGraph(root);
  expect(saved.version).toBe(2);
  expect(saved.nodes[0].bidi).toBe(Bidi.INHERIT);
  expect(documentState(readGraph(saved)).sourceVersion).toBe(2);
  expect(() => readGraph({ ...saved, nodes: saved.nodes.map(({ bidi, ...node }) => node) })).toThrow();
  expect(() => readGraph({ ...saved, nodes: saved.nodes.map((node) => ({ ...node, rightToLeft: false })) })).toThrow();
});

test.each(["structuredJson", "structuredLisp"])(
  "%s metadata cannot be silently discarded through a v0 export",
  (language) => {
    for (const marker of [null, false, 0, { version: 1, nodes: {} }]) {
      const data = copy(fixture);
      data.metadata = { freeform: { [language]: marker } };
      const root = readGraph(data);
      expect(() => writeGraph(root, null, null, 0)).toThrow("require the native Parsegraph format");
      expect(writeGraph(root, null, null).metadata.freeform[language]).toEqual(marker);
    }
  }
);

test("native imports reject ambiguous language metadata", () => {
  const data = copy(fixture);
  data.metadata = { freeform: { structuredJson: null, structuredLisp: null } };
  expect(() => readGraph(data)).toThrow("one language");
});

test("builder documents retain node separation in their first history snapshot", () => {
  const root = new DirectionNode("builder");
  root.setNodeFit(Fit.EXACT);
  root.setSeparationFit(Direction.FORWARD, Fit.LOOSE);
  expect(initializeGraphDocument(root)).toBe(root);
  const history = new GraphStack();
  history.save(root);
  const restored = history.widget();
  expect(documentState(restored).version).toBe(CURRENT_DOCUMENT_VERSION);
  expect(restored.nodeFit()).toBe(Fit.EXACT);
  expect(restored.separationFit(Direction.FORWARD)).toBe(Fit.LOOSE);
  expect(restored.separationFit(Direction.DOWNWARD)).toBe(Fit.EXACT);
});

test("separation and focus follow live nodes through undo, deletion, and clearing", () => {
  const data = copy(fixture);
  data.capabilities["separation/1"] = {
    nodeDirections: { root: ["forward", "backward"], child: ["upward"] },
  };
  data.capabilities["focus/1"] = {
    nodeDirections: { root: ["forward"], child: [] },
  };
  const root = readGraph(data);
  expect(documentState(root).ignoredCapabilities).toEqual([]);
  const history = new GraphStack();
  history.save(root);
  root.setSeparationFit(Direction.FORWARD, Fit.EXACT);
  root.clearFocus();
  graphNodes(root).find((node) => node.id() === "child").disconnect();
  history.save(root);
  history.undo();
  const undone = writeGraph(history.widget());
  expect(undone.capabilities["separation/1"]).toEqual(data.capabilities["separation/1"]);
  expect(undone.capabilities["focus/1"]).toEqual(data.capabilities["focus/1"]);
  history.redo();
  const restored = history.widget();
  const saved = writeGraph(restored);
  expect(saved.capabilities["separation/1"]).toEqual({ nodeDirections: { root: ["backward"] } });
  expect(saved.capabilities["focus/1"]).toEqual({ nodeDirections: {} });
  restored.setSeparationFit(Direction.BACKWARD, Fit.EXACT);
  expect(writeGraph(restored).capabilities["separation/1"]).toEqual({ nodeDirections: {} });
});

test("live module reload keeps document capabilities attached to existing graphs", () => {
  const root = readGraph(fixture);
  jest.isolateModules(() => {
    const reloaded = require("./graphDocument");
    expect(reloaded.documentState(root).capabilities).toEqual(
      fixture.capabilities
    );
    expect(reloaded.writeGraph(root).capabilities).toEqual(
      fixture.capabilities
    );
  });
});
function viewportFor(root) {
  const viewport = new Viewport();
  let page = new Color(0.2, 0.2, 0.9, 1);
  viewport._rendering = {
    resetSettings: () => {
      page = new Color(0.2, 0.2, 0.9, 1);
    },
    setPageBackgroundColor: (next) => {
      page = next;
    },
    pageBackgroundColor: () => page,
    showingUI: () => false,
    showUI: jest.fn(),
    hideUI: jest.fn(),
  };
  viewport.refresh = jest.fn();
  viewport.show(root);
  return viewport;
}

test("v1 capabilities and metadata survive editing, undo, redo, and serialization", () => {
  const data = copy(fixture);
  data.capabilities["future/9"] = {
    arbitrary: [0, false, null, { nested: "preserve" }],
  };
  data.capabilities["generation/1"] = {
    generator: { name: "unknown", revision: 99 },
    seed: 0,
  };
  data.metadata = { other: { note: "opaque" }, freeform: { custom: "keep" } };
  const root = readGraph(data);
  const viewport = viewportFor(root);
  const stack = new GraphStack();
  stack.save(root, root, viewport);
  root.setValue("edited");
  stack.save(root, root, viewport);
  stack.undo();
  expect(stack.widget().value()).toBe("Default");
  stack.redo();
  const restored = stack.widget();
  expect(restored.value()).toBe("edited");
  const saved = writeGraph(restored);
  expect(saved.capabilities).toEqual(data.capabilities);
  expect(saved.metadata.other).toEqual(data.metadata.other);
  expect(saved.metadata.freeform.custom).toBe("keep");
  expect(graphSelection(saved)).toBe("root");
  expect(graphViewport(saved).cam.scale).toBe(1);
  expect(documentState(restored).ignoredCapabilities).toEqual([
    "future/9",
    "generation/1",
  ]);
});

test("appearance loads sparse overrides and zero alpha without inheriting local defaults", () => {
  const root = readGraph(fixture);
  const viewport = viewportFor(root);
  const appearance = fixture.capabilities["appearance/1"];
  for (const node of graphNodes(root)) {
    expect(viewport.getNodeStyle(node)).toEqual(
      resolveNodeAppearance(appearance, node.id())
    );
  }
  expect(viewport.rendering().pageBackgroundColor().a()).toBe(
    appearance.pageBackgroundAlpha
  );
  expect(
    viewport.getNodeStyle(
      graphNodes(root).find((node) => node.id() === "transparent")
    ).backgroundAlpha
  ).toBe(0);
  viewport.updateNodeStyle(root, { textAlpha: 0, pageBackgroundAlpha: 0 });
  const saved = writeGraph(root, root, viewport.toJSON());
  expect(saved.capabilities["appearance/1"].nodeStyles.root.textAlpha).toBe(0);
  expect(saved.capabilities["appearance/1"].pageBackgroundAlpha).toBe(0);
});

test("camera metadata can be reimported without being mistaken for appearance", () => {
  const root = readGraph(fixture);
  const viewport = viewportFor(root);
  viewport.camera().setScale(2);
  const saved = writeGraph(root, root, viewport.toJSON());
  const reimported = readGraph(saved);
  const stack = new GraphStack();
  stack.save(reimported, graphSelection(saved), graphViewport(saved));
  expect(documentState(stack.widget()).appearance).toEqual(
    fixture.capabilities["appearance/1"]
  );
  expect(stack.viewportData().cam.scale).toBe(2);
});

test("deleting styled nodes repairs supported references and preserves unknown payloads", () => {
  const data = copy(fixture);
  data.capabilities["future/1"] = { node: "child" };
  data.capabilities["presentation/1"].nodeStyles.child = "bud";
  const root = readGraph(data);
  const child = graphNodes(root).find((node) => node.id() === "child");
  child.disconnect();
  const saved = writeGraph(root);
  expect(saved.capabilities["appearance/1"].nodeStyles.child).toBeUndefined();
  expect(saved.capabilities["presentation/1"].nodeStyles.child).toBeUndefined();
  expect(saved.capabilities["future/1"]).toEqual({ node: "child" });
  expect(() => readGraph(saved)).not.toThrow();
});

test("legacy inputs save as v2 while explicit v0 export remains available", () => {
  const data = copy(fixture);
  data.capabilities = {};
  const root = readGraph(data);
  expect(documentState(root)).toMatchObject({ version: 2, sourceVersion: 1 });
  expect(
    writeGraph(root, root, viewportFor(root).toJSON()).capabilities
  ).toEqual({});
  const legacy = new DirectionNode("legacy");
  const v0 = serializeParsegraph(legacy);
  const imported = readGraph(v0);
  expect(documentState(imported)).toMatchObject({ version: 2, sourceVersion: 0 });
  expect(writeGraph(imported).version).toBe(2);
  expect(writeGraph(imported, undefined, undefined, 0)).toEqual(v0);
  const native = writeGraph(legacy, legacy, viewportFor(legacy).toJSON());
  expect(native.version).toBe(2);
  expect(native.capabilities["appearance/1"].defaults).toBeDefined();
  expect(writeGraph(legacy, undefined, undefined, 1).version).toBe(2);
  expect(() => writeGraph(legacy, undefined, undefined, 99)).toThrow("Unsupported");
});

test("adding nodes uses unique string IDs and a default presentation style", () => {
  const root = readGraph(fixture);
  const node = new DirectionNode("new").setId(42);
  root.connect(Direction.UPWARD, node);
  const saved = writeGraph(root);
  expect(saved.nodes.find((record) => record.value === "new").id).toBe("42");
  expect(saved.capabilities["presentation/1"].nodeStyles["42"]).toBeUndefined();
  expect(() => readGraph(saved)).not.toThrow();
});

test("malformed supported capabilities and unknown core versions do not fall back to v0", () => {
  const data = copy(fixture);
  data.capabilities["appearance/1"].defaults.textAlpha = 2;
  expect(() => readGraph(data)).toThrow();
  expect(() => readGraph({ ...fixture, version: 99 })).toThrow();
});

test("legacy sparse colors and numeric IDs migrate together with separate page alpha", () => {
  const root = new DirectionNode("legacy").setId(12);
  const viewport = viewportFor(root);
  viewport.load({
    styles: { 12: { backgroundColor: "#ff1234", backgroundAlpha: 0 } },
    pageBackgroundColor: "rgba(12,34,56,0.25)",
  });
  const saved = writeGraph(root, root, viewport.toJSON(), 1);
  expect(saved.root).toBe("12");
  const appearance = saved.capabilities["appearance/1"];
  expect(appearance.nodeStyles["12"]).toEqual({
    backgroundColor: "#ff1234",
    backgroundAlpha: 0,
  });
  expect(appearance.pageBackgroundColor).toBe("#0c2238");
  expect(appearance.pageBackgroundAlpha).toBe(0.25);
  expect(Object.keys(appearance.defaults)).toHaveLength(8);
  expect(() => readGraph(saved)).not.toThrow();
});

test.each([
  { styles: { 12: { backgroundColor: "#ff1234", backgroundAlpha: 0 } } },
  { pageBackgroundColor: "rgba(12,34,56,0.25)" },
  { defaultNodeStyle: { textColor: "#123456", textAlpha: 0 } },
])("the first legacy native snapshot preserves sparse viewport colors before showing: %j", (viewportData) => {
  const data = {
    ...serializeParsegraph(new DirectionNode("legacy").setId(12)),
    selectedNode: 12,
    viewport: {
      ...viewportData,
      cam: { cameraX: 5, cameraY: -6, scale: 2 },
      showingUI: true,
    },
  };
  const imported = readGraph(data);
  // This is App.openGraph's first snapshot, before any viewport loads defaults.
  const saved = writeGraph(imported, graphSelection(data), graphViewport(data));
  const restored = readGraph(saved);
  const appearance = documentState(restored).appearance;
  expect(saved.version).toBe(2);
  expect(restored.bidi()).toBe(Bidi.LTR);
  expect(appearance.nodeStyles).toEqual(viewportData.styles ?? {});
  expect(appearance.defaults.textColor).toBe(viewportData.defaultNodeStyle?.textColor ?? DEFAULT_NODE_STYLE.textColor.asHex());
  expect(appearance.defaults.textAlpha).toBe(viewportData.defaultNodeStyle?.textAlpha ?? DEFAULT_NODE_STYLE.textColor.a());
  expect(appearance.defaults.borderColor).toBe(DEFAULT_NODE_STYLE.borderColor.asHex());
  expect(appearance.pageBackgroundColor).toBe(viewportData.pageBackgroundColor ? "#0c2238" : PAGE_BACKGROUND_COLOR.asHex());
  expect(appearance.pageBackgroundAlpha).toBe(viewportData.pageBackgroundColor ? 0.25 : PAGE_BACKGROUND_COLOR.a());
  expect(graphSelection(saved)).toBe("12");
  expect(graphViewport(saved)).toEqual({ cam: data.viewport.cam, showingUI: true });
});

test("fresh color-builder graphs preserve sparse styles in their first native history snapshot", () => {
  const root = new DirectionNode("colored").setId(12);
  const styles = { 12: { backgroundColor: "#123456", backgroundAlpha: 0.5 } };
  const stack = new GraphStack();
  stack.save(root, root, { styles, pageBackgroundColor: "#223344" });
  const restored = stack.widget();
  expect(restored.bidi()).toBe(Bidi.INHERIT);
  expect(documentState(restored).appearance).toMatchObject({
    nodeStyles: styles, pageBackgroundColor: "#223344", pageBackgroundAlpha: 1,
  });
});

test("view annotations cannot override document appearance or apply an invalid camera", () => {
  const data = copy(fixture);
  data.metadata = {
    freeform: {
      viewport: {
        styles: { root: { backgroundColor: "#ffffff" } },
        pageBackgroundColor: "#ffffff",
        cam: { cameraX: 0, cameraY: 0, scale: -1 },
        showingUI: true,
      },
    },
  };
  expect(graphViewport(data)).toEqual({ showingUI: true });
  expect(writeGraph(readGraph(data)).metadata).toEqual(data.metadata);
});

test("special node IDs and arbitrary JSON content survive snapshots", () => {
  const data = copy(fixture);
  data.nodes[0].id = "__proto__";
  data.root = "__proto__";
  data.nodes[0].value = { label: "opaque", flags: [true, null] };
  data.nodes.slice(1).forEach((node) => {
    node.parentId = "__proto__";
  });
  data.capabilities["appearance/1"].nodeStyles = Object.fromEntries([
    ["__proto__", { textAlpha: 0 }],
  ]);
  const root = readGraph(data);
  const viewport = viewportFor(root);
  expect(viewport.getNodeStyle(root).textAlpha).toBe(0);
  const saved = writeGraph(root, root, viewport.toJSON());
  expect(saved.nodes.find((node) => node.id === "__proto__").value).toEqual(
    data.nodes[0].value
  );
  expect(saved.capabilities["appearance/1"].nodeStyles.__proto__).toEqual({
    textAlpha: 0,
  });
});
