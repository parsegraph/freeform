import { useEffect, useMemo, useState } from "react";
import {
  getInteractionBenchmark,
  getInteractionEvents,
  startInteractionBenchmark,
  stopInteractionBenchmark,
  subscribeInteractionBenchmarks,
} from "../interactionBenchmark";
import "./InteractionBenchmarkPanel.css";

const milliseconds = (value) => `${value.toFixed(1)} ms`;

function eventsJsonl() {
  return (
    getInteractionEvents()
      .map((event) => JSON.stringify(event))
      .join("\n") + "\n"
  );
}

function downloadTrace() {
  const url = URL.createObjectURL(
    new Blob([eventsJsonl()], { type: "application/x-ndjson" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "freeform-interaction-events.jsonl";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function InteractionBenchmarkPanel() {
  const [run, setRun] = useState(getInteractionBenchmark);
  const [label, setLabel] = useState("Scroll / zoom");
  const [detailedTiming, setDetailedTiming] = useState(true);
  const [traceOpen, setTraceOpen] = useState(false);
  useEffect(() => {
    const update = () => setRun(getInteractionBenchmark());
    const unsubscribe = subscribeInteractionBenchmarks(update);
    update();
    return unsubscribe;
  }, []);
  const recording = run?.status === "running";
  const trace = useMemo(
    () => (traceOpen && run && !recording ? eventsJsonl() : ""),
    [traceOpen, run, recording]
  );
  return (
    <details className="interaction-benchmark" open>
      <summary>Interaction benchmark</summary>
      <p>
        Wait for the graph to settle, start recording, then scroll or pan. Stops
        automatically after 60 seconds. Keeps the latest capture.
      </p>
      <label className="interaction-benchmark-label">
        Capture label
        <input
          value={label}
          maxLength={120}
          disabled={recording}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="interaction-benchmark-timing">
        <input
          type="checkbox"
          checked={detailedTiming}
          disabled={recording}
          onChange={(event) => setDetailedTiming(event.target.checked)}
        />
        Detailed timing
      </label>
      <p>
        Uncheck to compare event and group counts without timing each renderer
        step.
      </p>
      <div className="benchmark-panel-actions">
        <button
          type="button"
          disabled={recording}
          onClick={() => startInteractionBenchmark({ label, detailedTiming })}
        >
          Start interaction recording
        </button>
        <button
          type="button"
          disabled={!recording}
          onClick={() => stopInteractionBenchmark()}
        >
          Stop interaction recording
        </button>
        <button
          type="button"
          disabled={!run || recording}
          onClick={downloadTrace}
        >
          Export interaction JSONL
        </button>
      </div>
      {recording && (
        <p role="status">Recording… Results update when recording ends.</p>
      )}
      {run && !recording && (
        <>
          <p>
            {run.label} · {(run.elapsedMs / 1000).toFixed(1)} s
            {` · ${run.eventCounts.slice || 0} renderer slices`}
            {` · ${run.eventCounts.restart || 0} render restarts`}
          </p>
          <p>
            Frame gap max: {milliseconds(run.responsiveness.maxFrameGapMs)}
            {` · ${run.responsiveness.frameGapsOver50Ms} over 50 ms`}
          </p>
          <p>
            {run.groups.observed.toLocaleString()} groups observed ·
            Block/spotlight draws{" "}
            {run.detailedTiming &&
              `${milliseconds(run.groups.totals.draw.totalMs)} / `}
            {run.groups.totals.draw.calls.toLocaleString()} calls
            {" · Repainting "}
            {run.detailedTiming &&
              `${milliseconds(run.groups.totals.repaint.totalMs)} / `}
            {run.groups.totals.repaint.calls.toLocaleString()} calls
          </p>
          {!run.detailedTiming && (
            <p>
              Detailed timing disabled. Renderer stage and group durations are
              unavailable; event counts and responsiveness are still recorded.
            </p>
          )}
          {run.trace.droppedEvents > 0 && (
            <p>
              {run.trace.droppedEvents.toLocaleString()} detail events omitted
              at the limit; aggregates are retained.
            </p>
          )}
          <p>
            CPU submission timings exclude GPU completion. Group IDs apply only
            to this capture. No repaint during the capture means its ratio is
            unknown, not that the group never changes.
          </p>
          <details onToggle={(event) => setTraceOpen(event.currentTarget.open)}>
            <summary>Interaction event trace (JSONL)</summary>
            {traceOpen && (
              <textarea
                aria-label="Interaction benchmark event trace"
                className="benchmark-trace"
                readOnly
                rows={8}
                value={trace}
              />
            )}
          </details>
        </>
      )}
    </details>
  );
}
