import ViewportInput from "./ViewportInput";

jest.mock("parsegraph", () => ({ Direction: {} }));

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

function key(target, type, value) {
  const event = new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function mouse(target, type, x, buttons = 1) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true, clientX: x, clientY: 50, button: 0, buttons,
  }));
}

test("held arrows move smoothly and keyup outside the canvas releases them", () => {
  expect(key(canvas, "keydown", "ArrowRight").defaultPrevented).toBe(true);
  advance(200);
  expect(position[0]).toBeLessThan(0);
  key(window, "keyup", "ArrowRight");
  advance(1500);
  expect(frames.size).toBe(0);
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
