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
    zoomToPoint: jest.fn(),
    setSize: jest.fn(),
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
    refreshCamera: jest.fn(),
    refreshOverlay: jest.fn(),
    checkScale: jest.fn(),
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

test("Enter starts structured value editing even while the UI is hidden", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.navigatingNodes = () => true;
  viewport.canEditStructuredValue = () => true;
  const event = key(canvas, "keydown", "Enter");
  expect(event.defaultPrevented).toBe(true);
  expect(viewport.toggleEditor).toHaveBeenCalledTimes(1);
});

test("Enter cannot reopen a stale structured selection after leaving View navigation", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.canEditStructuredValue = () => true;
  expect(key(canvas, "keydown", "Enter").defaultPrevented).toBe(false);
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
});

test("structured shortcuts run in View mode and stop an already moving camera", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.handleStructuredKey = jest.fn(() => false);
  key(canvas, "keydown", "ArrowRight");
  advance(200);
  expect(position[0]).toBeLessThan(0);
  const before = [...position];
  viewport.handleStructuredKey.mockReturnValue(true);
  const event = key(canvas, "keydown", ",");
  expect(viewport.handleStructuredKey).toHaveBeenLastCalledWith(event);
  expect(event.defaultPrevented).toBe(true);
  advance(200);
  expect(position).toEqual(before);
  expect(frames.size).toBe(0);
  expect(viewport.moveToNeighbor).not.toHaveBeenCalled();
});

test.each([false, true])("View-mode keyboard zoom works with node navigation = %s", (selected) => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.navigatingNodes = () => selected;
  viewport.zoomCamera = jest.fn();
  for (const value of ["+", "=", "-"]) {
    expect(key(canvas, "keydown", value).defaultPrevented).toBe(true);
  }
  expect(viewport.zoomCamera.mock.calls.map(([factor]) => factor)).toEqual([1.1, 1.1, 1 / 1.1]);
  expect(viewport.moveToNeighbor).not.toHaveBeenCalled();
});

test("structured minus input takes precedence over camera zoom", () => {
  viewport.handleStructuredKey = jest.fn(() => true);
  viewport.zoomCamera = jest.fn();
  expect(key(canvas, "keydown", "-").defaultPrevented).toBe(true);
  expect(viewport.zoomCamera).not.toHaveBeenCalled();
});

test("an unselected View-mode document keeps panning when its dispatcher declines a key", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.handleStructuredKey = jest.fn(() => false);
  viewport.navigatingNodes = () => false;
  const event = key(canvas, "keydown", "d");
  expect(viewport.handleStructuredKey).toHaveBeenCalledWith(event);
  expect(event.defaultPrevented).toBe(true);
  advance(200);
  expect(position[0]).toBeLessThan(0);
  expect(viewport.moveToNeighbor).not.toHaveBeenCalled();
});

test.each(["input", "textarea", "select", "contenteditable"])(
  "native %s editing does not reach graph shortcuts or camera movement",
  (type) => {
    viewport.handleStructuredKey = jest.fn(() => true);
    viewport.removeNode = jest.fn();
    viewport.zoomCamera = jest.fn();
    const field = document.createElement(type === "contenteditable" ? "div" : type);
    canvas.appendChild(field);
    let target = field;
    if (type === "contenteditable") {
      field.setAttribute("contenteditable", "true");
      target = document.createElement("span");
      field.appendChild(target);
    }
    for (const value of [",", "Backspace", "ArrowLeft", "Enter", "-"]) {
      expect(key(target, "keydown", value).defaultPrevented).toBe(false);
    }
    advance(200);
    expect(viewport.handleStructuredKey).not.toHaveBeenCalled();
    expect(viewport.removeNode).not.toHaveBeenCalled();
    expect(viewport.toggleEditor).not.toHaveBeenCalled();
    expect(viewport.zoomCamera).not.toHaveBeenCalled();
    expect(position).toEqual([0, 0]);
    expect(frames.size).toBe(0);
  }
);

test.each([
  ["composition", { isComposing: true }],
  ["legacy composition", { keyCode: 229 }],
  ["Control", { ctrlKey: true }],
  ["Meta", { metaKey: true }],
  ["Alt", { altKey: true }],
])("%s never reaches the structured dispatcher, generic commands, or camera", (_name, modifiers) => {
  viewport.handleStructuredKey = jest.fn(() => true);
  viewport.removeNode = jest.fn();
  viewport.zoomCamera = jest.fn();
  viewport.spawnMove = jest.fn();
  for (const value of [",", "Backspace", "ArrowRight", "Enter", "-", "w"]) {
    const event = key(canvas, "keydown", value, modifiers);
    if (modifiers.keyCode) expect(event.keyCode).toBe(229);
    if (modifiers.isComposing) expect(event.isComposing).toBe(true);
    expect(event.defaultPrevented).toBe(false);
  }
  advance(200);
  expect(viewport.handleStructuredKey).not.toHaveBeenCalled();
  expect(viewport.removeNode).not.toHaveBeenCalled();
  expect(viewport.toggleEditor).not.toHaveBeenCalled();
  expect(viewport.zoomCamera).not.toHaveBeenCalled();
  expect(viewport.spawnMove).not.toHaveBeenCalled();
  expect(position).toEqual([0, 0]);
  expect(frames.size).toBe(0);
});

