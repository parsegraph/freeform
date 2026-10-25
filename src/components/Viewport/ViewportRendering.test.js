import Camera from "parsegraph-camera";
import Rect from "parsegraph-rect";
import ViewportRendering from "./ViewportRendering";
import DocumentFont from "./DocumentFont";
import { createPresentation, Direction, DirectionNode, LayoutPhase } from "parsegraph";
import { createStructuredJson } from "../../structuredJson";
import { graphNodes } from "../../graphDocument";
import { WorldLabels } from "../WorldLabel";
import { attachBenchmark, beginBenchmark, benchmarkFor, cancelBenchmark, getBenchmarkRuns } from "../../benchmark";
import {
  getInteractionEvents,
  startInteractionBenchmark,
  stopInteractionBenchmark,
} from "../../interactionBenchmark";

function node(x, scale = 1) {
  return { layout: () => ({
    absoluteX: () => x, absoluteY: () => 0, absoluteScale: () => scale,
    absoluteSize: (size) => { size[0] = 100 * scale; size[1] = 50 * scale; },
  }) };
}

function labelRenderer(root, presentation, { scale = 0.5, fontSize = 10, enabled = true } = {}) {
  const camera = new Camera();
  camera.setSize(800, 600);
  camera.setOrigin(400, 300);
  camera.setScale(1);
  if (presentation) presentation.text.fontSize = fontSize;
  const nodes = graphNodes(root);
  nodes.forEach((item, index) => jest.spyOn(item, "layout").mockReturnValue({
    needsCommit: () => false, needsAbsolutePos: () => false,
    absoluteX: () => index * 30, absoluteY: () => 0, absoluteScale: () => scale,
    size: (out) => { out[0] = 100; out[1] = 50; },
  }));
  const ctx = Object.fromEntries([
    "save", "restore", "resetTransform", "scale", "translate", "fillText",
  ].map((name) => [name, jest.fn()]));
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = {
    widget: () => root, camera: () => camera, presentation: () => presentation,
    getNodeStyle: () => ({ textColor: "#123456", textAlpha: 1 }),
  };
  renderer._ctx = ctx;
  renderer._frame = { camera, textImage: {} };
  renderer._worldLabels = new WorldLabels(1);
  renderer._showWorldLabels = enabled;
  renderer._painters = new WeakMap();
  renderer._bounds = new WeakMap();
  root.paintGroup().forEach((pg) => {
    renderer._painters.set(pg, { glyphPainter: { render: jest.fn() } });
    renderer._bounds.set(pg, { bounds: new Rect(0, 0, 200, 100) });
  });
  renderer.drawText = jest.fn();
  const data = { k: 0 };
  return {
    renderer, ctx, data,
    draw: () => root.paintGroup().forEach((pg) =>
      expect(renderer.renderPaintGroupText(pg, data)).toBe(false)
    ),
    restore: () => nodes.forEach((item) => item.layout.mockRestore()),
  };
}

test("nested JSON labels are collected even with a cached text frame, and the Labels toggle disables them", () => {
  const root = createStructuredJson({ name: "Alice" });
  const harness = labelRenderer(root);
  harness.draw();
  expect(harness.renderer._worldLabels.labels().map((label) => label.text()))
    .toEqual(expect.arrayContaining(["{}", '"name"', '"Alice"']));
  expect(harness.data.k).toBe(3); // Organizing buds never get labels.
  expect(harness.renderer.drawText).not.toHaveBeenCalled();
  harness.renderer._worldLabels.clear();
  harness.renderer.toggleWorldLabels();
  harness.draw();
  expect(harness.renderer._worldLabels.labels()).toEqual([]);
  harness.restore();
});

