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
(Parsegraph version, browser user agent, build mode, viewport, pixel ratio, and visibility). Source names may
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

## Isolating grid construction

Run the standalone construction benchmark without starting the app:

```sh
node --expose-gc scripts/grid-construction-benchmark.cjs \
  --sizes 30,70,100 --runs 5 --warmups 1 \
  --output out/benchmarks/grid-construction.jsonl
```

The baseline executes the current `buildGrid` function from the app source,
using the installed `parsegraph` package. Controls remove numeric labels,
string direction parsing, caret push/pop, the caret itself, or explicit
creases. Another control creases detached nodes before connecting them.
`--list` describes every case; `--cases baseline,deserialize` selects a subset.
Output files must be new; the script refuses to overwrite an existing capture.

To compare another built Parsegraph package without changing Freeform's
dependency, point `PARSEGRAPH_BENCHMARK_PACKAGE` at its package root:

```sh
PARSEGRAPH_BENCHMARK_PACKAGE=/path/to/built/parsegraph \
  node --expose-gc scripts/grid-construction-benchmark.cjs \
  --sizes 30,70,100 --runs 5 --warmups 1 \
  --output out/benchmarks/another-version.jsonl
```

The directory must contain a `package.json` named `parsegraph` whose `main`
resolves to the built runtime. The version, entry path, package path, and bundle
hash in each capture describe that selected package. Optional
`package.json.freeformBenchmarkSource` provenance is recorded as
`parsegraphSource`. The same environment variable works with the diagnostics
script. Without it, both scripts use Freeform's installed dependency.

Here, **reconstruction means deserialization of an already-parsed snapshot**,
as performed by `GraphStack.widget()` through `readGraph()`. It does not include
parsing JSON text. Built-in grids currently use legacy v0 snapshots; the
benchmark follows that path, including Freeform's unsupported-content scan
and document-state attachment. The `deserialize-only` control omits those
Freeform steps.

The key ordering control is `deserialize-creation-order`: it feeds the same
deserializer the same records, reordered into the builder's original sequence
(root, DOWNWARD spine node, its FORWARD chain, then the next spine node).
Ordinary deserialization uses the serializer's paint-group and sibling
traversal order. This separates connection order from parsing, caret overhead,
and crease timing.

Each size/case gets untimed warmups followed by measured trials in a
deterministically shuffled order. Explicit garbage collection, fixture
preparation, output, and semantic validation are outside the timer. Each
result is checked against the baseline for topology, values, fit, scale,
alignment, layout preference, and paint-group flags, ignoring node IDs and
serialization order. The no-values and no-creases controls intentionally
change their named field; all remaining fields must still match. Removing
creases makes one large paint group, so that case also changes the size of
the sibling lists that connection bookkeeping must traverse.

JSONL includes environment and source hashes, case definitions, fixture
counts, individual warmups/trials, and a final median/minimum/maximum summary.
These are synchronous **Node construction measurements**, not browser elapsed
times or rendering measurements. Keep timing runs separate from other CPU
work, including the instrumented diagnostics below.

Count algorithmic work separately:

```sh
node scripts/grid-construction-diagnostics.cjs --size 100 \
  > out/benchmarks/grid-operation-counts.json
```

This counts `Neighbors.parentNode`, `PaintGroup.next`, `PaintGroup.verify`, and
`Siblings.verify` calls for construction and both deserialization orders.
It wraps installed runtime methods only during each operation, restores them
afterward, and reports no timings. Counts include every caller of those
methods; they are not a CPU profile of a particular internal function.

To investigate verification overhead, run the opt-in diagnostic separately:

```sh
node --expose-gc scripts/grid-construction-benchmark.cjs \
  --sizes 100 --runs 5 --warmups 1 \
  --cases baseline,baseline-no-verifies \
  --output out/benchmarks/grid-verification.jsonl
```

This temporarily disables the two ring-verification methods and restores them
before validating each result. Prototype changes can affect JIT optimization,
so this diagnostic is excluded from the default matrix; compare its own
baseline and treat the timings as approximate. No production code or installed
package files are modified by either script.

### Initial construction investigation (2026-10-21)

