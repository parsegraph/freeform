import Viewport from "./Viewport";
import ViewportRendering from "./ViewportRendering";
import { cameraPose } from "./ViewportCameraTravel";
import { handleKeyDown } from "./handleKeyDown";
import { Direction } from "parsegraph";

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
  viewport.repaint = () => { viewport._ensureVisible = true; };
  viewport.camera().setSize(1000, 1000);
  viewport.camera().setOrigin(500, 500);
  viewport._showInCamera = false;
  viewport._checkScale = false;
  viewport._ensureVisible = false;
  renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = viewport;
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
  const original = viewport.node();
  let available = false;
  const node = { ...original, neighbors: () => ({ hasNode: () => available }) };
  const move = jest.fn();
  viewport.caret = () => ({ node: () => node, move });
  viewport.spawnMove = jest.fn();
  expect(viewport.moveToNeighbor(Direction.FORWARD)).toBe(false);
  expect(move).not.toHaveBeenCalled();
  available = true;
  expect(viewport.moveToNeighbor(Direction.FORWARD)).toBe(true);
  expect(move).toHaveBeenCalledWith(Direction.FORWARD);
  expect(viewport.spawnMove).not.toHaveBeenCalled();
  viewport.clearNodeSelection();
  expect(viewport.navigatingNodes()).toBe(false);
  expect(viewport._nodeNavigationRequested).toBe(false);
  expect(viewport.ensuringVisible()).toBe(false);
});