test("panning enqueues the cached GPU glyph layout with the node's absolute pose", () => {
  const root = new DirectionNode("AVyg");
  const harness = labelRenderer(root, undefined, { scale: 1 });
  harness.renderer._frame.textImage = null;
  const glyphs = [["A", -10.5, 9.25], ["V", -2.125, 9.25]];
  const textLayout = { font: "80px sans-serif", glyphs };
  harness.renderer._painters.get(root).textLayouts = new WeakMap([[root, textLayout]]);
  harness.draw();
  expect(harness.renderer.drawText).toHaveBeenCalledWith(
    textLayout, 0, 0, 1, "rgba(18, 52, 86, 1)"
  );
  const worker = { postMessage: jest.fn() };
  harness.renderer._textRenderer = worker;
  ViewportRendering.prototype.drawText.call(harness.renderer, textLayout, 12.25, -8.5, 0.75, "red");
  expect(worker.postMessage).toHaveBeenCalledWith({
    event: "text", glyphs, font: "80px sans-serif",
    worldX: 12.25, worldY: -8.5, worldScale: 0.75, fillStyle: "red",
  });
  expect(worker.postMessage.mock.calls[0][0].glyphs).toBe(glyphs);
  harness.restore();
});

test.each([
  ["small text", 0.5, 10, true, true],
  ["normal zoom", 1, 10, true, false],
  ["larger presentation font", 0.5, 40, true, false],
  ["smaller presentation font", 1, 5, true, true],
  ["Labels disabled", 0.5, 10, false, false],
])("presentation documents use WorldLabels for %s only when needed", (name, scale, fontSize, enabled, promoted) => {
  const root = new DirectionNode("first\r\nsecond");
  const harness = labelRenderer(root, createPresentation(), { scale, fontSize, enabled });
  harness.draw();
  expect(harness.data.k).toBe(promoted ? 1 : 0);
  if (promoted) {
    const [label] = harness.renderer._worldLabels.labels();
    expect(label.text()).toBe("first");
    expect(label.fontSize()).toBe(15);
    expect(label.scale()).toBe(scale * fontSize / 10);
    expect(harness.ctx.fillText).not.toHaveBeenCalled();
  } else {
    expect(harness.renderer._worldLabels.labels()).toEqual([]);
    expect(harness.ctx.fillText.mock.calls.map(([line]) => line)).toEqual(["first", "second"]);
  }
  harness.restore();
});

test.each([undefined, "", { text: "unsupported" }])("presentation value %p does not produce an empty or invented WorldLabel", (value) => {
  const harness = labelRenderer(new DirectionNode(value), createPresentation());
  harness.draw();
  expect(harness.renderer._worldLabels.labels()).toEqual([]);
  expect(harness.data.k).toBe(0);
  harness.restore();
});

test("transparent presentation text stays hidden at WorldLabel zoom", () => {
  const harness = labelRenderer(new DirectionNode("hidden"), createPresentation());
  harness.renderer._viewport.getNodeStyle = () => ({ textColor: "#123456", textAlpha: 0 });
  harness.draw();
  expect(harness.renderer._worldLabels.labels()).toEqual([]);
  expect(harness.ctx.fillStyle).toBe("rgba(18, 52, 86, 0)");
  harness.restore();
});

test("typed paint groups use CSS camera scale while ordinary painters keep their render path", () => {
  const root = new DirectionNode("node");
  jest.spyOn(root, "layout").mockReturnValue({
    needsCommit: () => false, needsAbsolutePos: () => false,
    absoluteScale: () => 0.5, absoluteX: () => 0, absoluteY: () => 0,
  });
  const camera = new Camera();
  camera.setSize(800, 600);
  camera.setOrigin(100, 75);
  camera.setScale(4);
  const painter = { render: jest.fn() };
  const data = { painter, spotlightPainter: {}, typedShapes: true };
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = { camera: () => camera };
  renderer._painters = new WeakMap([[root, data]]);
  renderer._bounds = new WeakMap([[root, { bounds: new Rect(0, 0, 10, 10) }]]);
  renderer.renderingSpotlights = () => false;
  expect(renderer.renderPaintGroup(root, camera.project(), { i: 0 })).toBe(false);
  expect(painter.render.mock.calls[0][1]).toBe(2);
  camera.setScale(8);
  camera.setOrigin(50, 37.5);
  renderer.renderPaintGroup(root, camera.project(), { i: 0 });
  expect(painter.render.mock.calls[1][1]).toBe(4);
  data.typedShapes = false;
  renderer.renderPaintGroup(root, camera.project(), { i: 0 });
  expect(painter.render.mock.calls[2]).toHaveLength(1);
  root.layout.mockRestore();
});