test("holding Enter does not repeatedly toggle structured value editing", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  viewport.navigatingNodes = () => true;
  viewport.canEditStructuredValue = () => true;
  expect(key(canvas, "keydown", "Enter").defaultPrevented).toBe(true);
  expect(key(canvas, "keydown", "Enter", { repeat: true }).defaultPrevented).toBe(true);
  expect(key(canvas, "keydown", "Enter", { repeat: true }).defaultPrevented).toBe(true);
  expect(viewport.toggleEditor).toHaveBeenCalledTimes(1);
});

test("ordinary graphs retain comma as the keystroke display toggle", () => {
  viewport.input = () => input;
  viewport.logMessage = jest.fn();
  const keystrokes = input.keystrokes();
  jest.spyOn(keystrokes, "handleKey").mockImplementation(() => {});
  const before = keystrokes.showingKeystrokes();
  expect(key(canvas, "keydown", ",").defaultPrevented).toBe(true);
  expect(keystrokes.showingKeystrokes()).toBe(!before);
  expect(viewport.logMessage).toHaveBeenCalledWith("Toggling keystrokes");
  expect(viewport.refresh).toHaveBeenCalledTimes(1);
});

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
  expect(viewport.refreshCamera).toHaveBeenCalled();
  expect(viewport.refreshOverlay).toHaveBeenCalledTimes(1);
  expect(viewport.refresh).not.toHaveBeenCalled();
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
  expect(viewport.refreshCamera).toHaveBeenCalledTimes(1);
  expect(viewport.refresh).not.toHaveBeenCalled();
});

test.each([false, true])("unfinished layout suppresses mouse/touch hit tests while panning remains responsive (Edit %s)", (editing) => {
  let ready = false;
  const picked = {};
  const hit = jest.fn(() => picked);
  const moveTo = jest.fn();
  viewport.rendering = () => ({ showingUI: () => editing, layoutReady: () => ready });
  viewport.caret = () => ({
    root: () => ({ layout: () => ({ nodeUnderCoords: hit }) }),
    node: () => picked,
    moveTo,
  });
  mouse(canvas, "mousemove", 40, 0);
  mouse(canvas, "mousedown", 40);
  mouse(canvas, "mouseup", 40, 0);
  touch("touchstart", [[1, 40, 50]]);
  touch("touchend", [[1, 40, 50]]);
  expect(hit).not.toHaveBeenCalled();
  expect(moveTo).not.toHaveBeenCalled();
  expect(viewport.selectNode).not.toHaveBeenCalled();
  expect(viewport.clearNodeSelection).not.toHaveBeenCalled();
  expect(viewport.toggleEditor).not.toHaveBeenCalled();

  mouse(canvas, "mousedown", 40);
  advance(20);
  mouse(canvas, "mousemove", 60);
  mouse(canvas, "mouseup", 60, 0);
  expect(position[0]).toBeGreaterThan(0);
  expect(hit).not.toHaveBeenCalled();
  ready = true;
  mouse(canvas, "mousemove", 80, 0);
  expect(hit).toHaveBeenCalledTimes(1);
  expect(input.hoveredNode()).toBe(picked);
});

test("hover changes only refresh the overlay while a graph frame can finish", () => {
  const hovered = {};
  viewport.caret = () => ({
    root: () => ({ layout: () => ({ nodeUnderCoords: () => hovered }) }),
  });
  viewport.refreshOverlay.mockImplementation(() => {
    expect(input.hoveredNode()).toBe(hovered);
  });
  mouse(canvas, "mousemove", 20, 0);
  mouse(canvas, "mousemove", 30, 0);
  expect(input.hoveredNode()).toBe(hovered);
  expect(viewport.refreshOverlay).toHaveBeenCalledTimes(1);
  expect(viewport.refresh).not.toHaveBeenCalled();
  expect(viewport.refreshCamera).not.toHaveBeenCalled();
});

