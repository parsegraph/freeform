import { clearExampleSession, initialExampleSession, readExampleSession, watchExampleSession } from "./exampleSession";
import { createExample, loadExample } from "./examples";

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

test("Proportion columns persist through camera saves and reconstruct with the same recipe", async () => {
  const recipe = createExample("proportion_v1", { columns: 7 });
  stop = watchExampleSession(viewport, recipe);
  const saved = readExampleSession();
  expect(saved).toEqual({ example: { type: "proportion_v1", columns: 7 }, cam, showingUI: false });
  expect(initialExampleSession("")).toEqual(saved);
  expect((await loadExample(saved.example)).example).toEqual(recipe);
  expect(viewport.toJSON).not.toHaveBeenCalled();
});

test("out-of-range saved Proportion columns return to the chooser", () => {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, example: { type: "proportion_v1", columns: 201 }, cam }));
  expect(readExampleSession()).toBeNull();
  expect(initialExampleSession("")).toBeNull();
});

test("Primes refresh preserves its maximum and camera, but a changed maximum refits", async () => {
  const recipe = createExample("primes", { max: 12 });
  stop = watchExampleSession(viewport, recipe);
  const saved = { example: recipe, cam, showingUI: false };
  expect(initialExampleSession("")).toEqual(saved);
  expect(initialExampleSession("?sample=primes&max=12")).toEqual(saved);
  expect((await loadExample(readExampleSession().example)).example).toEqual(recipe);
  expect(initialExampleSession("?sample=primes&max=100")).toEqual({ example: { type: "primes", max: 100 } });
  expect(initialExampleSession("?sample=primes")).toEqual({ example: { type: "primes", max: 30 } });
  expect(initialExampleSession("?sample=primes&max=2310")).toEqual({ example: { type: "primes", max: 2310 } });
  expect(initialExampleSession(`?sample=primes&max=${Number.MAX_SAFE_INTEGER + 1}`)).toBeNull();
  expect(initialExampleSession("?document=/example.parsegraph&sample=primes&max=12")).toBeNull();
  expect(viewport.toJSON).not.toHaveBeenCalled();
});

test("implicit and explicit Primes defaults share their saved camera", () => {
  stop = watchExampleSession(viewport, createExample("primes"));
  expect(initialExampleSession("?sample=primes&max=30").cam).toEqual(cam);
  expect(initialExampleSession("?sample=primes").cam).toEqual(cam);
});

test("large Primes recipes restore their maximum and camera without a size cap", () => {
  const recipe = createExample("primes", { max: 2310 });
  stop = watchExampleSession(viewport, recipe);
  const saved = { example: recipe, cam, showingUI: false };
  expect(initialExampleSession("")).toEqual(saved);
  expect(initialExampleSession("?sample=primes&max=2310")).toEqual(saved);
  expect(viewport.toJSON).not.toHaveBeenCalled();
});

test("unsafe saved Primes maxima return to the chooser", () => {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, example: { type: "primes", max: Number.MAX_SAFE_INTEGER + 1 }, cam }));
  expect(initialExampleSession("")).toBeNull();
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
  expect(initialExampleSession("?document=/examples/colors.parsegraph&sample=grid_12")).toBeNull();
  expect(initialExampleSession("?document=")).toBeNull();
  expect(initialExampleSession("?sample=unknown")).toBeNull();
});

test("malformed storage falls back to the chooser; a bad camera still permits the example", () => {
  localStorage.setItem(KEY, "broken");
  expect(readExampleSession()).toBeNull();
  localStorage.setItem(KEY, JSON.stringify({ version: 1, example, cam: { ...cam, scale: -1 } }));
  expect(readExampleSession()).toEqual({ example, cam: null, showingUI: false });
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