test("cached text does not draw a second custom border over the GPU shape", () => {
  const root = createStructuredJson(true);
  jest.spyOn(root, "layout").mockReturnValue({
    needsCommit: () => false, needsAbsolutePos: () => false,
    absoluteScale: () => 1, absoluteX: () => 0, absoluteY: () => 0,
  });
  const camera = new Camera();
  camera.setSize(800, 600);
  camera.setOrigin(400, 300);
  const ctx = { beginPath: jest.fn(), stroke: jest.fn() };
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = {
    widget: () => root, camera: () => camera, presentation: () => undefined,
  };
  renderer._frame = { camera, textImage: {} };
  renderer._worldLabels = {};
  renderer._glProvider = { gl: () => ({}) };
  renderer._ctx = ctx;
  renderer._painters = new WeakMap([[root, { glyphPainter: {} }]]);
  renderer._bounds = new WeakMap([[root, { bounds: new Rect(0, 0, 10, 10) }]]);
  expect(renderer.renderPaintGroupText(root, { k: 0 })).toBe(false);
  expect(ctx.beginPath).not.toHaveBeenCalled();
  expect(ctx.stroke).not.toHaveBeenCalled();
  root.layout.mockRestore();
});

test("typed selection and hover highlights follow the custom outline", () => {
  const root = createStructuredJson([true, "text"]);
  const bool = graphNodes(root).find((item) => item.value() === "true");
  const string = graphNodes(root).find((item) => item.value() === '"text"');
  const geometry = {
    absoluteX: () => 0, absoluteY: () => 0, absoluteScale: () => 1,
    size: (size) => { size[0] = 100; size[1] = 50; },
    needsCommit: () => false, needsAbsolutePos: () => false,
  };
  for (const item of [root, bool, string]) jest.spyOn(item, "layout").mockReturnValue(geometry);
  const ctx = Object.fromEntries([
    "save", "restore", "resetTransform", "beginPath", "moveTo", "lineTo",
    "quadraticCurveTo", "closePath", "stroke", "roundRect", "strokeRect", "scale", "translate",
  ].map((name) => [name, jest.fn()]));
  const camera = new Camera();
  camera.setSize(800, 600);
  camera.setOrigin(400, 300);
  let selected = root;
  let hovered = bool;
  let showingCaret = true;
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = {
    widget: () => root, node: () => selected, layout: () => selected.layout(),
    camera: () => camera, input: () => ({ hoveredNode: () => hovered }),
    showingCaret: () => showingCaret, showNodeActions: () => false,
  };
  renderer.ctx = () => ctx;
  renderer.carouselContainer = () => ({ style: {} });
  renderer.renderCaret();
  expect(ctx.closePath).toHaveBeenCalledTimes(1);
  expect(ctx.stroke).toHaveBeenCalledTimes(2);
  expect(ctx.roundRect).not.toHaveBeenCalled();
  renderer.renderHovered();
  expect(ctx.closePath).toHaveBeenCalledTimes(2);
  expect(ctx.stroke).toHaveBeenCalledTimes(3);
  expect(ctx.roundRect).not.toHaveBeenCalled();
  showingCaret = false;
  renderer.renderCaret();
  expect(ctx.strokeRect).not.toHaveBeenCalled();
  expect(ctx.closePath).toHaveBeenCalledTimes(2);
  expect(ctx.stroke).toHaveBeenCalledTimes(3);
  // Ordinary scalar highlights retain their existing rounded shape.
  selected = string;
  showingCaret = true;
  renderer.renderCaret();
  expect(ctx.roundRect).toHaveBeenCalledTimes(1);
  expect(ctx.stroke).toHaveBeenCalledTimes(5);
  hovered = string;
  selected = bool;
  renderer.renderHovered();
  expect(ctx.roundRect).toHaveBeenCalledTimes(2);
  for (const item of [root, bool, string]) item.layout.mockRestore();
});

