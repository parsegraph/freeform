import Viewport from "./Viewport";
import ViewportRendering from "./ViewportRendering";
import { cameraPose } from "./ViewportCameraTravel";
import { handleKeyDown } from "./handleKeyDown";

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
