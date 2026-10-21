let benchmark;
let time;
let frames;
let frameId;
let originalRaf;
let originalCancelRaf;
let originalObserver;

const source = { kind: "file", type: "xml", name: "sample.svg", bytes: 100 };
const report = () => benchmark.getBenchmarkRuns().at(-1);

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
  benchmark = require("./benchmark");
});

afterEach(() => {
  // Cancel any unfinished measurement so event listeners do not survive tests.
  window.history.replaceState({}, "", "/?benchmark=1");
  benchmark.cancelBenchmark(benchmark.beginBenchmark(source));
  jest.restoreAllMocks();
  jest.useRealTimers();
  global.requestAnimationFrame = originalRaf;
  global.cancelAnimationFrame = originalCancelRaf;
  global.PerformanceObserver = originalObserver;
  window.history.replaceState({}, "", "/");
});

test("disabled instrumentation creates no collectors and preserves results/errors", async () => {
  window.history.replaceState({}, "", "/");
  const listen = jest.spyOn(document, "addEventListener");
  const value = {};
  const error = new Error("same error");
  expect(benchmark.beginBenchmark(source)).toBeUndefined();
  expect(benchmark.measureBenchmark(undefined, "work", () => value)).toBe(
    value
  );
  expect(() =>
    benchmark.measureBenchmark(undefined, "work", () => {
      throw error;
    })
  ).toThrow(error);
  await expect(
    benchmark.measureBenchmarkAsync(undefined, "read", () => value)
  ).resolves.toBe(value);
  expect(global.requestAnimationFrame).not.toHaveBeenCalled();
  expect(listen).not.toHaveBeenCalled();
  expect(benchmark.getBenchmarkRuns()).toEqual([]);
  expect(benchmark.getBenchmarkEvents()).toEqual([]);
});

test("nested synchronous work records exclusive time without double counting", () => {
  const run = benchmark.beginBenchmark(source);
  const value = {};
  expect(
    benchmark.measureBenchmark(run, "outer", () => {
      time += 5;
      benchmark.measureBenchmark(run, "child", () => {
        time += 10;
        benchmark.measureBenchmark(run, "grandchild", () => {
          time += 4;
        });
        time += 6;
      });
      benchmark.measureBenchmark(run, "child", () => {
        time += 3;
      });
      time += 2;
      return value;
    })
  ).toBe(value);
  expect(report().stages).toEqual(
    expect.arrayContaining([
      {
        name: "outer",
        kind: "sync",
        totalMs: 30,
        selfMs: 7,
        maxMs: 30,
        calls: 1,
      },
      {
        name: "child",
        kind: "sync",
        totalMs: 23,
        selfMs: 19,
        maxMs: 20,
        calls: 2,
      },
      {
        name: "grandchild",
        kind: "sync",
        totalMs: 4,
        selfMs: 4,
        maxMs: 4,
        calls: 1,
      },
    ])
  );
});

test("a throwing stage is measured, rethrows the same error, and unwinds its stack", () => {
  const run = benchmark.beginBenchmark(source);
  const error = new Error("invalid graph");
  try {
    benchmark.measureBenchmark(run, "parse", () => {
      time += 8;
      throw error;
    });
    throw new Error("Expected the original error");
  } catch (caught) {
    expect(caught).toBe(error);
  }
  benchmark.measureBenchmark(run, "other", () => {
    time += 3;
  });
  benchmark.failBenchmark(run, error);
  expect(report()).toMatchObject({
    status: "failed",
    error: "invalid graph",
    elapsedMs: 11,
  });
  expect(report().stages).toEqual([
    { name: "parse", kind: "sync", totalMs: 8, selfMs: 8, maxMs: 8, calls: 1 },
    { name: "other", kind: "sync", totalMs: 3, selfMs: 3, maxMs: 3, calls: 1 },
  ]);
  expect(frames.size).toBe(0);
});

