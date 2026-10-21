import {
  Direction,
  DirectionNode,
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
} from "./graphDocument";
import GraphStack from "./GraphStack";
import Viewport from "./components/Viewport/Viewport";
import Color from "parsegraph-color";
import fixture from "./fixtures/v1/appearance-colors.json";

const copy = (value) => JSON.parse(JSON.stringify(value));

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

test("core-only v1 remains valid without appearance, and v0 still round-trips as v0", () => {
  const data = copy(fixture);
  data.capabilities = {};
  const root = readGraph(data);
  expect(
    writeGraph(root, root, viewportFor(root).toJSON()).capabilities
  ).toEqual({});
  const legacy = new DirectionNode("legacy");
  const v0 = serializeParsegraph(legacy);
  expect(documentState(readGraph(v0)).version).toBe(0);
  expect(writeGraph(readGraph(v0))).toEqual(v0);
  const v1 = writeGraph(legacy, legacy, viewportFor(legacy).toJSON(), 1);
  expect(v1.version).toBe(1);
  expect(v1.capabilities["appearance/1"].defaults).toBeDefined();
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
