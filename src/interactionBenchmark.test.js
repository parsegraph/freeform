let benchmark;
let time;
let frames;
let frameId;
let originalRaf;
let originalCancelRaf;
let originalObserver;

function frameAt(at) {
  time = at;
  const callbacks = Array.from(frames.values());
  frames.clear();
  callbacks.forEach((callback) => callback(at));
}

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers();
  time = 100;
  jest.spyOn(performance, "now").mockImplementation(() => time);
  window.history.replaceState({}, "", "/?benchmark=1");
  originalRaf = global.requestAnimationFrame;
  originalCancelRaf = global.cancelAnimationFrame;
  originalObserver = global.PerformanceObserver;
  frames = new Map();
  frameId = 0;
  global.requestAnimationFrame = jest.fn((callback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  global.cancelAnimationFrame = jest.fn((id) => frames.delete(id));
  global.PerformanceObserver = undefined;
  benchmark = require("./interactionBenchmark");
});

afterEach(() => {
  benchmark.stopInteractionBenchmark();
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.requestAnimationFrame = originalRaf;
  global.cancelAnimationFrame = originalCancelRaf;
  global.PerformanceObserver = originalObserver;
  window.history.replaceState({}, "", "/");
});

test("normal sessions create no collectors and wrappers preserve values and errors", () => {
  window.history.replaceState({}, "", "/");
  const listen = jest.spyOn(document, "addEventListener");
  const value = {};
  const error = new Error("same error");
  expect(benchmark.startInteractionBenchmark()).toBeUndefined();
  expect(benchmark.interactionRecording()).toBe(false);
  benchmark.recordInteraction("slice", { durationMs: 12 });
  expect(benchmark.measureInteraction("draw", () => value)).toBe(value);
  expect(benchmark.recordInteractionGroup({}, "draw", () => value)).toBe(value);
  expect(() =>
    benchmark.recordInteractionGroup({}, "draw", () => {
      throw error;
    })
  ).toThrow(error);
  expect(benchmark.getInteractionBenchmark()).toBeUndefined();
  expect(benchmark.getInteractionEvents()).toEqual([]);
  expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
});

test("timings measure nested self time and preserve thrown errors", () => {
  benchmark.startInteractionBenchmark();
  const error = new Error("draw failed");
  const result = {};
  expect(
    benchmark.measureInteraction("slice", () => {
      time += 2;
      expect(() =>
        benchmark.measureInteraction("draw", () => {
          time += 4;
          throw error;
        })
      ).toThrow(error);
      time += 3;
      return result;
    })
  ).toBe(result);
  const run = benchmark.stopInteractionBenchmark();
  expect(run.detailedTiming).toBe(true);
  expect(run.stages).toEqual([
    { name: "draw", calls: 1, totalMs: 4, selfMs: 4, maxMs: 4 },
    { name: "slice", calls: 1, totalMs: 9, selfMs: 5, maxMs: 9 },
  ]);
});

test("counts-only captures omit per-stage and group timers while retaining events and responsiveness", () => {
  benchmark.startInteractionBenchmark({ detailedTiming: false });
  const pg = {};
  const value = {};
  const error = new Error("same error");
  performance.now.mockClear();
  expect(
    benchmark.measureInteraction("draw", () =>
      benchmark.recordInteractionGroup(pg, "draw", () => value)
    )
  ).toBe(value);
  expect(() =>
    benchmark.recordInteractionGroup(pg, "draw", () => {
      throw error;
    })
  ).toThrow(error);
  benchmark.recordInteractionGroup(pg, "repaint", () => {});
  expect(performance.now).not.toHaveBeenCalled();

  benchmark.recordInteraction("slice", { durationMs: 12, more: true });
  benchmark.recordInteraction("restart", { phase: 3, blocksVisited: 10 });
  benchmark.recordInteraction("clear", { pass: 2 });
  benchmark.recordInteraction("pass-complete", { pass: 2 });
  frameAt(170);
  const run = benchmark.stopInteractionBenchmark();
  expect(run).toMatchObject({
    detailedTiming: false,
    stages: [],
    eventCounts: { slice: 1, restart: 1, clear: 1, "pass-complete": 1 },
    responsiveness: { frames: 1, maxFrameGapMs: 70, frameGapsOver50Ms: 1 },
    groups: {
      observed: 1,
      totals: {
        draw: { calls: 2, totalMs: null, maxMs: null },
        repaint: { calls: 1, totalMs: null, maxMs: null },
      },
      heavy: [
        {
          id: 1,
          draw: { calls: 2, totalMs: null, maxMs: null },
          repaint: { calls: 1, totalMs: null, maxMs: null },
          drawsPerRepaint: 2,
        },
      ],
      rankedBy: "calls",
    },
  });
  expect(benchmark.getInteractionEvents()[0]).toMatchObject({
    type: "begin",
    detailedTiming: false,
  });
  expect(benchmark.getInteractionEvents().at(-1)).toMatchObject({
    type: "end",
    summary: { detailedTiming: false, stages: [] },
  });
});

