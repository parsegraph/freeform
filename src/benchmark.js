// Opt-in measurements for the work between opening a graph and its first render.
// Keep collectors out of normal sessions; snapshots never contain graph data.
const MAX_RUNS = 10;
const MAX_EVENTS_PER_RUN = 2000;
const AGGREGATE_ONLY_STAGES = new Set([
  "Node sizing",
  "Node separation",
  "Paint preparation",
  "Glyph rendering",
  "Label collection and enqueue",
  "Glyph atlas update",
]);
const RENDERING_PHASE_STAGES = new Set([
  "Layout + paint preparation",
  "Focusing camera",
  "Clearing background",
  "Rendering blocks",
  "Initializing text",
  "Rendering text",
  "Rendering extents",
  "Rendering UI",
  "Post-rendering",
  "Post-rendering text",
  "Persisting graph",
  "Rendering metrics",
]);
const TRACE_POLICY = Object.freeze({
  maxEvents: MAX_EVENTS_PER_RUN,
  renderingPhaseMinMs: 1,
  aggregateOnlyStages: Object.freeze([...AGGREGATE_ONLY_STAGES]),
  durationFilteredStages: Object.freeze([...RENDERING_PHASE_STAGES]),
  retentionPriority:
    "begin/end, responsiveness, other stages, rendering phases",
});
const runs = [];
const listeners = new Set();
const graphs = new WeakMap();
let activeRun;
let nextId = 1;

const now = () => performance.now();
const measuring = (run) =>
  run && run.status === "running" && !run.completionRequested;

export const benchmarkEnabled = () =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("benchmark") === "1";

function immutableCopy(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(immutableCopy));
  }
  if (value && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)])
      )
    );
  }
  return value;
}

function snapshot(run) {
  return immutableCopy({
    id: run.id,
    source: run.source,
    status: run.status,
    elapsedMs: Math.max(
      0,
      (run.completedAt ?? run.endedAt ?? now()) - run.startedAt
    ),
    ...(run.endedAt === undefined
      ? {}
      : { collectionEndMs: run.endedAt - run.startedAt }),
    milestones: run.milestones,
    stages: Array.from(run.stages.values()),
    responsiveness: run.responsiveness,
    environment: run.environment,
    details: run.details,
    trace: {
      recordedEvents: run.events.length,
      droppedEvents: run.droppedEvents,
      filteredStageEvents: run.filteredStageEvents,
      ...TRACE_POLICY,
    },
    ...(run.error === undefined ? {} : { error: run.error }),
  });
}

export const getBenchmarkRuns = () =>
  Object.freeze(runs.map((run) => run.snapshot || snapshot(run)));

function eventPriority(event) {
  if (event.type === "begin" || event.type === "end") return 3;
  if (event.type !== "stage") return 2;
  return RENDERING_PHASE_STAGES.has(event.name) ? 0 : 1;
}

function recordDroppedEvent(run, event) {
  run.droppedEvents += 1;
  run.firstDroppedAtMs = Math.min(
    run.firstDroppedAtMs ?? event.atMs,
    event.atMs
  );
}

// Coarse spans correlate work with stalls. Per-node measurements stay aggregated;
// tiny renderer steps also stay aggregated. At the cap, optional renderer detail
// yields space to import/handoff/slices and responsiveness events.
function recordEvent(run, event) {
  // Reserve the final slot for the summary even when the detailed trace fills.
  if (run.events.length >= MAX_EVENTS_PER_RUN - 1) {
    const priority = eventPriority(event);
    let replace =
      priority > 0
        ? run.events.findIndex((entry) => eventPriority(entry) === 0)
        : -1;
    if (replace < 0 && priority > 1) {
      replace = run.events.findIndex((entry) => eventPriority(entry) === 1);
    }
    if (replace < 0) {
      recordDroppedEvent(run, event);
      return;
    }
    recordDroppedEvent(run, run.events[replace]);
    run.events.splice(replace, 1);
  }
  run.events.push({ runId: run.id, ...event });
}

