#!/usr/bin/env node
"use strict";

// Construction-only ablations. No browser, layout, renderer, or worker is used.
// Run with --expose-gc to collect between trials, outside the timed regions.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { execFileSync } = require("node:child_process");
const project = path.resolve(__dirname, "..");
// Select a built package explicitly without changing the app's dependency.
// Resolve metadata and runtime from the same package so comparisons are labeled
// with the version actually measured, including optional build provenance.
const parsegraphPackagePath = process.env.PARSEGRAPH_BENCHMARK_PACKAGE
  ? path.join(
      path.resolve(process.env.PARSEGRAPH_BENCHMARK_PACKAGE),
      "package.json"
    )
  : require.resolve("parsegraph/package.json");
const parsegraphPackage = JSON.parse(
  fs.readFileSync(parsegraphPackagePath, "utf8")
);
if (parsegraphPackage.name !== "parsegraph")
  throw new Error(`Expected a parsegraph package at ${parsegraphPackagePath}`);
const parsegraphPath = require.resolve(path.dirname(parsegraphPackagePath));
const {
  Direction,
  DirectionCaret,
  DirectionNode,
  PreferredAxis,
  PaintGroup,
  Siblings,
  serializeParsegraph,
  serializeParsegraphDocument,
  deserializeParsegraphDocument,
} = require(parsegraphPath);

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const source = fs.readFileSync(
  path.join(project, "src/builders/builders.js"),
  "utf8"
);
const settings = fs.readFileSync(path.join(project, "src/settings.js"), "utf8");
const gridMatch = source.match(
  /const buildGrid = ([\s\S]*?);\s*\nconst buildAlternatingColumns/
);
if (!gridMatch)
  throw new Error(
    "Cannot locate buildGrid; update the harness for the new source structure."
  );
const gridSource = gridMatch[1];
const setting = (name) => {
  const match = settings.match(new RegExp(`const ${name} = (\\d+);`));
  if (!match) throw new Error(`Cannot read ${name}`);
  return Number(match[1]);
};
const creaseRounds = setting("CREASE_ROUNDS");
// Compile the actual builder, so baseline does not silently drift from the app.
const compileBuilder = (body) =>
  new Function(
    "DirectionCaret",
    "Direction",
    "CREASE_ROUNDS",
    "SIZE",
    `return (${body});`
  )(DirectionCaret, Direction, creaseRounds, setting("MAX_ROUNDS"));
const baseline = compileBuilder(gridSource);
const modified = (transform) => compileBuilder(transform(gridSource));
function checkedReplace(body, target, replacement, expectedCount) {
  const pieces = body.split(target);
  const count = pieces.length - 1;
  if (count !== expectedCount) {
    throw new Error(
      "Builder ablation expected " +
        expectedCount +
        " occurrences of " +
        JSON.stringify(target) +
        ", found " +
        count +
        "; update the harness for the new builder source."
    );
  }
  return pieces.join(replacement);
}

// Match readGraph's deserialize, complete node collection, unsupported-value
// scan, and document-state attachment. Built-in grids use the app's legacy v0
// snapshots, not v1. The v1 serializer is used ONLY for semantic validation.
const documentState = Symbol.for("parsegraph.freeform.document");
function readGraph(document) {
  const loaded = deserializeParsegraphDocument(document);
  const nodes = [];
  loaded.root
    .paintGroup()
    .forEach((group) => group.siblings().forEach((node) => nodes.push(node)));
  loaded.hasUnsupportedContent = nodes.some(
    (node) =>
      node.value() !== undefined &&
      typeof node.value() !== "string" &&
      typeof node.value() !== "number"
  );
  Object.defineProperty(loaded.root, documentState, {
    value: loaded,
    configurable: true,
  });
  return loaded.root;
}

