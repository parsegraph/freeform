import { benchmarkEnabled } from "./benchmark";
import parsegraphPackage from "parsegraph/package.json";

// Opt-in interaction diagnostics. Keep graph objects out of the exported trace.
const MAX_EVENTS = 5000;
const MAX_GROUPS = 50000;
const MAX_DURATION_MS = 60000;
const HEAVY_GROUPS_PER_KIND = 100;
const listeners = new Set();
let current;
let nextId = 1;

const now = () => performance.now();

function immutableCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(immutableCopy));
  if (
    value &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, immutableCopy(entry)])
      )
    );
  }
  return value;
}

// Event details contain only diagnostic scalars and plain containers, never
// DirectionNodes, painters, DOM nodes, or their object graphs.
function copyDetails(value, depth = 0) {
  if (value == null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.slice(0, 500);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => copyDetails(entry, depth + 1));
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, entry]) => [key, copyDetails(entry, depth + 1)])
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return undefined;
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (_) {
      // Diagnostics must not interrupt rendering.
    }
  }
}

export const interactionRecording = () => current?.status === "running";

export function subscribeInteractionBenchmarks(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function record(run, type, details = {}, atMs = now() - run.startedAt) {
  run.eventCounts[type] = (run.eventCounts[type] || 0) + 1;
  if (run.events.length >= MAX_EVENTS) {
    run.droppedEvents += 1;
    return;
  }
  run.events.push({ ...copyDetails(details), runId: run.id, type, atMs });
}

export function recordInteraction(type, details = {}) {
  if (interactionRecording()) record(current, type, details);
}

function emptyTiming() {
  return { calls: 0, totalMs: 0, maxMs: 0 };
}

function addTiming(timing, duration) {
  timing.calls += 1;
  timing.totalMs += duration;
  timing.maxMs = Math.max(timing.maxMs, duration);
}

export function measureInteraction(name, fn) {
  if (!interactionRecording() || !current.detailedTiming) return fn();
  const run = current;
  const startedAt = now();
  const frame = { childMs: 0 };
  run.stack.push(frame);
  try {
    return fn();
  } finally {
    const duration = Math.max(0, now() - startedAt);
    run.stack.pop();
    if (run.stack.length) run.stack[run.stack.length - 1].childMs += duration;
    if (run.status === "running") {
      let stage = run.stages.get(name);
      if (!stage) {
        stage = { name, ...emptyTiming(), selfMs: 0 };
        run.stages.set(name, stage);
      }
      addTiming(stage, duration);
      stage.selfMs += Math.max(0, duration - frame.childMs);
    }
  }
}

export function recordInteractionGroup(pg, kind, fn) {
  if (!interactionRecording()) return fn();
  const run = current;
  if (
    !pg ||
    (typeof pg !== "object" && typeof pg !== "function") ||
    (kind !== "draw" && kind !== "repaint")
  ) {
    return fn();
  }
  let id = run.groupIds.get(pg);
  if (id === undefined) {
    id = ++run.groupCount;
    run.groupIds.set(pg, id);
    if (id <= MAX_GROUPS) {
      run.groups.set(id, { id, draw: emptyTiming(), repaint: emptyTiming() });
    }
  }
  const group = run.groups.get(id);
  if (!run.detailedTiming) {
    run.groupTotals[kind].calls += 1;
    if (group) group[kind].calls += 1;
    return fn();
  }
  const startedAt = now();
  try {
    return fn();
  } finally {
    if (run.status === "running") {
      const duration = Math.max(0, now() - startedAt);
      addTiming(run.groupTotals[kind], duration);
      if (group) addTiming(group[kind], duration);
    }
  }
}

function recordLongTasks(run, entries) {
  const endedAt = run.endedAt ?? now();
  for (const entry of entries) {
    if (entry.entryType !== "longtask") continue;
    const durationMs =
      Math.min(endedAt, entry.startTime + entry.duration) -
      Math.max(run.startedAt, entry.startTime);
    if (durationMs <= 0) continue;
    addTiming(run.responsiveness.longTasks, durationMs);
    record(
      run,
      "long-task",
      { durationMs },
      Math.max(run.startedAt, entry.startTime) - run.startedAt
    );
  }
}

function snapshot(run) {
  const groups = Array.from(run.groups.values());
  const ranking = run.detailedTiming ? "totalMs" : "calls";
  const groupTiming = (timing) =>
    run.detailedTiming
      ? timing
      : { calls: timing.calls, totalMs: null, maxMs: null };
  const heavy = new Map();
  for (const kind of ["draw", "repaint"]) {
    groups
      .filter((group) => group[kind].calls > 0)
      .sort((a, b) => b[kind][ranking] - a[kind][ranking])
      .slice(0, HEAVY_GROUPS_PER_KIND)
      .forEach((group) => heavy.set(group.id, group));
  }
  return immutableCopy({
    id: run.id,
    label: run.label,
    detailedTiming: run.detailedTiming,
    status: run.status,
    stopReason: run.stopReason,
    elapsedMs: (run.endedAt ?? now()) - run.startedAt,
    environment: run.environment,
    responsiveness: run.responsiveness,
    stages: Array.from(run.stages.values()),
    eventCounts: run.eventCounts,
    groups: {
      observed: run.groupCount,
      tracked: run.groups.size,
      untracked: Math.max(0, run.groupCount - MAX_GROUPS),
      totals: {
        draw: groupTiming(run.groupTotals.draw),
        repaint: groupTiming(run.groupTotals.repaint),
      },
      heavy: Array.from(heavy.values())
        .sort((a, b) => b.draw[ranking] - a.draw[ranking])
        .map((group) => ({
          id: group.id,
          draw: groupTiming(group.draw),
          repaint: groupTiming(group.repaint),
          drawsPerRepaint: group.repaint.calls
            ? group.draw.calls / group.repaint.calls
            : null,
        })),
      heavyGroupsPerKind: HEAVY_GROUPS_PER_KIND,
      rankedBy: ranking,
    },
    trace: {
      recordedEvents: run.events.length,
      droppedEvents: run.droppedEvents,
      maxEvents: MAX_EVENTS,
      maxDurationMs: MAX_DURATION_MS,
    },
  });
}

export const getInteractionBenchmark = () =>
  current ? current.snapshot || snapshot(current) : undefined;

export function getInteractionEvents() {
  if (!current) return Object.freeze([]);
  return immutableCopy([
    ...current.events,
    ...(current.snapshot
      ? [
          {
            runId: current.id,
            type: "end",
            atMs: current.snapshot.elapsedMs,
            summary: current.snapshot,
          },
        ]
      : []),
  ]);
}

export function stopInteractionBenchmark(reason = "manual") {
  if (!interactionRecording()) return getInteractionBenchmark();
  const run = current;
  run.endedAt = now();
  clearTimeout(run.timer);
  if (run.frame !== undefined) cancelAnimationFrame(run.frame);
  if (run.observer) {
    recordLongTasks(run, run.observer.takeRecords());
    run.observer.disconnect();
  }
  document.removeEventListener("visibilitychange", run.visibilityListener);
  run.status = "complete";
  run.stopReason = reason;
  run.snapshot = snapshot(run);
  notify();
  return run.snapshot;
}

export function startInteractionBenchmark({
  label = "Scroll / zoom",
  detailedTiming = true,
} = {}) {
  if (!benchmarkEnabled()) return undefined;
  if (interactionRecording()) return getInteractionBenchmark();
  const run = {
    id: nextId++,
    label: String(label).slice(0, 120),
    detailedTiming: Boolean(detailedTiming),
    status: "running",
    startedAt: now(),
    events: [],
    eventCounts: Object.create(null),
    droppedEvents: 0,
    stages: new Map(),
    stack: [],
    groups: new Map(),
    groupIds: new WeakMap(),
    groupCount: 0,
    groupTotals: { draw: emptyTiming(), repaint: emptyTiming() },
    responsiveness: {
      frames: 0,
      maxFrameGapMs: 0,
      frameGapsOver50Ms: 0,
      longTasksSupported: false,
      longTasks: emptyTiming(),
    },
    environment: {
      buildMode: process.env.NODE_ENV,
      parsegraphVersion: parsegraphPackage.version,
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      visibility: document.visibilityState,
      visibilityChanged: false,
    },
  };
  current = run;
  record(
    run,
    "begin",
    {
      label: run.label,
      detailedTiming: run.detailedTiming,
      environment: run.environment,
    },
    0
  );
  run.visibilityListener = () => {
    run.environment.visibilityChanged = true;
    record(run, "visibility", { visibility: document.visibilityState });
  };
  document.addEventListener("visibilitychange", run.visibilityListener);
  if (
    typeof requestAnimationFrame === "function" &&
    typeof cancelAnimationFrame === "function"
  ) {
    let previousFrame = run.startedAt;
    const frame = () => {
      if (run.status !== "running") return;
      const at = now();
      const gap = Math.max(0, at - previousFrame);
      run.responsiveness.frames += 1;
      run.responsiveness.maxFrameGapMs = Math.max(
        run.responsiveness.maxFrameGapMs,
        gap
      );
      if (gap > 50) run.responsiveness.frameGapsOver50Ms += 1;
      record(
        run,
        "frame-gap",
        { durationMs: gap },
        previousFrame - run.startedAt
      );
      previousFrame = at;
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
      run.observer.observe({ type: "longtask" });
      run.responsiveness.longTasksSupported = true;
    } catch (_) {
      run.observer?.disconnect();
      run.observer = undefined;
    }
  }
  run.timer = setTimeout(
    () => stopInteractionBenchmark("duration-limit"),
    MAX_DURATION_MS
  );
  notify();
  return getInteractionBenchmark();
}