test("async stages report wall time without assigning unrelated sync work to a parent", async () => {
  const run = benchmark.beginBenchmark(source);
  let resolve;
  const pending = benchmark.measureBenchmarkAsync(
    run,
    "read",
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  time += 20;
  benchmark.measureBenchmark(run, "render", () => {
    time += 7;
  });
  time += 10;
  const value = {};
  resolve(value);
  await expect(pending).resolves.toBe(value);
  expect(report().stages).toEqual([
    { name: "render", kind: "sync", totalMs: 7, selfMs: 7, maxMs: 7, calls: 1 },
    {
      name: "read",
      kind: "async",
      totalMs: 37,
      selfMs: null,
      maxMs: 37,
      calls: 1,
    },
  ]);
});

test("completion includes the first delayed frame but stops graph attribution immediately", () => {
  const notify = jest.fn();
  const unsubscribe = benchmark.subscribeBenchmarks(notify);
  const run = benchmark.beginBenchmark(source);
  const graph = {};
  expect(benchmark.attachBenchmark(graph, run)).toBe(graph);
  expect(benchmark.benchmarkFor(graph)).toBe(run);
  time = 180;
  benchmark.completeBenchmark(run);
  expect(benchmark.benchmarkFor(graph)).toBeUndefined();
  expect(notify).toHaveBeenCalledTimes(1);
  benchmark.measureBenchmark(
    benchmark.benchmarkFor(graph),
    "late render",
    () => {}
  );
  frameAt(196);
  jest.runOnlyPendingTimers();
  expect(report()).toMatchObject({
    status: "complete",
    elapsedMs: 80,
    collectionEndMs: 96,
    milestones: { firstRenderPassMs: 80 },
    responsiveness: {
      maxFrameGapMs: 96,
      frameGapsOver50Ms: 1,
      longTasksSupported: false,
    },
    stages: [],
  });
  expect(frames.size).toBe(0);
  expect(notify).toHaveBeenCalledTimes(2);
  unsubscribe();
  benchmark.cancelBenchmark(benchmark.beginBenchmark(source));
  expect(notify).toHaveBeenCalledTimes(2);
});

test("a render slice that requests completion still contributes its final synchronous timing", () => {
  const run = benchmark.beginBenchmark(source);
  benchmark.measureBenchmark(run, "render slice", () => {
    time += 12;
    benchmark.completeBenchmark(run);
    time += 3;
  });
  frameAt(132);
  jest.runOnlyPendingTimers();
  expect(report()).toMatchObject({
    status: "complete",
    elapsedMs: 12,
    collectionEndMs: 32,
    stages: [
      {
        name: "render slice",
        kind: "sync",
        totalMs: 15,
        selfMs: 15,
        calls: 1,
        maxMs: 15,
      },
    ],
  });
});

test("async rejection preserves the thrown value and still measures elapsed time", async () => {
  const run = benchmark.beginBenchmark(source);
  const error = new Error("read failed");
  await expect(
    benchmark.measureBenchmarkAsync(run, "read", async () => {
      time += 9;
      throw error;
    })
  ).rejects.toBe(error);
  expect(report().stages).toEqual([
    {
      name: "read",
      kind: "async",
      totalMs: 9,
      selfMs: null,
      maxMs: 9,
      calls: 1,
    },
  ]);
});

test("source recipes retain parameters needed to reproduce generated examples", () => {
  const recipe = {
    kind: "example",
    type: "random",
    rounds: 8,
    size: 10,
    vertical: false,
    seed: 17,
  };
  benchmark.beginBenchmark({ ...recipe, input: "not recorded" });
  expect(report().source).toEqual(recipe);
});

test("a superseding run cancels old associations and ignores async results arriving late", async () => {
  const first = benchmark.beginBenchmark(source);
  const graph = benchmark.attachBenchmark({}, first);
  let resolve;
  const work = benchmark.measureBenchmarkAsync(
    first,
    "read",
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  time += 10;
  const second = benchmark.beginBenchmark({ kind: "example", type: "svg" });
  const snapshot = benchmark.getBenchmarkRuns()[0];
  expect(snapshot.status).toBe("cancelled");
  expect(benchmark.benchmarkFor(graph)).toBeUndefined();
  time += 30;
  resolve("old source");
  await expect(work).resolves.toBe("old source");
  expect(benchmark.getBenchmarkRuns()[0]).toBe(snapshot);
  expect(snapshot.stages).toEqual([]);
  expect(report().status).toBe("running");
  benchmark.cancelBenchmark(second);
  expect(frames.size).toBe(0);
});

test("reports are immutable, omit input payloads, and retain the last ten in chronological order", () => {
  const run = benchmark.beginBenchmark({
    ...source,
    text: "private content",
    file: {},
  });
  const dimensions = { width: 120, height: 80 };
  benchmark.annotateBenchmark(run, {
    nodes: 42,
    canvas: dimensions,
    capabilities: ["appearance/1"],
  });
  dimensions.width = 999;
  const first = report();
  time += 5;
  benchmark.measureBenchmark(run, "parse", () => {
    time += 2;
  });
  expect(first.source).toEqual(source);
  expect(first.details.canvas.width).toBe(120);
  expect(first.stages).toEqual([]);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.details.canvas)).toBe(true);
  expect(Object.isFrozen(first.details.capabilities)).toBe(true);
  for (let index = 0; index < 11; index += 1) {
    benchmark.beginBenchmark({ kind: "example", type: String(index) });
  }
  const reports = benchmark.getBenchmarkRuns();
  expect(reports).toHaveLength(10);
  expect(reports[0].source.type).toBe("1");
  expect(reports[9].source.type).toBe("10");
});