test.each([
  ["View with a selected node", false, true, true],
  ["View while panning", false, false, false],
  ["Edit mode", true, false, true],
])("%s renders the expected selection overlay", (name, editing, navigating, showsSelection) => {
  const camera = new Camera();
  camera.setSize(800, 600);
  camera.setOrigin(400, 300);
  const ctx = Object.fromEntries(["resetTransform", "scale", "translate"].map((method) => [method, jest.fn()]));
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = { camera: () => camera, navigatingNodes: () => navigating };
  renderer._overlayCanvas = { getContext: () => ctx };
  renderer._showingUI = editing;
  renderer.renderCaret = jest.fn();
  renderer.renderHovered = jest.fn();
  renderer.renderUI();
  expect(renderer.renderHovered).toHaveBeenCalledTimes(1);
  expect(renderer.renderCaret).toHaveBeenCalledTimes(showsSelection ? 1 : 0);
});

test("neighbor focus schedules travel once and rapid moves use the planned zoom", () => {
  const camera = new Camera();
  camera.setSize(1000, 1000);
  camera.setOrigin(500, 500);
  let selected = node(0);
  let ensure = false;
  let destination;
  const travel = {
    active: () => destination !== undefined,
    destinationScale: () => destination?.scale,
    start: jest.fn((target) => { destination = target; }),
  };
  const viewport = {
    camera: () => camera, node: () => selected, cameraTravel: () => travel,
    input: () => ({ stopPan: jest.fn() }),
    showingInCamera: () => false, checkingScale: () => false,
    ensuringVisible: () => ensure,
    clearShowingInCamera: jest.fn(), clearCheckScale: jest.fn(),
    clearEnsuringVisible: () => { ensure = false; },
  };
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = viewport;
  const original = camera.toJSON();
  // A restored camera is left untouched on the first frame.
  expect(renderer.focusCamera()).toBe(false);
  expect(camera.toJSON()).toEqual(original);
  selected = node(200, 0.5);
  ensure = true;
  expect(renderer.focusCamera()).toBe(true);
  expect(destination.scale).toBe(2);
  expect(camera.toJSON()).toEqual(original);
  // Rendering must advance while the animation is active.
  expect(renderer.focusCamera()).toBe(false);
  expect(travel.start).toHaveBeenCalledTimes(1);
  // The live camera could still be zoomed out during the first journey.
  camera.setScale(0.1);
  selected = node(500, 0.25);
  ensure = true;
  renderer.focusCamera();
  expect(destination.scale).toBe(4);
  expect(travel.start).toHaveBeenCalledTimes(2);
});

test.each([[0, 600], [800, 0], [0, 0]])("camera focus waits through a %s by %s viewport and resumes with a valid size", (width, height) => {
  const camera = new Camera();
  camera.setSize(width, height);
  camera.setOrigin(120, 80);
  const selected = node(0);
  selected.layout = () => ({
    absoluteX: () => 0, absoluteY: () => 0, absoluteScale: () => 1,
    absoluteSize: (out) => { out[0] = 100; out[1] = 50; },
    extentSize: (out) => { out[0] = 1000; out[1] = 1000; },
  });
  let checking = true;
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = {
    camera: () => camera, node: () => selected, widget: () => selected,
    cameraTravel: () => ({ active: () => false, cancel: jest.fn() }),
    showingInCamera: () => false, checkingScale: () => checking,
    ensuringVisible: () => false,
    clearCheckScale: () => { checking = false; },
  };
  const original = camera.toJSON();
  expect(() => renderer.focusCamera()).not.toThrow();
  expect(camera.toJSON()).toEqual(original);
  expect(checking).toBe(true);
  camera.setSize(800, 600);
  expect(() => renderer.focusCamera()).not.toThrow();
  expect(checking).toBe(false);
  expect(camera.scale()).toBeGreaterThan(0);
  expect([camera.x(), camera.y(), camera.scale()].every(Number.isFinite)).toBe(true);
});