Measured on Apple M1 / Node 20.7.0 with
`parsegraph@6.2.0-v1.local.e8ca09ae704fcff6` and Freeform application revision
`1ceba16`. Five measured trials and one warmup per case/size; 150 measured
trials in the main matrix. Every trial passed semantic validation, allowing
only the documented field changes for no-values and no-creases.

Median synchronous time, in milliseconds:

| Case | Grid 30 (931 nodes) | Grid 70 (4,971 nodes) | Grid 100 (10,101 nodes) |
| --- | ---: | ---: | ---: |
| Original builder | 13.7 | 238.9 | 1,679.3 |
| No creases (changes paint groups) | 18.6 | 466.5 | 1,935.5 |
| No values (changes labels) | 13.5 | 231.8 | 1,725.1 |
| Numeric directions | 12.9 | 236.5 | 1,698.6 |
| No push/pop | 13.9 | 239.2 | 1,664.6 |
| Raw nodes without caret | 12.9 | 235.7 | 1,700.1 |
| Raw nodes, crease before connecting | 11.9 | 235.9 | 1,647.5 |
| Deserialize in serializer order | 8.7 | 38.5 | 65.5 |
| Deserialize in original creation order | 14.1 | 283.6 | 1,938.1 |
| Deserialize without Freeform scan/attachment | 8.7 | 35.0 | 65.2 |

The Grid 100 builder took 1,654.5–1,706.9 ms across its five trials, while
normal deserialization took 63.5–70.2 ms. The Node reproduction shows a 25.6×
builder/deserializer gap; its absolute times and ratio differ from the earlier
browser measurements. Reordering identical records alone makes deserialization
29.6× slower. Labels, direction parsing, caret state, and precreasing do not
explain the large gap.

Separate Grid 100 operation counts, with the same 10,101 nodes and 1,314 paint
groups in all three results:

| Method calls | Original builder | Deserialize | Deserialize in creation order |
| --- | ---: | ---: | ---: |
| `Neighbors.parentNode` | 170,933,140 | 1,594,816 | 170,933,140 |
| `PaintGroup.next` | 1,757,619 | 107,424 | 1,757,619 |
| `Siblings.verify` | 12,726 | 8,787 | 8,787 |
| `PaintGroup.verify` | 11,414 | 12,701 | 11,414 |

The installed library's `findPaintGroupInsert` scans the existing paint-group
ring. `findClosestPaintGroup` computes a distance for every candidate, and
`findDistance` builds two paths to the root for each comparison. Growing the
already-connected grid repeatedly searches large rings and walks long paths.
The serializer traverses paint groups and siblings backward; loading in that
order assembles smaller disconnected pieces before attaching them. Returning
those same records to builder order restores the ancestor traversal count
exactly. Relevant installed sources are under
`node_modules/parsegraph/src/DirectionNode/PaintGroups/` and
`node_modules/parsegraph/src/serializationTraversal.ts`.

A separate CPU profile of one Grid 100 construction attributed 1,209 of 1,331
samples (90.8%) to stacks inside `findPaintGroupInsert`, including 1,064 samples
(79.9% of all samples) inside `findDistance`. Garbage collection accounted for
70 samples (5.3%). Source-map attribution was checked against the installed
bundle and TypeScript. These are sampled stacks, not exact stage durations;
optimized/inlined path traversal can be attributed to `findDistance` rather
than appearing as a separate `pathToRoot` frame.

A separate five-trial verification diagnostic measured 1,739.4 ms with checks
and 1,702.5 ms without them (medians). This small difference does not explain
the gap. Removing creases also does not solve it: connection bookkeeping then
repeatedly traverses one large sibling list.

The next optimization to investigate is bulk construction order or the
paint-group insertion search itself. This experiment does not change production
construction and does not establish performance for every imported format.

Local captures are in `out/benchmarks/2026-10-21-grid-construction/` (ignored by
Git): `construction.jsonl`, `verification.jsonl`, and `operation-counts.json`.
The separate profile is saved as `construction.cpuprofile`, with mapped counts
in `profile-summary.json` and its ad-hoc helper in `profile.cjs`.
`timing-harness.cjs` preserves the exact script used for those timing captures;
the tracked script subsequently gained source-transform and record-order
assertions without changing the timed operations.

