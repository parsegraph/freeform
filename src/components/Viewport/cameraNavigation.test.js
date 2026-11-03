import Viewport from "./Viewport";
import ViewportRendering from "./ViewportRendering";
import { cameraPose } from "./ViewportCameraTravel";
import { handleKeyDown } from "./handleKeyDown";
import { Bidi, CommitLayout, Direction, DirectionCaret, DirectionNode, LayoutPhase } from "parsegraph";

let viewport, renderer, frames, time;
beforeEach(() => {
  time = 0;
  frames = new Map();
  let id = 0;
  jest.spyOn(performance, "now").mockImplementation(() => time);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.set(++id, cb); return id;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
  viewport = new Viewport();
  const layout = {
    phase: () => LayoutPhase.COMMITTED,
    absoluteX: () => 0, absoluteY: () => 0, absoluteScale: () => 1,
    absoluteSize: (size) => { size[0] = 100; size[1] = 100; },
    extentSize: (size) => { size[0] = 10000; size[1] = 10000; },
  };
  const node = { layout: () => layout };
  viewport.caret = () => ({ node: () => node });
  viewport.widget = () => node;
  viewport.hasWidget = () => true;
  viewport._input = { stopPan: jest.fn() };
  viewport.refresh = jest.fn();
  viewport.scheduleRender = jest.fn();
  viewport.repaint = () => { viewport._ensureVisible = true; };
  viewport.camera().setSize(1000, 1000);
  viewport.camera().setOrigin(500, 500);
  viewport._showInCamera = false;
  viewport._checkScale = false;
  viewport._ensureVisible = false;
  renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = viewport;
  renderer.isDone = () => false;
  viewport._rendering = renderer;
  renderer.focusCamera();
});
afterEach(() => jest.restoreAllMocks());

function advance(ms) {
  time += ms;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
}

test("keyboard zoom works without a mouse position, tweens, and accumulates repeated presses", () => {
  handleKeyDown(viewport, "+", NaN, NaN, {});
  handleKeyDown(viewport, "+", NaN, NaN, {});
  expect(viewport.camera().scale()).toBe(1);
  renderer.focusCamera();
  expect(viewport.cameraTravel().destinationScale()).toBeCloseTo(1.21);
  advance(100);
  expect(viewport.camera().scale()).toBeGreaterThan(1);
  expect(viewport.camera().scale()).toBeLessThan(1.21);
  advance(5000);
  const pose = cameraPose(viewport.camera());
  expect(pose.scale).toBeCloseTo(1.21);
  expect(pose.x).toBeCloseTo(0, 3);
  expect(pose.y).toBeCloseTo(0, 3);
});

test.each([1.1, 1 / 1.1])("repeating keyboard zoom (%s) keeps up while the key is held", (factor) => {
  // 30 Hz repeat: a long ease-in restarted at every key event barely moves.
  for (let i = 0; i < 30; i++) {
    viewport.zoomCamera(factor);
    renderer.focusCamera();
    advance(1000 / 30);
  }
  const requestedLogScale = Math.log(factor) * 30;
  expect(Math.log(viewport.camera().scale()) / requestedLogScale).toBeGreaterThan(0.9);
  advance(150);
  expect(viewport.camera().scale()).toBeCloseTo(factor ** 30);
  expect(viewport.cameraTravel().active()).toBe(false);
  expect(viewport.refresh).not.toHaveBeenCalled();
});

test("Re-center starts a transition and ends at the selected node", () => {
  viewport.camera().setOrigin(-1500, 500);
  viewport.showInCamera();
  renderer.focusCamera();
  expect(cameraPose(viewport.camera()).x).toBe(2000);
  expect(viewport.cameraTravel().active()).toBe(true);
  advance(100);
  expect(cameraPose(viewport.camera()).x).toBeLessThan(2000);
  advance(5000);
  expect(cameraPose(viewport.camera()).x).toBeCloseTo(0);
});