export function getBenchmarkEvents() {
  return immutableCopy(
    runs.flatMap((run) => {
      const events = [...run.events];
      if (run.droppedEvents) {
        events.push({
          runId: run.id,
          type: "events-dropped",
          atMs: run.firstDroppedAtMs,
          count: run.droppedEvents,
          maxEvents: MAX_EVENTS_PER_RUN,
        });
      }
      return events.sort((a, b) => a.atMs - b.atMs);
    })
  );
}

function notify() {
  for (const listener of listeners) {
    // Diagnostics must never interrupt importing or rendering a graph.
    try {
      listener();
    } catch (_) {}
  }
}

export function subscribeBenchmarks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function recordLongTasks(run, entries) {
  const end = run.endedAt ?? now();
  for (const entry of entries) {
    if (entry.entryType !== "longtask") continue;
    const overlap =
      Math.min(end, entry.startTime + entry.duration) -
      Math.max(run.startedAt, entry.startTime);
    if (overlap <= 0) continue;
    run.responsiveness.longTaskCount += 1;
    run.responsiveness.longTaskTotalMs += overlap;
    run.responsiveness.maxLongTaskMs = Math.max(
      run.responsiveness.maxLongTaskMs,
      overlap
    );
    recordEvent(run, {
      type: "long-task",
      atMs: Math.max(run.startedAt, entry.startTime) - run.startedAt,
      durationMs: overlap,
    });
  }
}

function cleanup(run) {
  if (run.frame !== undefined) cancelAnimationFrame(run.frame);
  if (run.completionFrame !== undefined) {
    cancelAnimationFrame(run.completionFrame);
  }
  clearTimeout(run.completionTimer);
  clearTimeout(run.completionFallback);
  if (run.observer) {
    recordLongTasks(run, run.observer.takeRecords());
    run.observer.disconnect();
  }
  if (run.visibilityListener) {
    document.removeEventListener("visibilitychange", run.visibilityListener);
  }
}

function finish(run, status, error) {
  if (!run || run.status !== "running") return;
  run.endedAt = run.endedAt ?? now();
  cleanup(run);
  run.status = status;
  if (error !== undefined) {
    run.error = error instanceof Error ? error.message : String(error);
  }
  if (activeRun === run) activeRun = undefined;
  const finalEvent = {
    runId: run.id,
    type: "end",
    atMs: run.endedAt - run.startedAt,
  };
  run.events.push(finalEvent);
  run.snapshot = snapshot(run);
  finalEvent.summary = run.snapshot;
  notify();
}

export function beginBenchmark(source) {
  if (!benchmarkEnabled()) return undefined;
  cancelBenchmark(activeRun);
  const startedAt = now();
  const run = {
    id: nextId++,
    // Do not retain File objects, input text, or an imported document.
    source: Object.fromEntries(
      ["kind", "type", "name", "bytes", "rounds", "size", "vertical", "seed"]
        .filter((key) => source[key] !== undefined)
        .map((key) => [key, source[key]])
    ),
    status: "running",
    startedAt,
    milestones: {},
    stages: new Map(),
    stack: [],
    details: {},
    events: [],
    droppedEvents: 0,
    filteredStageEvents: 0,
    responsiveness: {
      maxFrameGapMs: 0,
      frameGapsOver50Ms: 0,
      longTasksSupported: false,
      longTaskCount: 0,
      longTaskTotalMs: 0,
      maxLongTaskMs: 0,
    },
    environment: {
      buildMode: process.env.NODE_ENV,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      visibility: document.visibilityState,
      visibilityChanged: false,
    },
  };
  activeRun = run;
  runs.push(run);
  if (runs.length > MAX_RUNS) runs.shift();

  run.visibilityListener = () => {
    run.environment.visibilityChanged = true;
  };
  document.addEventListener("visibilitychange", run.visibilityListener);

  if (
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function"
  ) {
    let previousFrame = startedAt;
    const frame = () => {
      if (run.status !== "running") return;
      const current = now();
      const gap = current - previousFrame;
      const gapStart = previousFrame;
      previousFrame = current;
      run.responsiveness.maxFrameGapMs = Math.max(
        run.responsiveness.maxFrameGapMs,
        gap
      );
      if (gap > 50) {
        run.responsiveness.frameGapsOver50Ms += 1;
        recordEvent(run, {
          type: "frame-gap",
          atMs: gapStart - run.startedAt,
          durationMs: gap,
        });
      }
      run.frame = requestAnimationFrame(frame);
    };
    run.frame = requestAnimationFrame(frame);
  }

  if (
    typeof PerformanceObserver !== "undefined" &&
    PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    try {
      run.observer = new PerformanceObserver((list) => {
        if (run.status === "running") recordLongTasks(run, list.getEntries());
      });
      // No buffered entries: previous page work is not part of this import.
      run.observer.observe({ type: "longtask" });
      run.responsiveness.longTasksSupported = true;
    } catch (_) {
      run.observer?.disconnect();
      run.observer = undefined;
    }
  }
  recordEvent(run, {
    type: "begin",
    atMs: 0,
    source: immutableCopy(run.source),
    environment: immutableCopy(run.environment),
    tracePolicy: TRACE_POLICY,
  });
  notify();
  return run;
}