test("groups have capture-local identities, accurate draw/repaint totals, and no graph payload", () => {
  class GraphNode {
    constructor() {
      this.privateText = "not in the trace";
    }
  }
  const first = new GraphNode();
  const second = new GraphNode();
  benchmark.startInteractionBenchmark({ label: "Cross 11" });
  benchmark.recordInteractionGroup(first, "repaint", () => {
    time += 12;
  });
  benchmark.recordInteractionGroup(first, "draw", () => {
    time += 3;
  });
  const error = new Error("draw failed");
  expect(() =>
    benchmark.recordInteractionGroup(first, "draw", () => {
      time += 5;
      throw error;
    })
  ).toThrow(error);
  benchmark.recordInteractionGroup(second, "draw", () => {
    time += 7;
  });
  benchmark.recordInteraction("slice", {
    phase: "blocks",
    pg: first,
    camera: { scale: 1.5 },
  });
  const run = benchmark.stopInteractionBenchmark();
  expect(run.groups).toMatchObject({
    observed: 2,
    tracked: 2,
    untracked: 0,
    totals: {
      draw: { calls: 3, totalMs: 15, maxMs: 7 },
      repaint: { calls: 1, totalMs: 12, maxMs: 12 },
    },
    heavy: [
      {
        id: 1,
        draw: { calls: 2, totalMs: 8 },
        repaint: { calls: 1, totalMs: 12 },
        drawsPerRepaint: 2,
      },
      {
        id: 2,
        draw: { calls: 1, totalMs: 7 },
        repaint: { calls: 0, totalMs: 0 },
        drawsPerRepaint: null,
      },
    ],
  });
  const trace = benchmark.getInteractionEvents();
  expect(trace.find((event) => event.type === "slice")).toMatchObject({
    camera: { scale: 1.5 },
  });
  expect(JSON.stringify(trace)).not.toContain("not in the trace");
  expect(trace.at(-1)).toMatchObject({
    type: "end",
    summary: { label: "Cross 11", elapsedMs: 27 },
  });
  benchmark.startInteractionBenchmark();
  benchmark.recordInteractionGroup(second, "draw", () => {});
  expect(benchmark.stopInteractionBenchmark().groups.heavy[0].id).toBe(1);
});

test("trace details are bounded without dropping work aggregates or the final summary", () => {
  benchmark.startInteractionBenchmark();
  const pg = {};
  for (let index = 0; index < 5010; index += 1) {
    benchmark.recordInteraction("slice", { drawn: 1 });
    benchmark.recordInteractionGroup(pg, "draw", () => {
      time += 1;
    });
  }
  const run = benchmark.stopInteractionBenchmark();
  expect(run.trace).toMatchObject({
    recordedEvents: 5000,
    droppedEvents: 11,
    maxEvents: 5000,
  });
  expect(run.eventCounts).toMatchObject({ begin: 1, slice: 5010 });
  expect(run.groups.totals.draw).toEqual({
    calls: 5010,
    totalMs: 5010,
    maxMs: 1,
  });
  const events = benchmark.getInteractionEvents();
  expect(events).toHaveLength(5001);
  expect(events[0].type).toBe("begin");
  expect(events.at(-1)).toMatchObject({
    type: "end",
    summary: { trace: { droppedEvents: 11 } },
  });
});