test("long-task collection clips task overlap to the run and drains pending entries on completion", () => {
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
  const run = benchmark.beginBenchmark(source);
  time = 180;
  observer.callback({
    getEntries: () => [
      { entryType: "longtask", startTime: 0, duration: 60 },
      { entryType: "longtask", startTime: 70, duration: 100 },
      { entryType: "paint", startTime: 120, duration: 100 },
    ],
  });
  benchmark.completeBenchmark(run);
  frameAt(196);
  observer.entries = [
    { entryType: "longtask", startTime: 175, duration: 70 },
    { entryType: "longtask", startTime: 210, duration: 80 },
  ];
  jest.runOnlyPendingTimers();
  expect(report().responsiveness).toMatchObject({
    longTasksSupported: true,
    longTaskCount: 2,
    longTaskTotalMs: 91,
    maxLongTaskMs: 70,
  });
  expect(observer.observe).toHaveBeenCalledWith({ type: "longtask" });
  expect(observer.takeRecords).toHaveBeenCalledTimes(1);
  expect(observer.disconnect).toHaveBeenCalledTimes(1);
  expect(
    benchmark.getBenchmarkEvents().filter((event) => event.type === "long-task")
  ).toEqual([
    { runId: run.id, type: "long-task", atMs: 0, durationMs: 70 },
    { runId: run.id, type: "long-task", atMs: 75, durationMs: 21 },
  ]);
});

test("collector support is optional, visibility changes are recorded, and timers finish without frames", () => {
  global.requestAnimationFrame = undefined;
  global.cancelAnimationFrame = undefined;
  global.PerformanceObserver = class {
    static supportedEntryTypes = ["longtask"];
    observe() {
      throw new Error("Unsupported in this context");
    }
    disconnect() {}
  };
  const run = benchmark.beginBenchmark(source);
  document.dispatchEvent(new Event("visibilitychange"));
  time += 10;
  benchmark.completeBenchmark(run);
  jest.runOnlyPendingTimers();
  expect(report()).toMatchObject({
    status: "complete",
    milestones: { firstRenderPassMs: 10 },
    responsiveness: { longTasksSupported: false },
    environment: { visibilityChanged: true },
  });
});