### Installed preview versus current Parsegraph (2026-10-21)

A second comparison ran the complete matrix afresh for both versions:

- Freeform's installed `6.2.0-v1.local.e8ca09ae704fcff6` preview.
- The clean `~/code/parsegraph` checkout at
  `9746edadd73e278a7a96b61ab2f0b72f3833eab0`, version `7.0.0`.

The current checkout was built with its production webpack configuration into
an isolated package under Freeform's ignored `out/` directory. Only output
location, loader resolution, cache settings, and TypeScript declaration
emission were overridden; the runtime production configuration was retained.
Neither Freeform's dependency nor the Parsegraph source checkout was changed.
These results compare the complete library versions, including other topology
and layout-ordering fixes, rather than isolating a single changed function.

Both versions used Node 20.7.0 on Apple M1, the same harness and builder hashes,
sizes 30/70/100, one warmup and five measured trials per case, and the same
deterministically shuffled trial order. The version suites ran sequentially.
All 300 measured trials and 60 warmups passed validation; corresponding output
fingerprints matched across versions. A separate check also confirmed identical
legacy snapshot contents **and record ordering**, after normalizing random IDs,
at all three sizes.

Median synchronous times:

| Work | Installed 6.2 preview | Current 7.0 checkout | Speedup |
| --- | ---: | ---: | ---: |
| Build Grid 30 | 12.9 ms | 8.6 ms | 1.49× |
| Build Grid 70 | 240.5 ms | 25.4 ms | 9.48× |
| Build Grid 100 | 1,716.5 ms | 63.1 ms | 27.20× |
| Deserialize Grid 100 | 66.4 ms | 46.2 ms | 1.44× |
| Deserialize Grid 100 in creation order | 1,927.7 ms | 66.5 ms | 28.97× |
| Build Grid 100 without creases | 1,965.0 ms | 1,927.7 ms | 1.02× |

Grid 100 construction ranged from 1,707.8–1,743.7 ms in the installed preview
and 61.9–63.5 ms in the current checkout. Its construction/deserialization ratio
falls from 25.9× to 1.37×. The large ordering penalty is substantially resolved
while paint-group maintenance remains eager. Removing creases still creates an
expensive single sibling list, so that ablation remains slow in both versions.
These are construction-only results; browser layout, rendering, other imports,
and full Freeform integration with version 7 have not been measured here.

Captures and the self-contained Matplotlib HTML report are under
`out/benchmarks/2026-10-21-parsegraph-versions/`:

- `report.html`: comparison charts, tables, provenance, and embedded downloads.
- `installed.jsonl` / `latest.jsonl`: fresh complete timing captures.
- `comparison.json`: validated medians, ranges, speedups, and matching metadata.
- `order-validation.json`: normalized serialization-order checks.
- `installed-operation-counts.json` / `latest-operation-counts.json`: separate
  instrumented diagnostics. `Neighbors.parentNode` counts only that method;
  ancestry walks through `parent()` are not included in that counter.
- `build-latest.cjs`, `compare.cjs`, and `generate_report.py`: local reproduction
  helpers. The production package includes its source revision and build hash.

After that comparison, the local working copy of Freeform was upgraded to the
verified package `7.0.0-v1.local.f78bff25f250ad31` from the same checkout for the
captures below. The repository dependency upgrade remains pending publication
of the package. By default, the benchmark measures whichever Parsegraph package
is installed; the version-comparison captures above retain their original
package versions.

## Recursive cross and interaction captures

For construction and deserialization of the actual recursive-cross example:

```sh
node --expose-gc scripts/cross-construction-benchmark.cjs \
  --rounds 11 --runs 5 --warmups 1 \
  --output out/benchmarks/cross-11-construction.jsonl
```

This extracts `buildCross` and the relevant `readGraph` functions from the app
source. It validates the node count, paint-group size distribution, and an
ID-independent semantic fingerprint after every trial. Like the grid harness,
serialization, validation, explicit GC, and output are outside the timer;
`PARSEGRAPH_BENCHMARK_PACKAGE` can select another built package. Output paths must
be new. These are Node measurements, excluding layout and browser rendering.