test("wheel zoom requests a camera update and scale check without restarting graph drawing", () => {
  mouse(canvas, "mousemove", 40, 0);
  const event = new WheelEvent("wheel", {
    deltaY: 100, deltaMode: 0, clientX: 40, clientY: 50,
    bubbles: true, cancelable: true,
  });
  canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(viewport.camera().zoomToPoint).toHaveBeenCalledWith(1 / 1.1, 40, 50);
  expect(viewport.refreshCamera).toHaveBeenCalledWith(true);
  expect(viewport.checkScale).not.toHaveBeenCalled();
  expect(viewport.refresh).not.toHaveBeenCalled();
});

test("mouse picking and wheel zoom use the bounded workspace origin", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 100, top: 20 });
  const node = {};
  const nodeUnderCoords = jest.fn((x, y) => x === 40 && y === 30 ? node : null);
  viewport.caret = () => ({ root: () => ({ layout: () => ({ nodeUnderCoords }) }) });
  mouse(canvas, "mousedown", 140);
  mouse(canvas, "mouseup", 140, 0);
  expect(viewport.selectNode).toHaveBeenCalledWith(node);
  canvas.dispatchEvent(new WheelEvent("wheel", {
    deltaY: 100, clientX: 140, clientY: 50, bubbles: true, cancelable: true,
  }));
  expect(viewport.camera().zoomToPoint).toHaveBeenCalledWith(1 / 1.1, 40, 30);
});

test("touch selection and pinch anchors use the bounded workspace origin", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  jest.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 100, top: 64 });
  const node = {};
  const nodeUnderCoords = jest.fn((x, y) => x === 40 && y === 30 ? node : null);
  viewport.caret = () => ({ root: () => ({ layout: () => ({ nodeUnderCoords }) }) });
  touch("touchstart", [[1, 140, 94]]);
  touch("touchend", [[1, 140, 94]]);
  expect(viewport.selectNode).toHaveBeenCalledWith(node);
  touch("touchstart", [[2, 100, 74], [3, 120, 74]]);
  touch("touchmove", [[3, 140, 74]]);
  expect(viewport.camera().zoomToPoint).toHaveBeenCalledWith(2, 20, 10);
});

test("pinch zoom coalesces camera updates without restarting graph drawing", () => {
  viewport.rendering = () => ({ showingUI: () => false });
  touch("touchstart", [[1, 0, 10], [2, 20, 10]]);
  touch("touchmove", [[2, 40, 10]]);
  expect(viewport.camera().zoomToPoint).toHaveBeenCalledWith(2, 20, 10);
  expect(viewport.refreshCamera).toHaveBeenCalledWith(true);
  expect(viewport.checkScale).not.toHaveBeenCalled();
  expect(viewport.refresh).not.toHaveBeenCalled();
});

test("resize still invalidates rendering instead of reusing the previous frame dimensions", () => {
  Object.defineProperties(canvas, {
    offsetWidth: { configurable: true, value: 800 },
    offsetHeight: { configurable: true, value: 600 },
  });
  window.ResizeObserver.mock.calls[0][0]();
  expect(viewport.camera().setSize).toHaveBeenCalledWith(canvas.offsetWidth, canvas.offsetHeight);
  expect(viewport.checkScale).toHaveBeenCalledTimes(1);
  expect(viewport.refreshCamera).not.toHaveBeenCalled();
});

test("opening an inspector keeps the same world point at the canvas center", () => {
  const camera = viewport.camera();
  camera.width = () => 800;
  camera.height = () => 600;
  camera.scale = () => 2;
  Object.defineProperties(canvas, {
    offsetWidth: { configurable: true, value: 500 },
    offsetHeight: { configurable: true, value: 400 },
  });
  window.ResizeObserver.mock.calls[0][0]();
  expect(position).toEqual([-75, -50]);
  expect(camera.setSize).toHaveBeenCalledWith(500, 400);
  expect(viewport.checkScale).toHaveBeenCalledTimes(1);
});

test("temporary zero-sized resize notifications preserve the camera until the viewport returns", () => {
  const resize = window.ResizeObserver.mock.calls[0][0];
  for (const [width, height] of [[0, 0], [800, 0], [0, 600]]) {
    Object.defineProperties(canvas, {
      offsetWidth: { configurable: true, value: width },
      offsetHeight: { configurable: true, value: height },
    });
    resize();
  }
  expect(viewport.camera().setSize).not.toHaveBeenCalled();
  expect(viewport.checkScale).not.toHaveBeenCalled();
  Object.defineProperties(canvas, {
    offsetWidth: { configurable: true, value: 800 },
    offsetHeight: { configurable: true, value: 600 },
  });
  resize();
  expect(viewport.camera().setSize).toHaveBeenCalledWith(800, 600);
  expect(viewport.checkScale).toHaveBeenCalledTimes(1);
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