export function attachBenchmark(root, run) {
  if (root && measuring(run)) graphs.set(root, run);
  return root;
}

export function benchmarkFor(root) {
  const run = root && graphs.get(root);
  return measuring(run) ? run : undefined;
}

export function annotateBenchmark(run, details) {
  if (measuring(run)) Object.assign(run.details, immutableCopy(details));
}

function recordStage(run, name, kind, startedAt, elapsed, selfMs, depth) {
  if (run.status !== "running") return;
  const key = `${kind}:${name}`;
  let stage = run.stages.get(key);
  if (!stage) {
    stage = { name, kind, totalMs: 0, selfMs, maxMs: 0, calls: 0 };
    run.stages.set(key, stage);
  } else if (kind === "sync") {
    stage.selfMs += selfMs;
  }
  stage.totalMs += elapsed;
  stage.maxMs = Math.max(stage.maxMs, elapsed);
  stage.calls += 1;
  if (!AGGREGATE_ONLY_STAGES.has(name)) {
    if (
      RENDERING_PHASE_STAGES.has(name) &&
      elapsed < TRACE_POLICY.renderingPhaseMinMs
    ) {
      run.filteredStageEvents += 1;
      return;
    }
    recordEvent(run, {
      type: "stage",
      name,
      kind,
      atMs: startedAt - run.startedAt,
      durationMs: elapsed,
      selfMs,
      ...(depth === undefined ? {} : { depth }),
    });
  }
}

export function measureBenchmark(run, name, fn) {
  if (!measuring(run)) return fn();
  const frame = { startedAt: now(), childMs: 0 };
  run.stack.push(frame);
  try {
    return fn();
  } finally {
    const elapsed = now() - frame.startedAt;
    run.stack.pop();
    const parent = run.stack[run.stack.length - 1];
    if (parent) parent.childMs += elapsed;
    recordStage(
      run,
      name,
      "sync",
      frame.startedAt,
      elapsed,
      Math.max(0, elapsed - frame.childMs),
      run.stack.length
    );
  }
}

export async function measureBenchmarkAsync(run, name, fn) {
  if (!measuring(run)) return await fn();
  const startedAt = now();
  try {
    return await fn();
  } finally {
    // Awaited wall time cannot be assigned to exclusive main-thread work.
    recordStage(run, name, "async", startedAt, now() - startedAt, null);
  }
}

export function completeBenchmark(run) {
  if (!measuring(run)) return;
  run.completedAt = now();
  run.milestones.firstRenderPassMs = run.completedAt - run.startedAt;
  run.completionRequested = true;
  const complete = () => {
    run.endedAt = now();
    // Let the current rendering task finish and the observer deliver its entries.
    run.completionTimer = setTimeout(() => finish(run, "complete"), 0);
  };
  if (run.frame !== undefined && document.visibilityState !== "hidden") {
    run.completionFrame = requestAnimationFrame(complete);
    // Hidden/suspended frames must not leave a completed run collecting forever.
    run.completionFallback = setTimeout(() => finish(run, "complete"), 250);
  } else {
    run.completionTimer = setTimeout(() => finish(run, "complete"), 0);
  }
}

export const failBenchmark = (run, error) => finish(run, "failed", error);
export const cancelBenchmark = (run) => finish(run, "cancelled");