To measure camera movement, open `/?benchmark=1&sample=cross_11` in a production
build and wait for initial drawing to settle. In the benchmark panel, enter a
capture label and choose **Start interaction recording**. Scroll or pan, then
choose **Stop interaction recording**. **Export interaction JSONL** and the
**Interaction event trace (JSONL)** textarea expose the same trace. It retains
only the latest capture and automatically stops after 60 seconds. It records
no graph contents; the capture label and camera coordinates are included.

The interaction collector records:

- Renderer slices with the phase, camera pose/version, pass number, and cumulative
  visited/drawn/culled group counters before and after the slice.
- Canvas clears, render restarts, and complete renderer passes. A restart from
  `Rendering blocks` identifies abandoned block drawing. Restarts from a
  completed pass, and duplicate phase-zero resets, are not abandoned frames.
- Frame gaps and supported browser long-task events.
- Aggregate synchronous phase and progress-reporting times, including graph
  counting. Self time excludes nested stage timings.
- Per-group **block and spotlight submission** and **paint preparation** calls
  and times. A group draw is not a WebGL draw-call count. Text/glyph work appears
  in the text phase, not in group draw timings. GPU completion is unmeasured.

**Detailed timing** can be disabled to remove timers from individual renderer
steps and group draws. This control retains slice/frame/event measurements and
call counts, but marks group times unavailable. Use it to check whether a
partial-frame finding depends on the timing probes. Even this lighter capture
has overhead; neither mode is an uninstrumented FPS benchmark. Compare captures
with matching settings, browser, viewport, camera, and gestures.

At most 5,000 detail events and 50,000 per-group records are retained. Aggregate
phase/group totals and event counts continue after the detail limit. The final
summary includes the union of the 100 groups with greatest cumulative draw time
and the 100 with greatest repaint time (or most calls with detailed timing off).
Group IDs are local to a capture. A zero
repaint count means no repaint was observed during that window; the ratio is
reported as null, not as evidence that a group will never change. Counts derived
from detailed events are lower bounds if `droppedEvents` is nonzero. UI updates
and JSONL formatting occur at capture boundaries rather than on every frame.

### Cross 11 investigation (2026-10-21)

Using the installed `7.0.0-v1.local.f78bff25f250ad31` preview:

- **32,765 nodes and 4,113 paint groups**: 4,096 groups of seven nodes, 16 groups
  of 255, and one root group of 13.
- Five isolated Node trials: median construction **575.4 ms**; median
  deserialization **312.9 ms**.
- Five production browser loads: median **2,475.7 ms** to first renderer pass,
  including **631.5 ms** construction and **310.3 ms** display reconstruction.
  Browser: Chrome 156, 1600 × 702 CSS pixels, DPR approximately 1.6.
- Five instrumented captures of six alternating wheel gestures (`+240`, `-240`
  at `(800, 350)`) abandoned **16–18 block-rendering passes** per capture and
  completed **5–6** passes. None performed geometry paint preparation. Median
  graph counting for progress took **294.2 ms** per capture; block/spotlight
  submission took **227.2 ms**. These are totals over approximately 1.5–1.7 s
  captures, not per-frame times.
- Five additional captures with per-step/group timers disabled still abandoned
  **16–18 block passes**, completed **six** passes, and performed **zero** repaints
  each. This confirms the partial-frame finding under lighter instrumentation;
  it is not a claim of uninstrumented frame rate or a renderer speedup.

The renderer clears the visible canvas before incrementally drawing groups.
Camera updates reset that drawing pass; later groups can repeatedly be omitted
from presented frames. Progress reporting also recounts the entire graph after
camera resets. Clean GPU geometry is already reused, so bitmap caching would
primarily reduce draw submission and pixel work. Adjacent cold groups could
share a cached region to amortize the many small groups here, but that introduces
region invalidation, splitting, scale selection, and memory policy. Investigate
repeated counting, culling, empty text work, and complete-frame presentation
before introducing that cache. No caching or rendering behavior was changed by
this instrumentation.