function rawGrid(size, precrease = false) {
  const root = new DirectionNode();
  function spawn(parent, direction, value, crease) {
    const node = new DirectionNode();
    node.setValue(value);
    if (precrease && crease) node.paintGroups().crease();
    parent.connect(direction, node);
    // DirectionCaret.spawn sets both of these after connecting.
    node.siblings().setLayoutPreference(PreferredAxis.PERPENDICULAR);
    node.setNodeFit(parent.nodeFit());
    if (!precrease && crease) node.paintGroups().crease();
    return node;
  }
  let column = root;
  for (let col = 0; col < size; ++col) {
    column = spawn(
      column,
      Direction.DOWNWARD,
      undefined,
      col % creaseRounds === 0
    );
    let cell = column;
    for (let row = 0; row < size; ++row) {
      cell = spawn(cell, Direction.FORWARD, row, row % creaseRounds === 0);
    }
  }
  return root;
}

// Register each variant together with its intended semantic change and the
// control it should be compared against. Add new ablations here.
const variants = [
  {
    id: "baseline",
    compareTo: null,
    kind: "construction",
    omittedFields: [],
    description:
      "Exact app buildGrid source: caret, labels, string directions, push/pop, connect then crease.",
    run: (size) => baseline(size),
  },
  {
    id: "no-creases",
    compareTo: "baseline",
    kind: "construction",
    omittedFields: ["paintGroup"],
    description:
      "Remove explicit crease calls; intentionally changes paint-group boundaries.",
    run: modified((body) => checkedReplace(body, "car.crease();", "", 2)),
  },
  {
    id: "no-values",
    compareTo: "baseline",
    kind: "construction",
    omittedFields: ["value"],
    description:
      "Do not assign numeric cell labels; intentionally changes node values.",
    run: modified((body) =>
      checkedReplace(body, 'car.spawnMove("f", row);', 'car.spawnMove("f");', 1)
    ),
  },
  {
    id: "numeric-directions",
    compareTo: "baseline",
    kind: "construction",
    omittedFields: [],
    description:
      "Use numeric Direction enums instead of string direction parsing.",
    run: modified((body) =>
      checkedReplace(
        checkedReplace(body, '"d"', "Direction.DOWNWARD", 1),
        '"f"',
        "Direction.FORWARD",
        1
      )
    ),
  },
  {
    id: "no-push-pop",
    compareTo: "baseline",
    kind: "construction",
    omittedFields: [],
    description:
      "Save the column node in a local and moveTo it instead of caret push/pop.",
    run: modified((body) =>
      checkedReplace(
        checkedReplace(body, "car.push();", "const column = car.node();", 1),
        "car.pop();",
        "car.moveTo(column);",
        1
      )
    ),
  },
  {
    id: "raw-nodes",
    compareTo: "baseline",
    kind: "construction",
    omittedFields: [],
    description:
      "Remove caret operations while retaining fit, preferred axis, values, crease timing, and connection order.",
    run: (size) => rawGrid(size),
  },
  {
    id: "raw-precreased",
    compareTo: "raw-nodes",
    kind: "construction",
    omittedFields: [],
    description:
      "Crease each detached node before connecting it, retaining original grid connection order.",
    run: (size) => rawGrid(size, true),
  },
  {
    id: "deserialize",
    compareTo: "baseline",
    kind: "deserialization",
    omittedFields: [],
    description:
      "App-equivalent readGraph from baseline legacy v0 snapshot, in the serializer's paint-group/sibling traversal order.",
    run: (_size, prepared) => readGraph(prepared.document),
  },
  {
    id: "deserialize-creation-order",
    compareTo: "deserialize",
    kind: "deserialization",
    omittedFields: [],
    description:
      "Same readGraph and snapshot, reordered to original grid node creation order; no other document changes.",
    run: (_size, prepared) => readGraph(prepared.creationOrderDocument),
  },
  {
    id: "deserialize-only",
    compareTo: "deserialize",
    kind: "deserialization",
    omittedFields: [],
    description:
      "Library deserialization without the app's unsupported-content scan or state attachment.",
    run: (_size, prepared) =>
      deserializeParsegraphDocument(prepared.document).root,
  },
  {
    id: "baseline-no-verifies",
    compareTo: "baseline",
    kind: "construction",
    omittedFields: [],
    diagnostic: true,
    description:
      "Diagnostic only: disable PaintGroup.verify and Siblings.verify while building. Opt in with --cases; excluded from defaults because prototype patches can affect JIT optimization of other trials.",
    setup() {
      const paintVerify = PaintGroup.prototype.verify;
      const siblingVerify = Siblings.prototype.verify;
      PaintGroup.prototype.verify = () => {};
      Siblings.prototype.verify = () => {};
      return () => {
        PaintGroup.prototype.verify = paintVerify;
        Siblings.prototype.verify = siblingVerify;
      };
    },
    run: (size) => baseline(size),
  },
];

