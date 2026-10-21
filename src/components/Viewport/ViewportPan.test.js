import ViewportPan from "./ViewportPan";

let time;
let frames;
let pan;
let position;
let scale;
let viewport;

beforeEach(() => {
  time = 0;
  frames = new Map();
  let nextFrame = 0;
  jest.spyOn(performance, "now").mockImplementation(() => time);
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
  position = [0, 0];
  scale = 1;
  viewport = {
    hasWidget: () => true,
    showingEditor: () => false,
    refresh: jest.fn(),
    camera: () => ({
      scale: () => scale,
      adjustOrigin: (x, y) => {
        position[0] += x;
        position[1] += y;
      },
    }),
  };
  pan = new ViewportPan(viewport);
});

afterEach(() => jest.restoreAllMocks());

function advance(ms, frameMs = 1000 / 60) {
  const end = time + ms;
  while (time < end) {
    time = Math.min(end, time + frameMs);
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }
}

test.each([
  ["ArrowLeft", 0, 1],
  ["ArrowRight", 0, -1],
  ["ArrowUp", 1, 1],
  ["ArrowDown", 1, -1],
])("%s moves the camera in the named direction without key repeats", (key, axis, sign) => {
  expect(pan.keyDown(key)).toBe(true);
  advance(200);
  const initialDistance = position[axis] * sign;
  expect(initialDistance).toBeGreaterThan(0);
  advance(200);
  expect(position[axis] * sign - initialDistance).toBeGreaterThan(initialDistance);
  expect(position[1 - axis]).toBe(0);
});

test("repeated keydown events do not change held-key speed", () => {
  pan.keyDown("ArrowRight");
  advance(100);
  for (let i = 0; i < 10; i++) pan.keyDown("ArrowRight");
  advance(100);
  const repeated = position[0];
  pan.stop();
  position = [0, 0];
  pan.keyDown("ArrowRight");
  advance(200);
  expect(position[0]).toBeCloseTo(repeated, 6);
});

test("release decelerates to rest and stops scheduling frames", () => {
  pan.keyDown("ArrowDown");
  advance(300);
  pan.keyUp("ArrowDown");
  const released = position[1];
  advance(100);
  const firstCoast = position[1] - released;
  const before = position[1];
  advance(100);
  expect(Math.abs(position[1] - before)).toBeLessThan(Math.abs(firstCoast));
  advance(1000);
  expect(frames.size).toBe(0);
  const stopped = [...position];
  advance(1000);
  expect(position).toEqual(stopped);
});

test("diagonal movement is no faster and opposing keys cancel", () => {
  pan.keyDown("ArrowRight");
  advance(300);
  const straight = Math.abs(position[0]);
  pan.stop();
  position = [0, 0];
  pan.keyDown("ArrowRight");
  pan.keyDown("ArrowDown");
  advance(300);
  expect(Math.hypot(...position)).toBeCloseTo(straight, 6);
  pan.stop();
  position = [0, 0];
  pan.keyDown("ArrowLeft");
  pan.keyDown("ArrowRight");
  advance(300);
  expect(position).toEqual([0, 0]);
});

test("movement is consistent across refresh rates and zoom levels", () => {
  pan.keyDown("ArrowRight");
  advance(500, 1000 / 60);
  const normal = position[0];
  pan.stop();
  position = [0, 0];
  scale = 0.25;
  pan.keyDown("ArrowRight");
  advance(500, 1000 / 144);
  expect(position[0] * scale).toBeCloseTo(normal, 6);
});

function drag() {
  pan.beginDrag();
  advance(20);
  pan.dragBy(20, 10);
  advance(20);
  pan.dragBy(20, 10);
}

test("a quick flick survives input events processed in the same clock tick", () => {
  // The browser can queue input while a graph frame is being rendered.
  time = 100;
  pan.beginDrag(10);
  pan.dragBy(20, 0, 20);
  pan.endDrag(25);
  advance(100);
  expect(position[0]).toBeGreaterThan(20);
});

test("equal movement timestamps still allow a bounded fling", () => {
  pan.beginDrag();
  pan.dragBy(20, 0);
  pan.endDrag();
  advance(100);
  expect(position[0]).toBeGreaterThan(20);
  expect(position[0]).toBeLessThan(260);
});

test("drag follows the pointer exactly, then coasts along its release direction", () => {
  scale = 2;
  drag();
  expect(position).toEqual([20, 10]);
  pan.endDrag();
  advance(100);
  expect(position[0]).toBeGreaterThan(20);
  expect(position[0]).toBeCloseTo(position[1] * 2);
  advance(1500);
  expect(frames.size).toBe(0);
});

test.each([100, 200, 300])("a brief %i ms pause still produces a glide", (pause) => {
  drag();
  advance(pause);
  // Some devices report stationary moves while the button remains held.
  pan.dragBy(0, 0);
  expect(position).toEqual([40, 20]);
  pan.endDrag();
  advance(100);
  expect(position[0]).toBeGreaterThan(45);
  advance(1500);
  expect(frames.size).toBe(0);
});

test("longer release pauses smoothly reduce the glide without an 80 ms cliff", () => {
  const distances = [0, 70, 90, 150, 300].map((pause) => {
    pan.stop();
    position = [0, 0];
    drag();
    advance(pause);
    pan.endDrag();
    advance(100);
    return position[0] - 40;
  });
  for (let i = 1; i < distances.length; i++) {
    expect(distances[i]).toBeGreaterThan(0);
    expect(distances[i]).toBeLessThan(distances[i - 1]);
  }
  expect(distances[2] / distances[1]).toBeGreaterThan(0.8);
});

test("a deliberate long pause before release prevents a fling", () => {
  drag();
  advance(1200);
  pan.endDrag();
  advance(300);
  expect(position).toEqual([40, 20]);
  expect(frames.size).toBe(0);
});

test("a drag with sparse movement events still glides", () => {
  pan.beginDrag();
  advance(100);
  pan.dragBy(60, 0);
  advance(100);
  pan.dragBy(60, 0);
  pan.endDrag();
  advance(100);
  expect(position[0]).toBeGreaterThan(120);
});

test("a new drag immediately stops existing motion", () => {
  pan.keyDown("ArrowLeft");
  advance(100);
  pan.beginDrag();
  const before = [...position];
  advance(300);
  expect(position).toEqual(before);
  pan.endDrag();
  expect(frames.size).toBe(0);
});

test("cancellation clears held keys and pending animation", () => {
  pan.keyDown("ArrowLeft");
  advance(100);
  pan.stop();
  const before = [...position];
  advance(300);
  expect(position).toEqual(before);
  expect(frames.size).toBe(0);
  expect(pan.keyDown("Enter")).toBe(false);
});

test.each(["hasWidget", "showingEditor"])("animation stops when %s changes", (method) => {
  pan.keyDown("ArrowRight");
  advance(100);
  viewport[method] = () => method === "showingEditor";
  const before = [...position];
  advance(100);
  expect(position).toEqual(before);
  expect(frames.size).toBe(0);
});
