#!/usr/bin/env node
"use strict";

// Uses the app's actual recursive-cross builder and readGraph implementation.
// These are construction/deserialization measurements, not layout or rendering.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { execFileSync } = require("node:child_process");
const project = path.resolve(__dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const packageFile = process.env.PARSEGRAPH_BENCHMARK_PACKAGE
  ? path.join(
      path.resolve(process.env.PARSEGRAPH_BENCHMARK_PACKAGE),
      "package.json"
    )
  : require.resolve("parsegraph/package.json");
const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
if (packageJson.name !== "parsegraph")
  throw new Error(`Expected a parsegraph package at ${packageFile}`);
const packageEntry = require.resolve(path.dirname(packageFile));
const parsegraph = require(packageEntry);
const buildersSource = fs.readFileSync(
  path.join(project, "src/builders/builders.js"),
  "utf8"
);
const settingsSource = fs.readFileSync(
  path.join(project, "src/settings.js"),
  "utf8"
);
const documentSource = fs.readFileSync(
  path.join(project, "src/graphDocument.js"),
  "utf8"
);

function matchSource(source, expression, name) {
  const match = source.match(expression);
  if (!match)
    throw new Error(
      `Cannot locate ${name}; update the harness for the new source structure.`
    );
  return match[1];
}
const creaseRounds = Number(
  matchSource(settingsSource, /const CREASE_ROUNDS = (\d+);/, "CREASE_ROUNDS")
);
const maxRounds = Number(
  matchSource(settingsSource, /const MAX_ROUNDS = (\d+);/, "MAX_ROUNDS")
);
const builderSource = matchSource(
  buildersSource,
  /const buildCross = ([\s\S]*?);\s*\n\s*export \{/,
  "buildCross"
);
const buildCross = new Function(
  "DirectionCaret",
  "forEachCardinalDirection",
  "turnLeft",
  "turnRight",
  "CREASE_ROUNDS",
  `return (${builderSource});`
)(
  parsegraph.DirectionCaret,
  parsegraph.forEachCardinalDirection,
  parsegraph.turnLeft,
  parsegraph.turnRight,
  creaseRounds
);
// Extract both helpers instead of maintaining a separate reconstruction path.
const graphNodesSource = matchSource(
  documentSource,
  /export (function graphNodes\(root\) \{[\s\S]*?\n\})\s*\n\s*export function ensureStringIds/,
  "graphNodes"
);
const readGraphSource = matchSource(
  documentSource,
  /export (function readGraph\(data\) \{[\s\S]*?\n\})\s*\n\s*export function graphViewport/,
  "readGraph"
);
const graphNodes = new Function(`return (${graphNodesSource});`)();
const readGraph = new Function(
  "deserializeParsegraphDocument",
  "graphNodes",
  "DOCUMENT_STATE",
  "own",
  "CURRENT_DOCUMENT_VERSION",
  `return (${readGraphSource});`
)(
  parsegraph.deserializeParsegraphDocument,
  graphNodes,
  Symbol.for("parsegraph.freeform.document"),
  (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key),
  Number(documentSource.match(/export const CURRENT_DOCUMENT_VERSION = (\d+);/)?.[1] ?? 1)
);

function usage() {
  return `Usage: node --expose-gc scripts/cross-construction-benchmark.cjs [options]
  --rounds 11              Comma-separated recursion depths (0 through ${maxRounds})
  --runs 5                 Measured repetitions per depth and case
  --warmups 1              Untimed repetitions per depth and case
  --seed 1729              Deterministic shuffle of trial order
  --output PATH.jsonl      New JSONL capture (otherwise stdout)
  --help                   Show this help

Runs the exact app buildCross and readGraph sources. Construction and legacy v0
deserialization are timed independently, with semantic validation after each
trial. Fixture preparation, serialization, validation, explicit GC, and output
are outside timers. Layout, paint preparation, browser rendering, and scrolling
are not measured. Set PARSEGRAPH_BENCHMARK_PACKAGE to select another built
parsegraph package without replacing the app dependency.
`;
}

function options(args) {
  const config = { rounds: [11], runs: 5, warmups: 1, seed: 1729 };
  for (let i = 0; i < args.length; ++i) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (
      !["--rounds", "--runs", "--warmups", "--seed", "--output"].includes(arg)
    )
      throw new Error(`Unknown argument ${arg}`);
    const value = args[++i];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}`);
    const key = arg.slice(2);
    config[key] =
      key === "rounds"
        ? value.split(",").map(Number)
        : key === "output"
        ? path.resolve(value)
        : Number(value);
  }
  for (const [key, min] of [
    ["runs", 1],
    ["warmups", 0],
    ["seed", 1],
  ])
    if (!Number.isSafeInteger(config[key]) || config[key] < min)
      throw new Error(`Invalid --${key}`);
  if (
    !config.rounds.length ||
    config.rounds.some(
      (rounds) =>
        !Number.isSafeInteger(rounds) || rounds < 0 || rounds > maxRounds
    ) ||
    new Set(config.rounds).size !== config.rounds.length
  )
    throw new Error(
      `Invalid --rounds; expected unique integers between 0 and ${maxRounds}`
    );
  return config;
}

// Stable IDs are irrelevant to equivalence. Every other serialized node field,
// including shrinking, layout preference, and crease boundaries, is retained.
function fingerprint(document) {
  const records = new Map(document.nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of document.nodes) {
    if (node.parentId === null) continue;
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  }
  for (const nodes of children.values())
    nodes.sort((a, b) => a.parentDir.localeCompare(b.parentDir));
  const queue = [{ node: records.get(document.root), parent: null }];
  const canonical = [];
  const visited = new Set();
  for (let index = 0; index < queue.length; ++index) {
    const { node, parent } = queue[index];
    if (!node || visited.has(node.id))
      throw new Error("Invalid document traversal");
    visited.add(node.id);
    const record = { parent };
    for (const key of Object.keys(node).sort())
      if (key !== "id" && key !== "parentId") record[key] = node[key];
    canonical.push(record);
    for (const child of children.get(node.id) || [])
      queue.push({ node: child, parent: index });
  }
  if (canonical.length !== document.nodes.length)
    throw new Error("Unreachable nodes in document");
  return hash(JSON.stringify(canonical));
}

function census(root) {
  let nodeCount = 0;
  let paintGroupCount = 0;
  const paintGroupNodeHistogram = {};
  root.paintGroup().forEach((group) => {
    ++paintGroupCount;
    let count = 0;
    group.siblings().forEach(() => ++count);
    nodeCount += count;
    paintGroupNodeHistogram[count] = (paintGroupNodeHistogram[count] || 0) + 1;
  });
  return { nodeCount, paintGroupCount, paintGroupNodeHistogram };
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
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    runs: sorted.length,
    medianMs:
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

function main() {
  const config = options(process.argv.slice(2));
  let output;
  if (config.output) {
    fs.mkdirSync(path.dirname(config.output), { recursive: true });
    output = fs.openSync(config.output, "wx");
  }
  const emit = (record) => {
    const line = JSON.stringify(record) + "\n";
    if (output !== undefined) fs.writeSync(output, line);
    else process.stdout.write(line);
  };
  try {
    let revision = null;
    try {
      revision = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: project,
        encoding: "utf8",
      }).trim();
    } catch (_) {
      /* Optional provenance. */
    }
    emit({
      type: "metadata",
      schema: "freeform-cross-construction/1",
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
      parsegraphVersion: packageJson.version,
      parsegraphEntry: packageEntry,
      parsegraphPackage: packageFile,
      parsegraphSource: packageJson.freeformBenchmarkSource || null,
      creaseRounds,
      hashes: {
        harness: hash(fs.readFileSync(__filename)),
        builder: hash(builderSource),
        buildersFile: hash(buildersSource),
        settings: hash(settingsSource),
        readGraph: hash(readGraphSource),
        graphNodes: hash(graphNodesSource),
        graphDocumentFile: hash(documentSource),
        parsegraphBundle: hash(fs.readFileSync(packageEntry)),
      },
      timing:
        "Only synchronous buildCross or app readGraph calls; excludes fixture preparation, serialization, semantic validation, explicit GC, and output. No layout, paint preparation, rendering, or scrolling.",
      snapshotFormat:
        "legacy v0 (__parsegraph), held fixed for version comparisons; current native history may use a newer format",
      semanticValidationFormat: "installed library document format, outside timed regions; legacy root direction migration checked separately",
    });
    const prepared = new Map();
    for (const rounds of config.rounds) {
      process.stderr.write(`Preparing recursive cross ${rounds}...\n`);
      let root = buildCross(rounds);
      const counts = census(root);
      const expectedNodeCount = 2 ** (rounds + 4) - 3;
      if (counts.nodeCount !== expectedNodeCount)
        throw new Error(
          `Expected ${expectedNodeCount} nodes at ${rounds} rounds, found ${counts.nodeCount}; review builder semantics.`
        );
      const document = parsegraph.serializeParsegraph(root);
      const semanticDocument = parsegraph.serializeParsegraphDocument(root);
      const semanticFingerprint = fingerprint(semanticDocument);
      // v2 intentionally migrates v0 to an explicit LTR root. Freshly built
      // nodes inherit, so compare that one declaration against its expected
      // migration rather than treating it as a construction regression.
      const migratedDocument = JSON.parse(JSON.stringify(semanticDocument));
      if (migratedDocument.version === 2) {
        if (migratedDocument.nodes.some((node) => node.bidi !== "inherit"))
          throw new Error("Review the benchmark: cross now authors explicit bidi declarations.");
        migratedDocument.nodes.find((node) => node.id === migratedDocument.root).bidi = "ltr";
      }
      const legacyFingerprint = fingerprint(migratedDocument);
      prepared.set(rounds, { document, semanticFingerprint, legacyFingerprint, counts });
      emit({
        type: "fixture",
        rounds,
        ...counts,
        expectedNodeCount,
        explicitPaintGroupCount: semanticDocument.nodes.filter(
          (node) => node.paintGroup
        ).length,
        semanticFingerprint,
        legacyFingerprint,
        snapshotBytes: Buffer.byteLength(JSON.stringify(document)),
      });
      root = null;
    }
    const trials = config.rounds.flatMap((rounds) =>
      ["construction", "deserialization"].map((kind) => ({ rounds, kind }))
    );
    const rng = random(config.seed);
    const measured = [];
    let sequence = 0;
    for (
      let repetition = -config.warmups;
      repetition < config.runs;
      ++repetition
    ) {
      const warmup = repetition < 0;
      for (const { rounds, kind } of shuffled(trials, rng)) {
        if (global.gc) global.gc();
        const fixture = prepared.get(rounds);
        const started = performance.now();
        let root =
          kind === "construction"
            ? buildCross(rounds)
            : readGraph(fixture.document);
        const elapsedMs = performance.now() - started;
        const actual = parsegraph.serializeParsegraphDocument(root);
        const actualFingerprint = fingerprint(actual);
        const counts = census(root);
        if (
          actualFingerprint !== (kind === "deserialization" ? fixture.legacyFingerprint : fixture.semanticFingerprint) ||
          JSON.stringify(counts) !== JSON.stringify(fixture.counts)
        )
          throw new Error(
            `Semantic or paint-group mismatch: recursive cross ${rounds}, ${kind}`
          );
        const record = {
          type: warmup ? "warmup" : "run",
          sequence: ++sequence,
          repetition: warmup ? repetition + config.warmups + 1 : repetition + 1,
          rounds,
          case: kind,
          elapsedMs,
          ...counts,
          semanticFingerprint: actualFingerprint,
          validated: true,
        };
        root = null;
        emit(record);
        if (!warmup) measured.push(record);
        process.stderr.write(
          `${record.type} ${
            record.repetition
          }: cross ${rounds} ${kind}: ${elapsedMs.toFixed(3)} ms\n`
        );
      }
    }
    emit({
      type: "summary",
      completedAt: new Date().toISOString(),
      runs: measured.length,
      results: trials.map(({ rounds, kind }) => ({
        rounds,
        case: kind,
        ...summarize(
          measured
            .filter(
              (record) => record.rounds === rounds && record.case === kind
            )
            .map((record) => record.elapsedMs)
        ),
      })),
    });
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