function usage() {
  return `Usage: node --expose-gc scripts/grid-construction-benchmark.cjs [options]
  --sizes 30,70,100         Grid side lengths (positive integers)
  --runs 5                 Measured repetitions per size and case
  --warmups 1              Untimed repetitions per size and case
  --cases ${variants.map((v) => v.id).join(",")}
                           Defaults to all non-diagnostic cases; use comma-separated IDs
  --seed 1729              Deterministic trial-order shuffle seed
  --output PATH.jsonl      Write JSONL here (otherwise stdout)
  --list                   List cases and exit
  --help                   Show this help

Set PARSEGRAPH_BENCHMARK_PACKAGE to a built parsegraph package directory to
compare versions without installing them. Defaults to Freeform's installed
package. Its version, resolved entry, bundle hash, and optional package.json
freeformBenchmarkSource provenance are recorded in the metadata.

Only build/deserialization calls are timed. The legacy v0 library path does
not perform the v1 validation/JSON clone. Fixture preparation,
serialization for semantic validation, explicit GC, and output are outside
the timer. Results are Node measurements, not browser first-paint timings.
`;
}

function options(args) {
  const config = {
    sizes: [30, 70, 100],
    runs: 5,
    warmups: 1,
    seed: 1729,
    cases: variants.filter((v) => !v.diagnostic).map((v) => v.id),
  };
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--list") {
      process.stdout.write(
        variants.map((v) => `${v.id}: ${v.description}`).join("\n") + "\n"
      );
      process.exit(0);
    }
    if (
      ![
        "--sizes",
        "--runs",
        "--warmups",
        "--seed",
        "--cases",
        "--output",
      ].includes(arg)
    )
      throw new Error(`Unknown argument ${arg}`);
    const value = args[++i];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}`);
    const key = arg.slice(2);
    config[key] =
      key === "sizes"
        ? value.split(",").map(Number)
        : key === "cases"
        ? value.split(",")
        : key === "output"
        ? path.resolve(value)
        : Number(value);
  }
  for (const [key, min] of [
    ["runs", 1],
    ["warmups", 0],
    ["seed", 1],
  ]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < min)
      throw new Error(`Invalid --${key}`);
  }
  if (
    !config.sizes.length ||
    config.sizes.some((size) => !Number.isSafeInteger(size) || size < 1)
  )
    throw new Error("Invalid --sizes");
  if (new Set(config.sizes).size !== config.sizes.length)
    throw new Error("Duplicate --sizes");
  if (
    !config.cases.length ||
    new Set(config.cases).size !== config.cases.length ||
    config.cases.some((id) => !variants.find((v) => v.id === id))
  )
    throw new Error("Invalid or duplicate --cases");
  return config;
}

// An ID-independent topology walk provides stable parent indexes and retains
// every serialized semantic field. Child direction determines traversal order.
function canonicalNodes(document, omittedFields = []) {
  const records = new Map(document.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of document.nodes) {
    if (node.parentId === null) continue;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  }
  for (const list of children.values())
    list.sort((a, b) => a.parentDir.localeCompare(b.parentDir));
  const queue = [{ node: records.get(document.root), parent: null }];
  const canonical = [];
  const visited = new Set();
  for (let index = 0; index < queue.length; ++index) {
    const { node, parent } = queue[index];
    if (!node || visited.has(node.id))
      throw new Error("Invalid document traversal");
    visited.add(node.id);
    const result = { parent };
    for (const key of Object.keys(node).sort()) {
      if (key !== "id" && key !== "parentId" && !omittedFields.includes(key))
        result[key] = node[key];
    }
    canonical.push(result);
    for (const child of children.get(node.id) || [])
      queue.push({ node: child, parent: index });
  }
  if (canonical.length !== document.nodes.length)
    throw new Error("Unreachable nodes in document");
  return canonical;
}
const fingerprint = (document, omittedFields = []) =>
  hash(JSON.stringify(canonicalNodes(document, omittedFields)));

function creationOrder(document) {
  const children = new Map();
  for (const record of document.nodes) {
    if (record.parentId !== null)
      children.set(`${record.parentId}/${record.parentDir}`, record);
  }
  let column = document.nodes.find((record) => record.id === document.root);
  const nodes = [column];
  while ((column = children.get(`${column.id}/upward`))) {
    nodes.push(column);
    let cell = column;
    while ((cell = children.get(`${cell.id}/backward`))) nodes.push(cell);
  }
  if (nodes.length !== document.nodes.length)
    throw new Error("Snapshot is not the expected grid topology");
  return { ...document, nodes };
}

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function shuffled(values, rng) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; --i) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function main() {
  const config = options(process.argv.slice(2));
  const chosen = config.cases.map((id) => variants.find((v) => v.id === id));
  let output;
  if (config.output) {
    fs.mkdirSync(path.dirname(config.output), { recursive: true });
    // Refuse to silently overwrite an earlier benchmark capture.
    output = fs.openSync(config.output, "wx");
  }
  const emit = (record) => {
    const line = JSON.stringify(record) + "\n";
    if (output !== undefined) fs.writeSync(output, line);
    else process.stdout.write(line);
  };
  let revision = null;
  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: project,
      encoding: "utf8",
    }).trim();
  } catch (_) {
    /* Optional metadata. */
  }
  emit({
    type: "metadata",
    schema: "freeform-grid-construction/1",
    capturedAt: new Date().toISOString(),
    config,
    revision,
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    explicitGc: typeof global.gc === "function",
    parsegraphVersion: parsegraphPackage.version,
    parsegraphEntry: parsegraphPath,
    parsegraphPackage: parsegraphPackagePath,
    parsegraphSource: parsegraphPackage.freeformBenchmarkSource || null,
    creaseRounds,
    hashes: {
      harness: hash(fs.readFileSync(__filename)),
      builder: hash(gridSource),
      buildersFile: hash(source),
      settings: hash(settings),
      readGraphFile: hash(
        fs.readFileSync(path.join(project, "src/graphDocument.js"))
      ),
      parsegraphBundle: hash(fs.readFileSync(parsegraphPath)),
    },
    timing:
      "Only synchronous construction/readGraph calls, including the selected library path's overhead; excludes fixture creation, semantic serialization, explicit GC, setup/restore of diagnostic patches, and output. Legacy v0 deserialization performs neither v1 validation nor a JSON clone.",
    snapshotFormat:
      "legacy v0 (__parsegraph), matching built-in grid writeGraph",
    semanticValidationFormat: "v1, outside timed regions",
    cases: chosen.map(({ run, setup, ...definition }) => ({
      ...definition,
      equivalentToBaseline: definition.omittedFields.length === 0,
    })),
  });
  const prepared = new Map();
  for (const size of config.sizes) {
    process.stderr.write(`Preparing baseline snapshot for grid ${size}...\n`);
    let root = baseline(size);
    const document = serializeParsegraph(root);
    const semanticDocument = serializeParsegraphDocument(root);
    root = null;
    const creationOrderIds = creationOrder(semanticDocument).nodes.map(
      (record) => record.id
    );
    const creationOrderDocument = {
      __parsegraph: Object.fromEntries(
        creationOrderIds.map((id) => [id, document.__parsegraph[id]])
      ),
    };
    const actualCreationOrder = Object.keys(creationOrderDocument.__parsegraph);
    if (
      actualCreationOrder.length !== creationOrderIds.length ||
      actualCreationOrder.some((id, index) => id !== creationOrderIds[index])
    ) {
      throw new Error(
        "Legacy object keys did not retain the requested grid creation order; integer-like IDs require a different ordering control."
      );
    }
    const entry = { document, creationOrderDocument, hashes: new Map() };
    for (const variant of chosen)
      entry.hashes.set(
        variant.id,
        fingerprint(semanticDocument, variant.omittedFields)
      );
    prepared.set(size, entry);
    emit({
      type: "fixture",
      size,
      nodeCount: semanticDocument.nodes.length,
      explicitPaintGroupCount: semanticDocument.nodes.filter(
        (n) => n.paintGroup
      ).length,
      semanticFingerprint: fingerprint(semanticDocument),
      snapshotBytes: Buffer.byteLength(JSON.stringify(document)),
    });
  }
  const rng = random(config.seed);
  const trials = config.sizes.flatMap((size) =>
    chosen.map((variant) => ({ size, variant }))
  );
  const measured = [];
  let sequence = 0;
  for (let round = -config.warmups; round < config.runs; ++round) {
    const warmup = round < 0;
    for (const { size, variant } of shuffled(trials, rng)) {
      if (global.gc) global.gc();
      const input = prepared.get(size);
      const cleanup = variant.setup?.();
      let root;
      let elapsedMs;
      try {
        const start = performance.now();
        root = variant.run(size, input);
        elapsedMs = performance.now() - start;
      } finally {
        cleanup?.();
      }
      // Validation is deliberately after the timer, including warmups.
      const actual = serializeParsegraphDocument(root);
      const comparableFingerprint = fingerprint(actual, variant.omittedFields);
      if (comparableFingerprint !== input.hashes.get(variant.id)) {
        throw new Error(
          `Semantic mismatch: grid ${size}, ${variant.id}; only ${
            variant.omittedFields.join(", ") || "IDs/order"
          } may differ`
        );
      }
      let paintGroupCount = 0;
      root.paintGroup().forEach(() => ++paintGroupCount);
      const record = {
        type: warmup ? "warmup" : "run",
        sequence: ++sequence,
        repetition: warmup ? round + config.warmups + 1 : round + 1,
        size,
        case: variant.id,
        kind: variant.kind,
        elapsedMs,
        nodeCount: actual.nodes.length,
        paintGroupCount,
        explicitPaintGroupCount: actual.nodes.filter((node) => node.paintGroup)
          .length,
        equivalentToBaseline: variant.omittedFields.length === 0,
        semanticFingerprint: fingerprint(actual),
        comparableFingerprint,
        validated: true,
      };
      root = null;
      emit(record);
      if (!warmup) measured.push(record);
      process.stderr.write(
        `${warmup ? "warmup" : "run"} ${record.repetition}: grid ${size} ${
          variant.id
        }: ${elapsedMs.toFixed(3)} ms\n`
      );
    }
  }
  const summaries = trials.map(({ size, variant }) => {
    const times = measured
      .filter((r) => r.size === size && r.case === variant.id)
      .map((r) => r.elapsedMs)
      .sort((a, b) => a - b);
    return {
      size,
      case: variant.id,
      runs: times.length,
      medianMs:
        times.length % 2
          ? times[Math.floor(times.length / 2)]
          : (times[times.length / 2 - 1] + times[times.length / 2]) / 2,
      minMs: times[0],
      maxMs: times[times.length - 1],
    };
  });
  emit({
    type: "summary",
    completedAt: new Date().toISOString(),
    runs: measured.length,
    results: summaries,
  });
  if (output !== undefined) fs.closeSync(output);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
