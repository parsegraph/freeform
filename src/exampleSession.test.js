import { clearExampleSession, initialExampleSession, readExampleSession, watchExampleSession } from "./exampleSession";

const KEY = "parsegraph-example-session";
const example = { type: "grid", size: 12 };
const cam = { cameraX: -42, cameraY: 83, scale: 0.75 };
let viewport;
let stop;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  viewport = {
    hasWidget: () => true,
    showingInCamera: () => false,
    checkingScale: () => false,
    camera: () => ({ toJSON: () => cam }),
    rendering: () => ({ showingUI: () => false }),
    toJSON: jest.fn(() => { throw new Error("Do not serialize the graph for a camera save"); }),
  };
});

afterEach(() => {
  stop?.();
  stop = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test("restores only the original example recipe, camera, and View mode", () => {
  stop = watchExampleSession(viewport, example);
  expect(initialExampleSession("")).toEqual({ example, cam, showingUI: false });
  expect(viewport.toJSON).not.toHaveBeenCalled();
  expect(Object.keys(JSON.parse(localStorage.getItem(KEY))).sort()).toEqual(["cam", "example", "showingUI", "version"]);
});

test("camera movement saves periodically and the final position flushes on pagehide", () => {
  stop = watchExampleSession(viewport, example);
  const moved = { ...cam, cameraX: 123 };
  viewport.camera = () => ({ toJSON: () => moved });
  jest.advanceTimersByTime(500);
  expect(readExampleSession().cam).toEqual(moved);
  moved.scale = 2;
  window.dispatchEvent(new Event("pagehide"));
  expect(readExampleSession().cam.scale).toBe(2);
});

test("waits for the first camera fit and avoids writing unchanged views", () => {
  const write = jest.spyOn(Storage.prototype, "setItem");
  viewport.showingInCamera = () => true;
  stop = watchExampleSession(viewport, example);
  jest.advanceTimersByTime(500);
  expect(write).not.toHaveBeenCalled();
  viewport.showingInCamera = () => false;
  jest.advanceTimersByTime(1500);
  expect(write).toHaveBeenCalledTimes(1);
});

test("switching to a file clears the remembered example and stops later writes", () => {
  stop = watchExampleSession(viewport, example);
  stop();
  clearExampleSession();
  jest.advanceTimersByTime(1000);
  window.dispatchEvent(new Event("pagehide"));
  expect(readExampleSession()).toBeNull();
});

test("explicit example links override another saved example; public links do not restore it", () => {
  stop = watchExampleSession(viewport, example);
  expect(initialExampleSession("?sample=cross_3")).toEqual({ example: { type: "cross", rounds: 3 } });
  expect(initialExampleSession("?sample=grid_12").cam).toEqual(cam);
  expect(initialExampleSession("?public=room")).toBeNull();
  expect(initialExampleSession("?sample=unknown")).toBeNull();
});

test("malformed storage falls back to the chooser; a bad camera still permits the example", () => {
  localStorage.setItem(KEY, "broken");
  expect(readExampleSession()).toBeNull();
  localStorage.setItem(KEY, JSON.stringify({ version: 1, example, cam: { ...cam, scale: -1 } }));
  expect(readExampleSession()).toEqual({ example, cam: null, showingUI: true });
  localStorage.setItem(KEY, JSON.stringify({ version: 1, example: { type: "unknown" } }));
  expect(readExampleSession()).toBeNull();
});

test("unavailable browser storage never prevents navigation", () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
  expect(readExampleSession()).toBeNull();
  expect(() => { stop = watchExampleSession(viewport, example); }).not.toThrow();
  jest.advanceTimersByTime(1000);
});