test("selecting the current node enables navigation and smoothly centers it", () => {
  viewport.camera().setOrigin(-1500, 500);
  expect(viewport.navigatingNodes()).toBe(false);
  const node = viewport.node();
  const moveTo = jest.fn();
  viewport.caret = () => ({ node: () => node, moveTo });
  viewport.selectNode(node);
  expect(viewport.navigatingNodes()).toBe(true);
  expect(moveTo).toHaveBeenCalledWith(node);
  renderer.focusCamera();
  expect(viewport.cameraTravel().active()).toBe(true);
  advance(5000);
  expect(cameraPose(viewport.camera()).x).toBeCloseTo(0);
});

test("neighbor navigation never spawns nodes and clearing selection cancels queued focus", () => {
  const node = new DirectionNode("root");
  const caret = new DirectionCaret(node);
  const move = jest.spyOn(caret, "move");
  viewport.caret = () => caret;
  viewport.spawnMove = jest.fn();
  expect(viewport.moveToNeighbor(Direction.FORWARD)).toBe(false);
  expect(move).not.toHaveBeenCalled();
  node.connect(Direction.FORWARD, new DirectionNode("child"));
  expect(viewport.moveToNeighbor(Direction.FORWARD)).toBe(true);
  expect(move).toHaveBeenCalledWith(Direction.FORWARD);
  expect(viewport.spawnMove).not.toHaveBeenCalled();
  viewport.clearNodeSelection();
  expect(viewport.navigatingNodes()).toBe(false);
  expect(viewport._nodeNavigationRequested).toBe(false);
  expect(viewport.ensuringVisible()).toBe(false);
});

function commitDirections(root, defaultDirection) {
  const job = new CommitLayout(root, {
    size: (node, out) => { out[0] = 30; out[1] = 20; },
    getSeparation: () => 10,
  }, defaultDirection);
  while (job.crank()) {}
  viewport.widget = () => root;
  renderer._completedLayoutRoot = root;
  renderer._completedLayoutRevision = renderer._revision;
}

test.each([Bidi.LTR, Bidi.RTL])("screen navigation respects inherited %s flow and the parent's side at a bidi boundary", (direction) => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("opposite context");
  root.connect(Direction.FORWARD, child);
  child.setBidi(direction === Bidi.LTR ? Bidi.RTL : Bidi.LTR);
  const caret = new DirectionCaret(root);
  viewport.caret = () => caret;
  commitDirections(root, direction);
  const forward = direction === Bidi.RTL ? Direction.BACKWARD : Direction.FORWARD;
  const back = direction === Bidi.RTL ? Direction.FORWARD : Direction.BACKWARD;
  expect(viewport.moveToNeighbor(back)).toBe(false);
  expect(viewport.moveToNeighbor(forward)).toBe(true);
  expect(viewport.node()).toBe(child);
  expect(viewport.moveToNeighbor(back)).toBe(true);
  expect(viewport.node()).toBe(root);
  expect(root.bidi()).toBe(Bidi.INHERIT);
  expect(root.neighbors().nodeAt(Direction.FORWARD)).toBe(child);
});

test("navigation resolves changed declarations before relayout instead of using the previous direction", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("child");
  root.connect(Direction.FORWARD, child);
  viewport.caret = () => caret;
  const caret = new DirectionCaret(root);
  commitDirections(root, Bidi.LTR);
  root.setBidi(Bidi.RTL);
  expect(root.effectiveBidi()).toBe(Bidi.LTR);
  expect(viewport.moveToNeighbor(Direction.FORWARD)).toBe(false);
  expect(viewport.moveToNeighbor(Direction.BACKWARD)).toBe(true);
  expect(viewport.node()).toBe(child);
});

test("opposite-context neighbors on the same physical side choose the nearer visible node", () => {
  const root = new DirectionNode("root");
  const child = new DirectionNode("RTL");
  const inner = new DirectionNode("inner");
  root.connect(Direction.FORWARD, child);
  child.setBidi(Bidi.RTL);
  child.connect(Direction.FORWARD, inner);
  commitDirections(root, Bidi.LTR);
  expect(root.layout().absoluteX()).toBeLessThan(inner.layout().absoluteX());
  expect(inner.layout().absoluteX()).toBeLessThan(child.layout().absoluteX());
  const caret = new DirectionCaret(root);
  caret.moveTo(child);
  viewport.caret = () => caret;
  expect(viewport.moveToNeighbor(Direction.BACKWARD)).toBe(true);
  expect(viewport.node()).toBe(inner);
});