Local raw captures and the Matplotlib HTML report are under
`out/benchmarks/2026-10-21-cross-11/` (ignored generated artifacts). Use
`construction-isolated.jsonl` and `interaction-2.jsonl` through
`interaction-6.jsonl` for the measurements above; the earlier construction and
first interaction captures are exploratory. The lighter control uses
`interactions-light-1.jsonl` through `interactions-light-5.jsonl`.
`metadata.json` records build provenance and caveats. Camera motion was not performed
concurrently with builds, tests, or the Node timing runs.

### Reusing counts during camera movement

The renderer now retains node and paint-group totals across camera-only redraws.
A changed root or a root whose layout phase is not `COMMITTED` invalidates the
census before layout work resumes. Checking only `needsCommit()` is insufficient:
a graph can change beneath an already dirty node while its root is `IN_COMMIT`.
Per-pass progress and timing counters still reset normally.

Five matching detailed wheel captures with production `main.f3190348.js` performed
**zero graph recounts**. Median progress/status time fell from **302.1 ms** to
**4.1 ms** per six-gesture capture. Median maximum animation-frame gap was
**23.3 ms**, versus **38.3 ms** in the earlier captures, with a 42.3 ms outlier.
Captures were sequential and instrumented, and their elapsed times differed;
these observations do not establish an uninstrumented FPS improvement.

There were still **14–18 abandoned block passes** per capture. The presentation
scheduler has not changed. Completed passes still span several render slices,
so simply removing the draw-time limit risks delaying input handling. Drawing a
fixed camera pose into an offscreen framebuffer would allow yielding while
retaining the previous complete frame. New camera input would need to be
coalesced for the next frame instead of repeatedly cancelling the unfinished
one; text and overlays also need to agree on the presented camera pose.

Captures and comparison metadata are in
`out/benchmarks/2026-10-21-cross-11/count-cache/`. The earlier HTML report describes
the baseline investigation before this count-cache fix.

### Whole-viewport buffering

The renderer now draws each replacement using an immutable camera snapshot into
back framebuffers, retaining the existing cooperative 15 ms drawing budget.
Blocks, glyphs, document labels, and extents become eligible for display only
after the pass completes. Camera updates leave that pass running and coalesce
into one subsequent view at the latest camera position. Graph edits invalidate
unfinished work; replacing the graph, resizing, or losing the context also
discards incompatible displayed frames.

The main and extent WebGL contexts each retain front/back textures. A completed
texture is drawn to its preserved visible canvas once. Camera-only updates then
apply the same CSS transform to those canvases and the completed 2D text/label
layers, without submitting another GPU presentation call. Hover and selection
use a separate overlay at the live camera position. Late worker results are
checked against their graph revision and captured frame; text refinement can
request a subsequent complete pass, but cannot restart unfinished drawing.
World-label requests are cancellable and reuse their worker.

This is viewport buffering, not hot/cold paint-group caching. It does not reduce
graph traversal or add overscan. Zoom can temporarily soften the displayed
image, and panning can expose blank edges until the next complete frame arrives.
Pending world labels may appear after movement settles. The budget is checked
between renderer cranks; individual large groups, allocation, driver calls, or
garbage collection can still exceed it.

Five production captures with `main.e86c1ea3.js`, using the same cross-11 graph,
browser, viewport, and six alternating wheel gestures as above, showed:

- **Zero abandoned passes**, **zero graph recounts**, and **zero repaints** in
  every capture. All published frames visited all **4,113 paint groups**.
- **9–10 complete publications** per roughly **1.45–1.49 s** capture. Median
  capture-to-publication age was **101 ms** across the 47 published frames.
- Presentation CPU work averaged **0.18 ms** per update, including updates that
  publish a new texture. This does not measure GPU completion or input latency.
- Maximum frame gaps were **100.3, 19.3, 36.7, 24.5, and 20.9 ms**. The first
  capture retained a **99 ms long task**; the renderer still has occasional
  stalls even though partial-frame publication is eliminated.

The interaction trace now includes `present` events with the completed group
counters, captured/live camera poses, and publication age, plus aggregate
`Frame presentation` CPU timing. `clear` events now clear the offscreen back
buffer, not the displayed canvas. A pass-complete event alone does not measure
browser scanout.