test("frame gaps and visibility changes are captured without updating UI mid-capture", () => {
  const listener = jest.fn();
  const unsubscribe = benchmark.subscribeInteractionBenchmarks(listener);
  benchmark.startInteractionBenchmark();
  benchmark.recordInteraction("restart", {
    phase: "blocks",
    blocksVisited: 15,
    blocksDrawn: 10,
    textVisited: 0,
  });
  frameAt(116);
  frameAt(180);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(listener).toHaveBeenCalledTimes(1);
  const run = benchmark.stopInteractionBenchmark();
  expect(listener).toHaveBeenCalledTimes(2);
  expect(run.responsiveness).toMatchObject({
    frames: 2,
    maxFrameGapMs: 64,
    frameGapsOver50Ms: 1,
  });
  expect(run.environment.visibilityChanged).toBe(true);
  expect(run.eventCounts.restart).toBe(1);
  expect(
    benchmark
      .getInteractionEvents()
      .filter((event) => event.type === "frame-gap")
  ).toEqual([
    { runId: run.id, type: "frame-gap", atMs: 0, durationMs: 16 },
    { runId: run.id, type: "frame-gap", atMs: 16, durationMs: 64 },
  ]);
  expect(frames.size).toBe(0);
  unsubscribe();
  benchmark.startInteractionBenchmark();
  expect(listener).toHaveBeenCalledTimes(2);
});

test("a capture stops at its duration limit and remains stopped if frames are unavailable", () => {
  global.requestAnimationFrame = undefined;
  global.cancelAnimationFrame = undefined;
  benchmark.startInteractionBenchmark();
  time += 60000;
  jest.advanceTimersByTime(60000);
  expect(benchmark.interactionRecording()).toBe(false);
  expect(benchmark.getInteractionBenchmark()).toMatchObject({
    status: "complete",
    stopReason: "duration-limit",
    elapsedMs: 60000,
  });
});

test("snapshots are immutable, detached, and only the latest capture is retained", () => {
  const first = benchmark.startInteractionBenchmark({ label: "First" });
  benchmark.recordInteraction("slice", { durationMs: 10 });
  const camera = { scale: 2 };
  benchmark.recordInteraction("camera", { camera });
  camera.scale = 99;
  expect(first.eventCounts.slice).toBeUndefined();
  const run = benchmark.stopInteractionBenchmark();
  expect(Object.isFrozen(first.eventCounts)).toBe(true);
  expect(Object.isFrozen(run.groups.totals.draw)).toBe(true);
  const events = benchmark.getInteractionEvents();
  expect(Object.isFrozen(events)).toBe(true);
  expect(events.find((event) => event.type === "camera").camera.scale).toBe(2);
  benchmark.startInteractionBenchmark({ label: "Second" });
  expect(benchmark.getInteractionEvents()).toHaveLength(1);
  expect(benchmark.getInteractionEvents()[0].label).toBe("Second");
  expect(run.label).toBe("First");
});

test("long tasks are clipped to the capture and pending entries are drained on stop", () => {
  let observer;
  global.PerformanceObserver = class {
    static supportedEntryTypes = ["longtask"];
    constructor(callback) {
      observer = this;
      this.callback = callback;
      this.entries = [];
      this.observe = jest.fn();
      this.disconnect = jest.fn();
      this.takeRecords = jest.fn(() => this.entries.splice(0));
    }
  };
  benchmark.startInteractionBenchmark();
  time = 180;
  observer.callback({
    getEntries: () => [
      { entryType: "longtask", startTime: 70, duration: 100 },
      { entryType: "paint", startTime: 120, duration: 60 },
      { entryType: "longtask", startTime: 0, duration: 60 },
    ],
  });
  observer.entries = [{ entryType: "longtask", startTime: 175, duration: 80 }];
  const run = benchmark.stopInteractionBenchmark();
  expect(run.responsiveness).toMatchObject({
    longTasksSupported: true,
    longTasks: { calls: 2, totalMs: 75, maxMs: 70 },
  });
  expect(observer.observe).toHaveBeenCalledWith({ type: "longtask" });
  expect(observer.takeRecords).toHaveBeenCalledTimes(1);
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(
    benchmark
      .getInteractionEvents()
      .filter((event) => event.type === "long-task")
  ).toEqual([
    { runId: run.id, type: "long-task", atMs: 0, durationMs: 70 },
    { runId: run.id, type: "long-task", atMs: 75, durationMs: 5 },
  ]);
});

test("unavailable long-task reporting does not prevent capture", () => {
  global.PerformanceObserver = class {
    static supportedEntryTypes = ["longtask"];
    observe() {
      throw new Error("unsupported here");
    }
    disconnect() {}
  };
  benchmark.startInteractionBenchmark();
  expect(
    benchmark.stopInteractionBenchmark().responsiveness.longTasksSupported
  ).toBe(false);
});