test("initial render timing follows all phases and detaches before later worker redraws", () => {
  jest.useFakeTimers();
  window.history.replaceState({}, "", "/?benchmark=1");
  const run = beginBenchmark({ kind: "example", type: "blank" });
  try {
    const root = attachBenchmark(new DirectionNode(), run);
    const renderer = Object.create(ViewportRendering.prototype);
    renderer._viewport = { widget: () => root, presentation: () => undefined };
    renderer._benchmark = run;
    renderer._phase = 0;
    renderer._cranks = 0;
    renderer._steps = [["Painting graph", () => false], ["Rendering blocks", () => false]];
    renderer.allNodeCount = () => 1;
    renderer.allPaintGroupCount = () => 1;
    renderer.crank();
    expect(benchmarkFor(root)).toBe(run);
    expect(getBenchmarkRuns().at(-1).milestones.firstRenderPassMs).toBeUndefined();
    renderer.crank();
    expect(benchmarkFor(root)).toBeUndefined();
    jest.advanceTimersByTime(300);
    const report = getBenchmarkRuns().at(-1);
    expect(report.status).toBe("complete");
    expect(report.details).toMatchObject({ nodes: 1, paintGroups: 1 });
    expect(report.stages.map((stage) => stage.name)).toEqual([
      "Layout + paint preparation", "Rendering blocks", "Graph statistics",
    ]);
    renderer._phase = 0;
    renderer.crank();
    expect(getBenchmarkRuns().at(-1)).toBe(report);
  } finally {
    cancelBenchmark(run);
    jest.useRealTimers();
    window.history.replaceState({}, "", "/");
  }
});

test("interaction restarts preserve unfinished block counts and distinguish untouched and completed passes", () => {
  jest.useFakeTimers();
  window.history.replaceState({}, "", "/?benchmark=1");
  startInteractionBenchmark({ label: "Renderer restart regression" });
  try {
    const root = new DirectionNode();
    const camera = new Camera();
    camera.setSize(1000, 600);
    camera.setOrigin(40, 50);
    camera.setScale(0.5);
    const renderer = Object.create(ViewportRendering.prototype);
    renderer._viewport = { widget: () => root, camera: () => camera };
    renderer._steps = [
      ["Painting graph"],
      ["Focusing camera"],
      ["Clearing background"],
      ["Rendering blocks"],
    ];
    renderer._renderPass = 12;
    renderer._phase = 3;
    renderer._cranks = 20;
    renderer._paintGroupCount = 8;
    renderer._renderData = {
      allGroups: 3,
      i: 2,
      offscreenGroups: 1,
      dirtyGroups: 0,
      textVisited: 0,
    };

    renderer.restart();
    expect(renderer.interactionState()).toMatchObject({
      pass: 13,
      phase: 0,
      blocksVisited: 0,
      blocksDrawn: 0,
      culled: 0,
      totalGroups: null,
    });
    // scheduleRepaint can restart again before any new work has run.
    renderer.restart();

    renderer._phase = renderer._steps.length;
    renderer._renderData.allGroups = 8;
    renderer._renderData.i = 5;
    renderer._renderData.offscreenGroups = 3;
    renderer.restart();
    stopInteractionBenchmark();

    const restarts = getInteractionEvents().filter((event) => event.type === "restart");
    expect(restarts).toHaveLength(3);
    expect(restarts[0]).toMatchObject({
      pass: 12,
      phase: 3,
      phaseName: "Rendering blocks",
      complete: false,
      blocksVisited: 3,
      blocksDrawn: 2,
      culled: 1,
      totalGroups: 8,
      camera: { x: 40, y: 50, scale: 0.5, version: camera.changeVersion() },
    });
    expect(restarts[1]).toMatchObject({
      pass: 13,
      phase: 0,
      phaseName: "Painting graph",
      complete: false,
      blocksVisited: 0,
    });
    expect(restarts[2]).toMatchObject({
      pass: 14,
      phaseName: "Finished",
      complete: true,
      blocksVisited: 8,
      blocksDrawn: 5,
      culled: 3,
    });
    expect(restarts.filter((event) => event.phaseName === "Rendering blocks" && !event.complete)).toHaveLength(1);
  } finally {
    stopInteractionBenchmark();
    jest.useRealTimers();
    window.history.replaceState({}, "", "/");
  }
});