test("completion has a fallback when the browser stops producing animation frames", () => {
  const run = benchmark.beginBenchmark(source);
  time += 20;
  benchmark.completeBenchmark(run);
  time += 250;
  jest.advanceTimersByTime(250);
  expect(report()).toMatchObject({
    status: "complete",
    milestones: { firstRenderPassMs: 20 },
  });
  expect(frames.size).toBe(0);
});

test("event traces preserve coarse timing order and omit per-node spans while aggregating them", async () => {
  const run = benchmark.beginBenchmark({
    ...source,
    text: "private XML content",
  });
  const initial = benchmark.getBenchmarkEvents();
  await benchmark.measureBenchmarkAsync(
    run,
    "File read and decode",
    async () => {
      time += 10;
    }
  );
  benchmark.measureBenchmark(run, "Graph construction", () => {
    time += 2;
    benchmark.measureBenchmark(run, "XML parsing and validation", () => {
      time += 12;
    });
    time += 16;
  });
  for (const name of [
    "Node sizing",
    "Node separation",
    "Paint preparation",
    "Glyph rendering",
    "Label collection and enqueue",
    "Glyph atlas update",
  ]) {
    benchmark.measureBenchmark(run, name, () => {
      time += 1;
    });
  }
  benchmark.completeBenchmark(run);
  frameAt(180);
  jest.runOnlyPendingTimers();

  const events = benchmark.getBenchmarkEvents();
  expect(initial).toHaveLength(1);
  expect(initial[0]).toMatchObject({ type: "begin", atMs: 0, source });
  expect(events.filter((event) => event.type === "stage")).toEqual([
    {
      runId: run.id,
      type: "stage",
      name: "File read and decode",
      kind: "async",
      atMs: 0,
      durationMs: 10,
      selfMs: null,
    },
    {
      runId: run.id,
      type: "stage",
      name: "Graph construction",
      kind: "sync",
      atMs: 10,
      durationMs: 30,
      selfMs: 18,
      depth: 0,
    },
    {
      runId: run.id,
      type: "stage",
      name: "XML parsing and validation",
      kind: "sync",
      atMs: 12,
      durationMs: 12,
      selfMs: 12,
      depth: 1,
    },
  ]);
  expect(events.find((event) => event.type === "frame-gap")).toEqual({
    runId: run.id,
    type: "frame-gap",
    atMs: 0,
    durationMs: 80,
  });
  expect(
    report().stages.filter((stage) => /Node |Paint |Glyph |Label /.test(stage.name))
  ).toHaveLength(6);
  expect(events.at(-1)).toMatchObject({
    runId: run.id,
    type: "end",
    atMs: 80,
    summary: {
      status: "complete",
      elapsedMs: 46,
      trace: { recordedEvents: 6, droppedEvents: 0 },
    },
  });
  expect(events.map((event) => event.atMs)).toEqual([0, 0, 0, 10, 12, 80]);
  expect(Object.isFrozen(events)).toBe(true);
  expect(Object.isFrozen(events[0].source)).toBe(true);
  expect(Object.isFrozen(events.at(-1).summary.stages)).toBe(true);
  const jsonl = events.map((event) => JSON.stringify(event)).join("\n");
  expect(jsonl).not.toContain("private XML content");
  expect(jsonl.split("\n").map((line) => JSON.parse(line))).toEqual(events);
});

test("event retention is bounded with explicit losses and an intact final summary", () => {
  const run = benchmark.beginBenchmark(source);
  for (let index = 0; index < 2005; index += 1) {
    benchmark.measureBenchmark(run, "Render slice", () => {
      time += 1;
    });
  }
  const runningEvents = benchmark.getBenchmarkEvents();
  expect(runningEvents).toHaveLength(2000);
  expect(
    runningEvents.find((event) => event.type === "events-dropped")
  ).toMatchObject({ count: 7, maxEvents: 2000 });
  benchmark.cancelBenchmark(run);
  const events = benchmark.getBenchmarkEvents();
  expect(events).toHaveLength(2001); // The loss marker is synthetic, outside the cap.
  expect(events[0].type).toBe("begin");
  expect(events.at(-1)).toMatchObject({
    type: "end",
    summary: {
      status: "cancelled",
      stages: [{ name: "Render slice", calls: 2005, totalMs: 2005 }],
      trace: { recordedEvents: 2000, droppedEvents: 7, maxEvents: 2000 },
    },
  });
});

