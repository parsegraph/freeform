import ViewportInput from "./ViewportInput";
import { Direction } from "parsegraph";

jest.mock("parsegraph", () => ({ Direction: {
  UPWARD: "up", DOWNWARD: "down", BACKWARD: "left", FORWARD: "right",
} }));

let canvas;
let input;
let viewport;
let position;
let frames;
let time;

beforeEach(() => {
  time = 0;
  frames = new Map();
  let id = 0;
  jest.spyOn(performance, "now").mockImplementation(() => time);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++id, callback);
    return id;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => frames.delete(frame));
  window.ResizeObserver = jest.fn(() => ({ observe: jest.fn() }));
  canvas = document.createElement("div");
  document.body.appendChild(canvas);
  const carousel = document.createElement("div");
  const node = {};
  const root = { layout: () => ({ nodeUnderCoords: () => null }) };
  position = [0, 0];
  const cam = {
    scale: () => 1,
    transform: (x, y) => [x, y],
    adjustOrigin: (x, y) => {
      position[0] += x;
      position[1] += y;
    },
  };
  viewport = {
    container: () => canvas,
    carouselContainer: () => carousel,
    hasWidget: () => true,
    showingEditor: () => false,
    rendering: () => ({ showingUI: () => true }),
    caret: () => ({ root: () => root, node: () => node }),
    camera: () => cam,
    refresh: jest.fn(),
    hideEditor: jest.fn(),
    toggleEditor: jest.fn(),
    repaint: jest.fn(),
    navigatingNodes: () => false,
    selectNode: jest.fn(),
    clearNodeSelection: jest.fn(),
    moveToNeighbor: jest.fn(),
  };
  input = new ViewportInput(viewport);
});

afterEach(() => {
  input.unmount();
  canvas.remove();
  delete window.ResizeObserver;
  jest.restoreAllMocks();
});

function advance(ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    time += 10;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }
}

function key(target, type, value, modifiers = {}) {
  const event = new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

function mouse(target, type, x, buttons = 1) {
  const event = new MouseEvent(type, {
    bubbles: true, clientX: x, clientY: 50, button: 0, buttons,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event);
}

function touch(type, points) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", { value: points.map(([identifier, x, y]) => ({
    identifier, clientX: x, clientY: y,
  })) });
  Object.defineProperty(event, "timeStamp", { value: time });
  canvas.dispatchEvent(event);
}

test("a fast flick reported at mouseup pans and glides without waiting for grace", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  mouse(canvas, "mousedown", 10);
  advance(10);
  mouse(canvas, "mouseup", 40, 0);
  expect(position).toEqual([30, 0]);
  advance(100);
  expect(position[0]).toBeGreaterThan(30);
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
});

test("a released-button move before mouseup preserves the flick", () => {
  mouse(canvas, "mousedown", 10);
  advance(10);
  mouse(canvas, "mousemove", 40);
  advance(10);
  mouse(canvas, "mousemove", 50, 0);
  expect(position).toEqual([30, 0]);
  mouse(canvas, "mouseup", 50, 0);
  advance(100);
  expect(position[0]).toBeGreaterThan(30);
});

test("a click without movement never starts a glide", () => {
  mouse(canvas, "mousedown", 10);
  advance(10);
  mouse(canvas, "mouseup", 10, 0);
  advance(100);
  expect(position).toEqual([0, 0]);
  expect(frames.size).toBe(0);
});

test("clicking a neighboring node requests camera focus instead of only redrawing", () => {
  const layout = {
    absoluteX: () => 40, absoluteY: () => 50,
    absoluteSize: (size) => { size[0] = 10; size[1] = 10; },
  };
  const neighbor = {
    layout: () => layout,
    neighbors: () => ({ hasAncestor: () => false }),
  };
  const car = {
    root: () => ({ layout: () => ({ nodeUnderCoords: () => neighbor }) }),
    node: () => ({}), moveTo: jest.fn(),
  };
  viewport.caret = () => car;
  viewport.camera().containsAll = () => true;
  viewport.repaint = jest.fn();
  mouse(canvas, "mousedown", 40);
  mouse(canvas, "mouseup", 40, 0);
  expect(car.moveTo).toHaveBeenCalledWith(neighbor);
  expect(viewport.repaint).toHaveBeenCalledTimes(1);
});

test("held arrows move smoothly and keyup outside the canvas releases them", () => {
  expect(key(canvas, "keydown", "ArrowRight").defaultPrevented).toBe(true);
  advance(200);
  expect(position[0]).toBeLessThan(0);
  key(window, "keyup", "ArrowRight");
  advance(1500);
  expect(frames.size).toBe(0);
});

