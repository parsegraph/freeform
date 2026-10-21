import { useEffect, useMemo, useState } from "react";
import {
  benchmarkEnabled,
  getBenchmarkEvents,
  getBenchmarkRuns,
  subscribeBenchmarks,
} from "../benchmark";
import "./BenchmarkPanel.css";

function milliseconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ms` : "—";
}

function sourceLabel(run) {
  return run.source.name || run.source.type || run.source.kind;
}

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadRuns() {
  download(
    "freeform-benchmarks.json",
    JSON.stringify(getBenchmarkRuns(), null, 2),
    "application/json"
  );
}

function eventsJsonl() {
  const events = getBenchmarkEvents();
  return (
    events.map((event) => JSON.stringify(event)).join("\n") +
    (events.length ? "\n" : "")
  );
}

function EnabledBenchmarkPanel() {
  const [runs, setRuns] = useState(getBenchmarkRuns);
  const [selectedId, setSelectedId] = useState("");
  const [traceOpen, setTraceOpen] = useState(false);
  useEffect(() => {
    const update = () => setRuns(getBenchmarkRuns());
    const unsubscribe = subscribeBenchmarks(update);
    update();
    return unsubscribe;
  }, []);

  const selected = runs.find((run) => String(run.id) === selectedId);
  const run = selected || runs[runs.length - 1];
  const responsiveness = run?.responsiveness;
  const recording = runs.some((entry) => entry.status === "running");
  const trace = useMemo(
    () => (traceOpen && !recording ? eventsJsonl() : ""),
    [traceOpen, recording, runs]
  );

  return (
    <details className="benchmark-panel" open>
      <summary>Import benchmark{run ? ` · ${run.status}` : ""}</summary>
      <div className="benchmark-panel-body">
        <div className="benchmark-panel-actions">
          <label>
            Run
            <select
              value={selected ? selectedId : ""}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">Latest</option>
              {runs.map((entry, index) => (
                <option key={entry.id} value={entry.id}>
                  {index + 1}. {sourceLabel(entry)} · {entry.status}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={!runs.length} onClick={downloadRuns}>
            Export JSON
          </button>
          <button
            type="button"
            disabled={!runs.length || recording}
            onClick={() =>
              download(
                "freeform-benchmark-events.jsonl",
                eventsJsonl(),
                "application/x-ndjson"
              )
            }
          >
            Export JSONL
          </button>
        </div>
        {!run ? (
          <p>
            Open a file or example to record its load. Keeps the latest 10 runs.
          </p>
        ) : (
          <>
            <p className="benchmark-source">
              {sourceLabel(run)}
              {Number.isFinite(run.source.bytes)
                ? ` · ${run.source.bytes.toLocaleString()} bytes`
                : ""}
            </p>
            {Number.isFinite(run.details?.nodes) && (
              <p>
                {run.details.nodes.toLocaleString()} nodes
                {Number.isFinite(run.details.paintGroups)
                  ? ` · ${run.details.paintGroups.toLocaleString()} paint groups`
                  : ""}
              </p>
            )}
            {run.status === "running" ? (
              <p role="status">Recording… Timings update when the run ends.</p>
            ) : (
              <p>
                <strong>{milliseconds(run.elapsedMs)}</strong>
                {Number.isFinite(run.milestones.firstRenderPassMs)
                  ? " to first renderer pass"
                  : " elapsed · No first renderer pass recorded"}
              </p>
            )}
            {run.error && <p role="alert">{run.error}</p>}
            <div className="benchmark-table-scroll">
              <table>
                <caption>Stage timings</caption>
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Total</th>
                    <th scope="col">Self</th>
                    <th scope="col">Max</th>
                    <th scope="col">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {run.stages.map((stage) => (
                    <tr key={`${stage.kind}:${stage.name}`}>
                      <th scope="row">
                        {stage.name}
                        {stage.kind === "async" && (
                          <small>async wall time</small>
                        )}
                      </th>
                      <td>{milliseconds(stage.totalMs)}</td>
                      <td>
                        {stage.kind === "sync"
                          ? milliseconds(stage.selfMs)
                          : "—"}
                      </td>
                      <td>{milliseconds(stage.maxMs)}</td>
                      <td>{stage.calls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Frame gap max: {milliseconds(responsiveness.maxFrameGapMs)}
              {` · ${responsiveness.frameGapsOver50Ms} over 50 ms`}
            </p>
            <p>
              {responsiveness.longTasksSupported
                ? `Long tasks: ${responsiveness.longTaskCount} · ${milliseconds(
                    responsiveness.longTaskTotalMs
                  )} total · ${milliseconds(responsiveness.maxLongTaskMs)} max`
                : "Long-task reporting unavailable in this browser."}
            </p>
            <details className="benchmark-notes">
              <summary>Reading the results</summary>
              <p>
                Nested stage totals overlap; do not add them. Self excludes
                nested synchronous stages. Async durations include waiting.
                Stage max is one instrumented call, not a whole browser task.
              </p>
              <p>
                First renderer pass marks the end of initial layout and drawing
                submission, before GPU completion or asynchronous text and label
                workers finish. Responsiveness sampling briefly continues after
                that endpoint. Long-task durations count their overlap with the
                capture window. Frame gaps include other work in the tab.
              </p>
              <p>
                Keep this tab visible and avoid interacting during a run.
                Compare repeated runs in the same environment.
              </p>
              <p>
                {run.environment.viewport.width} ×{" "}
                {run.environment.viewport.height}
                {` · DPR ${run.environment.devicePixelRatio} · ${run.environment.visibility}`}
                {run.environment.buildMode &&
                  ` · ${run.environment.buildMode} build`}
                {run.environment.visibilityChanged &&
                  " · visibility changed during run"}
              </p>
              {Number.isFinite(run.collectionEndMs) && (
                <p>
                  Responsiveness sampled through{" "}
                  {milliseconds(run.collectionEndMs)}.
                </p>
              )}
              <p>{run.environment.userAgent}</p>
            </details>
          </>
        )}
        <details
          className="benchmark-notes"
          onToggle={(event) => setTraceOpen(event.currentTarget.open)}
        >
          <summary>Event trace (JSONL)</summary>
          {traceOpen &&
            (recording ? (
              <p>The trace will be available when recording ends.</p>
            ) : (
              <>
                <p>Events for all retained runs, one JSON object per line.</p>
                <textarea
                  aria-label="Benchmark event trace"
                  className="benchmark-trace"
                  readOnly
                  rows={8}
                  value={trace}
                />
              </>
            ))}
        </details>
      </div>
    </details>
  );
}

export default function BenchmarkPanel() {
  return benchmarkEnabled() ? <EnabledBenchmarkPanel /> : null;
}
