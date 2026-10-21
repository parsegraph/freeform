# Import and initial-layout benchmarks

Add `benchmark=1` to the page URL **before loading** to enable instrumentation
and the Import benchmark panel. It is disabled by default. For example:

- `/?benchmark=1`: open a file or choose a built-in example normally.
- `/?benchmark=1&sample=svg`: load the SVG source example.
- `/?benchmark=1&sample=cross_5`: load a repeatable generated graph.

Initial example restoration is included. The panel keeps the latest ten runs
for the current page session; reloading clears them. Use **Export JSON** to save
all retained runs, including their environment and individual stage timings.
**Export JSONL** saves the event trace as one JSON object per line. The collapsed
**Event trace (JSONL)** section exposes the same text for inspection or copying.
It is populated only when opened and recording has ended, so building the text
does not interrupt a run. Both exports cover all retained runs, regardless of
which run is selected in the panel.
The trace includes run boundaries, coarse stage spans, frame gaps, and long
tasks. Events are ordered by run and then by their relative `atMs`; spans also
carry `durationMs`. To limit measurement overhead, node sizing, separation,
paint preparation, glyph rendering, glyph atlas updates, and label collection
remain aggregated in the summary rather than producing individual JSONL spans.
Repeated rendering-phase calls shorter than 1 ms are also omitted from the
trace; their timings remain included in the aggregates. Import, handoff, and
render-slice spans are not duration-filtered. The exported trace policy names
the affected stages, and `filteredStageEvents` counts calls omitted by this
duration threshold.

Each run retains at most 2,000 events, prioritizing run boundaries and
responsiveness events over stage detail when full. An additional
`events-dropped` record and the summary's `droppedEvents` counter identify
events lost to that limit, separately from intentional duration filtering.
The final `end` event carries the complete aggregate report in `summary`,
including timings for stages omitted from the individual event trace.
The panel updates at the start and end of a run rather than rendering updates
while graph work is being measured. A failed or cancelled run remains visible.
In development, React Strict Mode may cancel the first restoration attempt and
start another; compare completed runs.

## What the numbers mean

Elapsed time for a completed run covers loading through the first renderer pass
after the graph's initial layout, also recorded as the first-renderer-pass
milestone. This endpoint does not wait for GPU completion or asynchronous text
and label workers. It is not a guarantee that every label has appeared.
Responsiveness sampling briefly continues after this endpoint so the browser
can report the last frame gap and long task; `collectionEndMs` records that
later boundary separately. Failed and cancelled runs report elapsed time up
to their interruption instead.

Stage rows distinguish synchronous work from asynchronous wall time. For
example, asynchronous file reading includes time spent waiting; it is not a
measure of main-thread CPU use. Nested stage totals overlap and **must not be
added together**. Synchronous self time excludes nested synchronous stages and
is useful for distinguishing a wrapper from the work it calls. The maximum is
one instrumented call, which can be shorter than a complete browser task when
several calls run back-to-back.

Node sizing, separation, and paint preparation are measured inside the layout
phase. These per-call timers add overhead, so compare runs with instrumentation
enabled in both versions. The graph-statistics stage may read cached counts;
it does not necessarily include all time spent counting nodes.

Text rendering has three additional aggregate-only probes. `Glyph rendering`
measures the glyph painter's render call, including `Glyph atlas update` nested
inside it. `Label collection and enqueue` measures collecting labels and
queuing work. Both glyph rendering and label collection sit inside
`Rendering text`; label collection does not measure completion of asynchronous
worker work. These totals overlap: atlas time is already included in glyph
time, which is already included in text-rendering time. The synchronous self
times exclude their nested probes. All three probes appear in the table and
the JSONL `end.summary` aggregates, not as individual spans.

Frame gaps are intervals between animation-frame callbacks during the run.
The largest gap and the number over 50 ms help reveal pauses. They include
other work in the tab, browser scheduling, and instrumentation overhead; they
do not establish which stage caused a pause. Long-task counts, total duration,
and maximum duration are also recorded when the browser supports that API;
durations count only the portion overlapping the capture window.
“Unavailable” means the browser did not provide the data, not that there were
no long tasks.

The export records source metadata, available node and paint-group counts,
timings, responsiveness, and environment
(browser user agent, build mode, viewport, pixel ratio, and visibility). Source names may
include the imported filename. It does not include imported file contents or
the graph itself.

## Making a useful comparison

1. Use a production build (`yarn build`, then serve `build/` with your usual
   static server). Development checks, hot reload, and source transforms can
   distort comparisons. If you measure with `yarn start`, label those results
   as development measurements and compare like with like.
2. Keep the browser, viewport, device pixel ratio, graph, and camera setup the
   same. Prefer a fixed file or deterministic example. Record the commit and
   build mode alongside each exported result.
3. Keep the tab visible and avoid interacting while a run is recording. Close
   unrelated busy tabs and stop profilers for the baseline. A background tab's
   throttling makes frame gaps unsuitable for comparison.
4. Distinguish cold loads after a fresh page load from warm loads made by
   reopening the same file or example within a session. Report them separately:
   caches and browser compilation can make the first run different.
5. Collect at least five comparable runs and calculate the median manually from
   the exports. Also inspect the spread and worst frame gaps rather than
   choosing the fastest run. Export before reloading if collecting cold runs.
6. Compare elapsed time, synchronous self time, maximum calls, and responsiveness
   together. A worker can improve frame gaps even when total elapsed time stays
   the same or increases because of serialization and message passing.

These measurements establish a baseline for deciding which work to move to
workers. They do not themselves change the import or layout threading model.