test("context loss suspends rendering and restoration rebuilds every paint group", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  const grandchild = new DirectionNode("grandchild");
  root.connect(Direction.FORWARD, child);
  child.connect(Direction.DOWNWARD, grandchild);
  child.paintGroups().crease();
  grandchild.paintGroups().crease();
  const groups = [];
  root.paintGroup().forEach((group) => {
    groups.push(group);
    group.layout().setPhase(LayoutPhase.COMMITTED);
  });
  expect(groups).toHaveLength(3);

  const painters = new WeakMap(groups.map((group) => [group, {}]));
  const bounds = new WeakMap(groups.map((group) => [group, {}]));
  const step = jest.fn(() => false);
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = {
    widget: () => root,
    cancelScheduledRender: jest.fn(),
    refresh: jest.fn(() => {
      expect(groups.every((group) => group.layout().needsCommit())).toBe(true);
    }),
  };
  renderer._documentFont = { contextLost: jest.fn() };
  renderer._painters = painters;
  renderer._bounds = bounds;
  renderer._layout = {};
  renderer._phase = 0;
  renderer._cranks = 0;
  renderer._steps = [["Painting graph", step]];
  renderer._scheduledPostRender = null;

  renderer.contextChanged(true);
  expect(renderer._viewport.cancelScheduledRender).toHaveBeenCalledTimes(1);
  expect(renderer._documentFont.contextLost).toHaveBeenCalledTimes(1);
  expect(renderer._painters).not.toBe(painters);
  expect(renderer._bounds).not.toBe(bounds);
  expect(renderer._layout).toBeFalsy();
  expect(renderer.crank()).toBe(false);
  expect(step).not.toHaveBeenCalled();
  expect(renderer._viewport.refresh).not.toHaveBeenCalled();

  renderer.contextChanged(false);
  expect(renderer._viewport.refresh).toHaveBeenCalledTimes(1);
  expect(renderer.crank()).toBe(true);
  expect(step).toHaveBeenCalledTimes(1);
});

test("returning to a committed root rebinds every group without invalidating routine layout restarts", () => {
  const firstRoot = new DirectionNode("first");
  const firstChild = new DirectionNode("first child");
  firstRoot.connect(Direction.FORWARD, firstChild);
  firstChild.paintGroups().crease();
  const secondRoot = new DirectionNode("second");
  let currentRoot = firstRoot;
  const resource = new DocumentFont();
  // Atlas allocation is covered by DocumentFont tests; keep this regression
  // focused on real graph invalidation when renderer ownership changes.
  resource.get = jest.fn(function (root, provider) {
    this._root = root;
    this._provider = provider;
    return {};
  });
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = {
    widget: () => currentRoot,
    presentation: () => undefined,
    getNodeStyle: () => ({}),
  };
  renderer._documentFont = resource;
  renderer._glProvider = {};
  renderer._ctx = {};
  renderer._painters = new WeakMap();
  renderer._bounds = new WeakMap();

  renderer.createLayout();
  [firstRoot, firstChild].forEach((node) =>
    node.layout().setPhase(LayoutPhase.COMMITTED)
  );
  renderer.createLayout();
  expect(firstRoot.layout().needsCommit()).toBe(false);
  expect(firstChild.layout().needsCommit()).toBe(false);

  currentRoot = secondRoot;
  renderer.createLayout();
  currentRoot = firstRoot;
  renderer.createLayout();
  expect(firstRoot.layout().needsCommit()).toBe(true);
  expect(firstChild.layout().needsCommit()).toBe(true);
  expect(resource.isFor(firstRoot, renderer._glProvider)).toBe(true);
});

function markGraphCommitted(root) {
  root.paintGroup().forEach((group) => {
    group.siblings().forEach((node) => {
      node.layout().setPhase(LayoutPhase.COMMITTED);
    });
  });
}

function progressRenderer(getRoot) {
  const renderer = Object.create(ViewportRendering.prototype);
  const camera = new Camera();
  camera.setSize(1000, 600);
  renderer._viewport = { widget: getRoot, camera: () => camera };
  renderer._phase = 0;
  renderer._cranks = 0;
  renderer._steps = [
    ["Painting graph", () => false, () => renderer.allNodeCount()],
    ["Rendering blocks", () => false, () => renderer.allPaintGroupCount()],
    ["Rendering text", () => false, () => renderer.allNodeCount()],
  ];
  renderer.resetCounts();
  jest.spyOn(renderer, "countGraph");
  return renderer;
}