Raw final captures and source/build provenance are under
`out/benchmarks/2026-10-21-cross-11/compositor/`. Earlier experiments under
`buffered/` presented the texture through WebGL on every camera update; those
captures include a **328.8 ms** presentation-call outlier and remain available.
All five final trials are retained, with no dropped events. Tests, builds, and
other benchmark jobs did not run concurrently with the final captures. These
are instrumented observations of completeness and timing, not a controlled FPS
speedup comparison. The earlier HTML report remains the pre-buffering baseline.

### Antialiasing the buffered image

The first buffered renderer used single-sample textures at CSS viewport size.
It lost the edge coverage supplied by the original canvas's antialiasing,
making the recursive cross's repeated subpixel connections produce strong
banding when zoomed out. The back textures now render at twice the logical
width and height; linear filtering averages their 2 × 2 samples when publishing
at the original viewport size. Camera projection and the cooperative drawing
budget are unchanged. This is
[supersampling](https://wikis.khronos.org/opengl/Multisample), with four times
the target storage and fragment work, without another graph traversal.

Each target is capped at 8 Mi pixels for supersampling. GPU texture/viewport
limits or allocation failure also fall back to native resolution. Limits are
cached per context, and failed sizes are remembered until context restoration.
At the cap, one front/back RGBA pair uses 64 MiB; the main and extent contexts
each have a pair, in addition to their visible canvases. Very small features
still merge together, and transient CSS scaling can still alias during motion.

Three matching six-gesture captures per build at minimum zoom (scale about
0.122846), with a 1600 × 702 CSS viewport, compared `main.e86c1ea3.js` against
supersampled `main.dcdc85c3.js`. All 22 baseline and 25 supersampled publications
visited all 4,113 groups, with no abandoned passes. Median publication age was
123 ms before and 117 ms after; average presentation CPU work was 0.12 ms and
0.15 ms respectively. Maximum frame gaps were 29.1/18.4/20.5 ms before and
46.9/19.9/19.4 ms after. These short sequential captures show similar observed
timing, not a speedup or a guarantee about GPU cost on other devices.

The settled comparison shows more even line coverage and reduced banding.
Raw captures, before/after screenshots, build provenance, and comparison caveats
are in `out/benchmarks/2026-10-21-cross-11/antialiasing/`. Its exploratory
`baseline.jsonl` is excluded from the comparison; all six controlled captures
are retained. The full 248-test suite and production build passed.

### Keyboard zoom and repeated input (2026-10-24)

Keyboard `+`/`-` still used a document refresh, abandoning unfinished rendering
and invalidating text-worker results on every press. It now uses the same
camera-only update path as wheel and pinch input, retaining the drawing budget
and allowing the current frame to finish. Keyboard zoom also uses a short
120 ms ease-out instead of restarting the node-travel ease-in on every repeat.
Node navigation and Fit graph retain their existing travel animation.

A deterministic test of 30 presses over one second reproduced the animation
problem in both directions: the old animation reached only 4.1% of the requested
log-scale change while input continued. The regression requires more than 90%
before release and the exact accumulated destination within another 150 ms.
A separate rendering test checks that repeated keyboard zoom preserves the
unfinished frame, camera snapshot, and text revision without notifying a
document change.

Local development captures of recursive cross at 11 rounds (32,765 nodes,
4,113 paint groups), using six `+` presses followed by six `-` presses, are in
`out/benchmarks/keyboard-zoom/{before,after}.jsonl`. The before/after captures
discarded 11/0 unfinished passes and both published 11 complete frames. Every
publication visited all 4,113 groups. Maximum frame gaps remained 110.4/105.7 ms;
this does not eliminate occasional rendering stalls. These are one exploratory
capture per version in Chrome 156, development mode, at 2400 × 1145, with detailed
instrumentation enabled. Key-delivery timing and capture duration differed
(4.06/3.73 seconds), so they establish the discarded-work fix, not an FPS speedup.

### Parsegraph 8.2.1 adoption (2026-11-02)

Freeform now pins `parsegraph@8.2.1` from the private VPN registry. Its lockfile
integrity matches the release handoff:

```text
sha512-2jQd/qNgRvljm/LVvZ4Us7kc+4Ap/9ix4PIALeRMU3umfvhztoDvkkzpHqFuTc1wWyglk4+zTFHRNK4LkER7yA==
```

The application supplies an explicit LTR layout default while preserving
inherited/LTR/RTL node declarations. Geometry-dependent camera, hit-testing,
overlays, and frame publication wait for `LayoutOperation.DONE`. Native saves,
history, and structured recovery migrate documents to v2; legacy inputs retain
their explicit LTR root and sparse legacy color overrides. Capability `/1`
identifiers and structured-language/recovery schema versions remain unchanged.
JSON/Lisp rebuilds preserve all three direction declarations. Telemetry now
records the installed Parsegraph version; existing renderer phase metrics are
not interpreted as library operation counts.

Local evidence is under `out/benchmarks/parsegraph-8.2.1-adoption/` (generated,
not committed): `index.html`, `summary.json`, `before/after-construction.jsonl`,
`before/after-camera.jsonl`, the identical saved-camera input, and bidi
screenshots. The baseline is commit `c012e1140b60cb22b107ed07fa96a0745c7913bc`,
production `main.dbee7783.js`; the upgraded working-tree build is
`main.bdcc13e4.js`. Earlier exploratory traces in the same directory are retained
but excluded: some used mismatched viewports/cameras, one baseline was truncated,
and early timings suffered severe host contention.

The corrected construction harness runs the actual builder and `readGraph`,
validates records by ID/topology, and explicitly accounts for the legacy root's
direction migration. Reconstruction holds the legacy v0 input fixed across
versions; it is not a measurement of current v2 history serialization. The
application remains installed from the registry; the old Yarn-cached package
was selected only through the benchmark's package override.

| Cross 11, five measurements after one warmup | 7.1.0 median | 8.2.1 median |
| --- | ---: | ---: |
| Construction | 597.1 ms | 56.8 ms |
| Legacy deserialization | 325.7 ms | 93.5 ms |

Both captures validate **32,765 nodes / 4,113 groups**. Construction ranges were
589.7–601.1 and 55.4–59.9 ms; deserialization ranges were 319.7–335.4 and
90.5–95.8 ms. These show about 10.5× faster construction and 3.5× faster
deserialization on this host, excluding layout and rendering.

The final browser pair used Chrome 156 production builds in the same visible
1561 × 412 viewport, DPR 2, detailed timing enabled, identical saved graph and
starting camera, six alternating wheel gestures, six alternating +/- keys,
and one drag. All **17 baseline / 14 upgraded publications** visited all 4,113
groups. Both captures recorded **zero abandoned passes, graph recounts, and
repaints**, with no dropped trace events. Maximum frame gaps were 158.0/131.2 ms.
Median publication ages were 118.8/230.7 ms: the latter is higher, and warrants
repeated captures before attributing a rendering regression. Input delivery,
intermediate culling trajectories, and capture lengths (7.0/11.5 s) differ;
this single pair establishes completeness, not an FPS or latency improvement.
Separate `cross_11` initial-load traces are diagnostic, not a controlled speed
comparison.

Visual checks covered inward labels under both surrounding directions, nested
overrides, camera fit, selection, and visual arrow navigation. Unit coverage
also runs both concrete layout defaults, legacy presentation/proportion
geometry, root resize, current-axis traversal, crease/uncrease, reparenting,
unfinished layout edits, native save/undo, and JSON/Lisp recovery. **905 app
tests / 51 suites**, the production build, and all **22 template preview
checks** passed. The Python deployment suite passed: **46 tests run, two
Linux-only tests skipped** on macOS. Export tests were rerun after correcting
the native format labels to v2.

This record describes local verification, not a commit, push, or deployment.
VPN registry version/integrity lookup was also verified from fritolaptop using
its configured CA. Before the first new-lockfile deployment, update the
installed controller so its configured CA reaches Node/Yarn; see
[VPN hosting](vpn-hosting.md#manual-artifact-build). The nested old core in
`parsegraph-showincamera@2.0.2` remains a dependency/bundle cleanup task; its used
duck-typed geometry helper passed camera checks.