test.each([
  ["ArrowLeft", 0, 1],
  ["ArrowRight", 0, -1],
  ["ArrowUp", 1, 1],
  ["ArrowDown", 1, -1],
])("View mode allows %s navigation", (value, axis, sign) => {
  viewport.rendering = () => ({ showingUI: () => false });
  expect(key(canvas, "keydown", value).defaultPrevented).toBe(true);
  advance(200);
  expect(position[axis] * sign).toBeGreaterThan(0);
  key(window, "keyup", value);
  advance(1500);
  expect(frames.size).toBe(0);
});

test("View mode continues to block editing shortcuts", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.removeNode = jest.fn();
  expect(key(canvas, "keydown", "Backspace").defaultPrevented).toBe(false);
  expect(key(canvas, "keydown", "Enter").defaultPrevented).toBe(false);
  expect(viewport.removeNode).not.toHaveBeenCalled();
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
});

test.each([
  ["w", Direction.UPWARD], ["a", Direction.BACKWARD],
  ["s", Direction.DOWNWARD], ["d", Direction.FORWARD],
  ["ArrowUp", Direction.UPWARD], ["ArrowLeft", Direction.BACKWARD],
  ["ArrowDown", Direction.DOWNWARD], ["ArrowRight", Direction.FORWARD],
])("View mode %s follows neighbors after selection without panning", (value, direction) => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.navigatingNodes = () => true;
  viewport.spawnMove = jest.fn();
  expect(key(canvas, "keydown", value).defaultPrevented).toBe(true);
  advance(200);
  expect(viewport.moveToNeighbor).toHaveBeenCalledWith(direction);
  expect(position).toEqual([0, 0]);
  expect(viewport.spawnMove).not.toHaveBeenCalled();
});

test("Escape stops following nodes and returns arrows to panning", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  let navigating = true;
  viewport.navigatingNodes = () => navigating;
  viewport.clearNodeSelection.mockImplementation(() => { navigating = false; });
  key(canvas, "keydown", "ArrowRight");
  expect(viewport.moveToNeighbor).toHaveBeenCalledTimes(1);
  expect(key(canvas, "keydown", "Escape").defaultPrevented).toBe(true);
  key(canvas, "keydown", "ArrowRight");
  advance(200);
  expect(position[0]).toBeLessThan(0);
  expect(viewport.moveToNeighbor).toHaveBeenCalledTimes(1);
});

test("View-mode mouse clicks select nodes without opening the editor", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  const node = {};
  viewport.caret = () => ({ root: () => ({ layout: () => ({ nodeUnderCoords: () => node }) }) });
  mouse(canvas, "mousedown", 40);
  mouse(canvas, "mouseup", 40, 0);
  expect(viewport.selectNode).toHaveBeenCalledWith(node);
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
});

test("View-mode touch taps select on release, while drags only pan", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  const node = {};
  viewport.caret = () => ({ root: () => ({ layout: () => ({ nodeUnderCoords: () => node }) }) });
  touch("touchstart", [[1, 40, 50]]);
  expect(viewport.selectNode).not.toHaveBeenCalled();
  advance(20);
  touch("touchend", [[1, 40, 50]]);
  expect(viewport.selectNode).toHaveBeenCalledWith(node);
  viewport.selectNode.mockClear();
  touch("touchstart", [[2, 40, 50]]);
  touch("touchmove", [[2, 70, 50]]);
  touch("touchend", [[2, 70, 50]]);
  expect(position).toEqual([30, 0]);
  expect(viewport.selectNode).not.toHaveBeenCalled();
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
});

test("a pinch or canceled touch never selects a node", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  const node = {};
  viewport.caret = () => ({ root: () => ({ layout: () => ({ nodeUnderCoords: () => node }) }) });
  touch("touchstart", [[1, 40, 50]]);
  touch("touchstart", [[2, 80, 50]]);
  touch("touchend", [[2, 80, 50]]);
  touch("touchend", [[1, 40, 50]]);
  touch("touchstart", [[3, 40, 50]]);
  touch("touchcancel", [[3, 40, 50]]);
  touch("touchend", [[3, 40, 50]]);
  expect(viewport.selectNode).not.toHaveBeenCalled();
});

test.each([
  ["w", "ArrowUp"], ["a", "ArrowLeft"],
  ["s", "ArrowDown"], ["d", "ArrowRight"],
])("View mode %s pans exactly like %s", (letter, arrow) => {
  viewport.rendering = () => ({ showingUI: () => false });
  expect(key(canvas, "keydown", letter).defaultPrevented).toBe(true);
  advance(200);
  key(window, "keyup", letter);
  advance(1500);
  const wasdPosition = [...position];
  expect(frames.size).toBe(0);
  position = [0, 0];
  key(canvas, "keydown", arrow);
  advance(200);
  key(window, "keyup", arrow);
  advance(1500);
  expect(position[0]).toBeCloseTo(wasdPosition[0], 6);
  expect(position[1]).toBeCloseTo(wasdPosition[1], 6);
});