test("camera redraws reuse graph counts while resetting pass progress", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  root.connect(Direction.FORWARD, child);
  child.paintGroups().crease();
  markGraphCommitted(root);
  const renderer = progressRenderer(() => root);

  expect(renderer.allNodeCount()).toBe(2);
  expect(renderer.allPaintGroupCount()).toBe(2);
  for (let frame = 1; frame <= 4; frame++) {
    renderer.camera().setOrigin(frame * 10, frame * 20);
    renderer.camera().setScale(1 + frame / 10);
    renderer._cranks = 3;
    renderer._startTime = 123;
    renderer.restart();
    expect(renderer.progress()).toBe(0);
    expect(renderer.cranksComplete()).toBe(0);
    expect(renderer._startTime).toBeNaN();
    expect(renderer.allNodeCount()).toBe(2);
    expect(renderer.allPaintGroupCount()).toBe(2);
  }
  expect(renderer.countGraph).toHaveBeenCalledTimes(1);
});

test("graph edits refresh counts before layout clears their dirty flags", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  root.connect(Direction.FORWARD, child);
  markGraphCommitted(root);
  const renderer = progressRenderer(() => root);
  expect(renderer.allNodeCount()).toBe(2);
  expect(renderer.allPaintGroupCount()).toBe(1);

  const verifyAfterEdit = (nodes, paintGroups) => {
    expect(root.layout().needsCommit()).toBe(true);
    renderer.restart();
    // Status can run after layout has already committed the changed graph.
    markGraphCommitted(root);
    expect(renderer.allNodeCount()).toBe(nodes);
    expect(renderer.allPaintGroupCount()).toBe(paintGroups);
  };

  const grandchild = new DirectionNode("grandchild");
  child.connect(Direction.DOWNWARD, grandchild);
  verifyAfterEdit(3, 1);
  child.paintGroups().crease();
  verifyAfterEdit(3, 2);
  child.paintGroups().uncrease();
  verifyAfterEdit(3, 1);
  grandchild.disconnect();
  verifyAfterEdit(2, 1);
  expect(renderer.countGraph).toHaveBeenCalledTimes(5);
});

test("switching between committed roots replaces the cached census", () => {
  const firstRoot = new DirectionNode("first");
  const child = new DirectionNode("child");
  firstRoot.connect(Direction.FORWARD, child);
  child.paintGroups().crease();
  const secondRoot = new DirectionNode("second");
  markGraphCommitted(firstRoot);
  markGraphCommitted(secondRoot);
  let currentRoot = firstRoot;
  const renderer = progressRenderer(() => currentRoot);
  expect(renderer.allNodeCount()).toBe(2);
  expect(renderer.allPaintGroupCount()).toBe(2);

  currentRoot = secondRoot;
  renderer.restart();
  expect(renderer.allNodeCount()).toBe(1);
  expect(renderer.allPaintGroupCount()).toBe(1);
  currentRoot = firstRoot;
  renderer.restart();
  expect(renderer.allNodeCount()).toBe(2);
  expect(renderer.allPaintGroupCount()).toBe(2);
  expect(renderer.countGraph).toHaveBeenCalledTimes(3);
});

test("an edit during an incomplete layout invalidates counts even without needsCommit on the root", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  root.connect(Direction.FORWARD, child);
  markGraphCommitted(root);
  const renderer = progressRenderer(() => root);
  expect(renderer.allNodeCount()).toBe(2);

  root.layout().setPhase(LayoutPhase.IN_COMMIT);
  child.layout().setPhase(LayoutPhase.NEEDS_COMMIT);
  child.connect(Direction.DOWNWARD, new DirectionNode("grandchild"));
  // Invalidation stops at the already dirty child, leaving the root mid-commit.
  expect(root.layout().phase()).toBe(LayoutPhase.IN_COMMIT);
  expect(root.layout().needsCommit()).toBe(false);
  renderer.restart();
  markGraphCommitted(root);
  expect(renderer.allNodeCount()).toBe(3);
  expect(renderer.allPaintGroupCount()).toBe(1);
  expect(renderer.countGraph).toHaveBeenCalledTimes(2);
});