test("event history follows retained runs and does not include superseded async completions", async () => {
  const run = benchmark.beginBenchmark(source);
  let resolve;
  const pending = benchmark.measureBenchmarkAsync(
    run,
    "File read and decode",
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  for (let index = 0; index < 10; index += 1) {
    time += 1;
    benchmark.beginBenchmark({ kind: "example", type: String(index) });
  }
  resolve("old input");
  await pending;
  const events = benchmark.getBenchmarkEvents();
  expect(events.some((event) => event.runId === run.id)).toBe(false);
  expect(events.filter((event) => event.type === "begin")).toHaveLength(10);
  expect(events.filter((event) => event.type === "end")).toHaveLength(9);
  expect(events.filter((event) => event.type === "stage")).toHaveLength(0);
  expect(events.map((event) => event.runId)).toEqual(
    events.map((event) => event.runId).sort((a, b) => a - b)
  );
});

test("short renderer steps remain aggregated without hiding short imports or render slices", () => {
  const run = benchmark.beginBenchmark(source);
  for (let index = 0; index < 500; index += 1) {
    benchmark.measureBenchmark(run, "Layout + paint preparation", () => {
      time += 0.25;
    });
    benchmark.measureBenchmark(run, "Rendering blocks", () => {
      time += 0.125;
    });
    benchmark.measureBenchmark(run, "Rendering text", () => {
      time += 0.125;
    });
  }
  benchmark.measureBenchmark(run, "Layout + paint preparation", () => {
    time += 1;
  });
  benchmark.measureBenchmark(run, "Graph construction", () => {
    time += 0.125;
  });
  benchmark.measureBenchmark(run, "Render slice", () => {
    time += 0.125;
  });
  benchmark.cancelBenchmark(run);
  const events = benchmark.getBenchmarkEvents();
  expect(
    events.filter((event) => event.type === "stage").map((event) => event.name)
  ).toEqual([
    "Layout + paint preparation",
    "Graph construction",
    "Render slice",
  ]);
  expect(events[0].tracePolicy).toMatchObject({ renderingPhaseMinMs: 1 });
  expect(report().trace).toMatchObject({
    filteredStageEvents: 1500,
    droppedEvents: 0,
  });
  expect(
    report().stages.find((stage) => stage.name === "Layout + paint preparation")
  ).toMatchObject({ calls: 501, totalMs: 126 });
});

test("import, render-slice, and responsiveness events displace excess renderer detail", () => {
  const run = benchmark.beginBenchmark(source);
  for (let index = 0; index < 2005; index += 1) {
    benchmark.measureBenchmark(run, "Layout + paint preparation", () => {
      time += 1;
    });
  }
  benchmark.measureBenchmark(run, "Graph construction", () => {
    time += 2;
  });
  benchmark.measureBenchmark(run, "Render slice", () => {
    time += 3;
  });
  frameAt(time + 16);
  benchmark.cancelBenchmark(run);
  const events = benchmark.getBenchmarkEvents();
  expect(events).toHaveLength(2001);
  expect(events[0].type).toBe("begin");
  expect(events.at(-1).type).toBe("end");
  expect(events.some((event) => event.name === "Graph construction")).toBe(
    true
  );
  expect(events.some((event) => event.name === "Render slice")).toBe(true);
  expect(events.some((event) => event.type === "frame-gap")).toBe(true);
  expect(report().trace).toMatchObject({
    recordedEvents: 2000,
    droppedEvents: 10,
  });
});