test("WASD aliases release independently of arrows and do not skew diagonals", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  key(canvas, "keydown", "w");
  key(canvas, "keydown", "ArrowUp");
  key(canvas, "keydown", "d");
  advance(200);
  expect(position[1]).toBeCloseTo(-position[0], 6);
  key(window, "keyup", "w");
  key(window, "keyup", "d");
  advance(1500);
  expect(frames.size).toBe(1);
  key(window, "keyup", "ArrowUp");
  advance(1500);
  expect(frames.size).toBe(0);
});

test("uppercase WASD releases even if Shift is released first", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  key(canvas, "keydown", "W", { shiftKey: true });
  advance(200);
  expect(position[1]).toBeGreaterThan(0);
  key(window, "keyup", "w");
  advance(1500);
  expect(frames.size).toBe(0);
});

test.each(["ctrlKey", "metaKey", "altKey"])("View mode preserves %s shortcuts", (modifier) => {
  viewport.rendering = () => ({ showingUI: () => false });
  expect(key(canvas, "keydown", "w", { [modifier]: true }).defaultPrevented).toBe(false);
  advance(200);
  expect(position).toEqual([0, 0]);
});

test.each([
  ["w", Direction.UPWARD], ["a", Direction.BACKWARD],
  ["s", Direction.DOWNWARD], ["d", Direction.FORWARD],
])("Edit mode keeps %s as a node editing shortcut", (letter, direction) => {
  viewport.spawnMove = jest.fn();
  key(canvas, "keydown", letter);
  advance(200);
  expect(viewport.spawnMove).toHaveBeenCalledWith(direction, false, true);
  expect(position).toEqual([0, 0]);
});

test("WASD is not intercepted while editing text", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.showingEditor = () => true;
  expect(key(canvas, "keydown", "w").defaultPrevented).toBe(false);
  advance(200);
  expect(position).toEqual([0, 0]);
});

test("navigation requires a loaded graph even in View mode", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.hasWidget = () => false;
  expect(key(canvas, "keydown", "ArrowLeft").defaultPrevented).toBe(false);
  advance(200);
  expect(position).toEqual([0, 0]);
});

test("dragging outside the canvas continues, releases, and does not select a node", () => {
  mouse(canvas, "mousedown", 10);
  advance(20);
  mouse(window, "mousemove", 30);
  advance(20);
  mouse(window, "mousemove", 50);
  expect(position).toEqual([40, 0]);
  mouse(window, "mouseup", 50, 0);
  advance(100);
  expect(position[0]).toBeGreaterThan(40);
  expect(viewport.hideEditor).not.toHaveBeenCalled();
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
  advance(1500);
  expect(frames.size).toBe(0);
});

test("a drag released over the canvas also suppresses click behavior", () => {
  mouse(canvas, "mousedown", 10);
  advance(20);
  mouse(canvas, "mousemove", 30);
  mouse(canvas, "mouseup", 30, 0);
  expect(viewport.hideEditor).not.toHaveBeenCalled();
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
});

test.each(["blur", "focusout"])("%s stops movement and clears held keys", (type) => {
  key(canvas, "keydown", "ArrowDown");
  advance(200);
  const before = [...position];
  (type === "blur" ? window : document.body).dispatchEvent(new Event(type));
  advance(200);
  expect(position).toEqual(before);
  expect(frames.size).toBe(0);
});

test("returning after a missed mouseup does not drag the graph", () => {
  mouse(canvas, "mousedown", 10);
  advance(20);
  mouse(canvas, "mousemove", 30);
  advance(1200);
  mouse(canvas, "mousemove", 100, 0);
  advance(200);
  expect(position).toEqual([20, 0]);
  expect(frames.size).toBe(0);
});

test("editor focus leaves arrow keys available for text editing", () => {
  viewport.showingEditor = () => true;
  expect(key(canvas, "keydown", "ArrowLeft").defaultPrevented).toBe(false);
  advance(200);
  expect(position).toEqual([0, 0]);
});

test("unmount cancels movement and removes navigation listeners", () => {
  key(canvas, "keydown", "ArrowRight");
  advance(200);
  input.unmount();
  const before = [...position];
  key(canvas, "keydown", "ArrowLeft");
  mouse(canvas, "mousedown", 10);
  mouse(window, "mousemove", 30);
  advance(200);
  expect(position).toEqual(before);
  expect(frames.size).toBe(0);
});
