import Camera from "parsegraph-camera";
import ViewportRendering from "./ViewportRendering";
import DocumentFont from "./DocumentFont";
import { Direction, DirectionNode, LayoutPhase } from "parsegraph";
import { attachBenchmark, beginBenchmark, benchmarkFor, cancelBenchmark, getBenchmarkRuns } from "../../benchmark";

function node(x, scale = 1) {
  return { layout: () => ({
    absoluteX: () => x, absoluteY: () => 0, absoluteScale: () => scale,
    absoluteSize: (size) => { size[0] = 100 * scale; size[1] = 50 * scale; },
  }) };
}

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
