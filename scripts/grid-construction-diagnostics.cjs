#!/usr/bin/env node
"use strict";

// Count algorithmic work separately from timing: wrappers perturb performance.
// No layout, rendering, browser APIs, or worker is involved.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
// Match the timing harness's opt-in package selection and provenance metadata.
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
const parsegraph = require(parsegraphPath);
const project = path.resolve(__dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function options(args) {
  let size = 30;
  for (let index = 0; index < args.length; ++index) {
    if (args[index] === "--help" || args[index] === "-h") {
      process.stdout.write(
        "Usage: node scripts/grid-construction-diagnostics.cjs [--size 30]\n\n" +
          "Writes JSON operation counts for the current buildGrid and legacy\n" +
          "deserialization in serializer order versus original creation order.\n" +
          "These are instrumented operation counts, not elapsed-time measurements.\n\n" +
          "Set PARSEGRAPH_BENCHMARK_PACKAGE to a built parsegraph package directory\n" +
          "to compare versions without installing them. Defaults to Freeform's\n" +
          "installed package; metadata identifies the selected runtime.\n"
      );
      return null;
    }
    if (args[index] !== "--size")
      throw new Error(`Unknown argument ${args[index]}`);
    size = Number(args[++index]);
    if (!Number.isSafeInteger(size) || size < 1)
      throw new Error("Invalid --size");
  }
  return { size };
}

function loadBuilder() {
  const source = fs.readFileSync(
    path.join(project, "src/builders/builders.js"),
    "utf8"
  );
  const settings = fs.readFileSync(
    path.join(project, "src/settings.js"),
    "utf8"
  );
  const match = source.match(
    /const buildGrid = ([\s\S]*?);\s*\nconst buildAlternatingColumns/
  );
  if (!match)
    throw new Error(
      "Cannot locate buildGrid; update the diagnostic for the new source structure."
    );
  const setting = (name) => {
    const found = settings.match(new RegExp(`const ${name} = (\\d+);`));
    if (!found) throw new Error(`Cannot read ${name}`);
    return Number(found[1]);
  };
  const creaseRounds = setting("CREASE_ROUNDS");
  const buildGrid = new Function(
    "DirectionCaret",
    "Direction",
    "CREASE_ROUNDS",
    "SIZE",
    `return (${match[1]});`
  )(
    parsegraph.DirectionCaret,
    parsegraph.Direction,
    creaseRounds,
    setting("MAX_ROUNDS")
  );
  return {
    buildGrid,
    creaseRounds,
    hashes: {
      builder: hash(match[1]),
      buildersFile: hash(source),
      settings: hash(settings),
    },
  };
}

function creationOrder(root, snapshot) {
  const { DOWNWARD, FORWARD } = parsegraph.Direction;
  const ids = [root.id()];
  let column = root;
  while ((column = column.neighbors().nodeAt(DOWNWARD))) {
    ids.push(column.id());
    let cell = column;
    while ((cell = cell.neighbors().nodeAt(FORWARD))) ids.push(cell.id());
  }
  const records = snapshot.__parsegraph;
  if (
    ids.length !== Object.keys(records).length ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("Snapshot is not the expected grid topology");
  }
  const ordered = Object.fromEntries(ids.map((id) => [id, records[id]]));
  // Integer property names would be reordered by JavaScript's Object.keys.
  if (Object.keys(ordered).some((id, index) => id !== String(ids[index]))) {
    throw new Error(
      "Node IDs do not retain the requested object insertion order"
    );
  }
  return { __parsegraph: ordered };
}

function graphCounts(root) {
  const seen = new Set();
  let groups = 0;
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (seen.has(node))
      throw new Error("Duplicate node or cycle in graph topology");
    seen.add(node);
    if (node.paintGroups().isPaintGroup()) ++groups;
    for (
      let direction = 0;
      direction < parsegraph.NUM_DIRECTIONS;
      ++direction
    ) {
      if (direction === node.neighbors().parentDirection()) continue;
      const child = node.neighbors().nodeAt(direction);
      if (child) pending.push(child);
    }
  }
  return { nodes: seen.size, paintGroups: groups };
}

function countCalls(root, operation) {
  // Resolve the prototypes from installed runtime instances rather than relying
  // on implementation modules being individually importable from the bundle.
  const methods = [
    [
      root.neighbors().constructor.prototype,
      "parentNode",
      "Neighbors.parentNode",
    ],
    [root.paintGroup().constructor.prototype, "next", "PaintGroup.next"],
    [root.siblings().constructor.prototype, "verify", "Siblings.verify"],
    [root.paintGroup().constructor.prototype, "verify", "PaintGroup.verify"],
  ];
  const counters = Object.fromEntries(methods.map(([, , key]) => [key, 0]));
  const restore = [];
  let result;
  try {
    for (const [prototype, name, key] of methods) {
      const original = prototype[name];
      restore.push(() => {
        prototype[name] = original;
      });
      prototype[name] = function () {
        ++counters[key];
        return original.apply(this, arguments);
      };
    }
    result = operation();
  } finally {
    for (const undo of restore.reverse()) undo();
  }
  // Validation and serialization are deliberately outside instrumented work.
  return { counters, graph: graphCounts(result) };
}

function main() {
  const config = options(process.argv.slice(2));
  if (!config) return;
  const { buildGrid, creaseRounds, hashes } = loadBuilder();
  // Fixture preparation, serialization, and record reordering are not counted.
  const root = buildGrid(config.size);
  const snapshot = parsegraph.serializeParsegraph(root);
  const reordered = creationOrder(root, snapshot);
  const expected = graphCounts(root);
  if (expected.nodes !== 1 + config.size + config.size * config.size) {
    throw new Error("Unexpected node count from current buildGrid");
  }
  const cases = [
    ["build", () => buildGrid(config.size)],
    ["deserialize", () => parsegraph.deserializeParsegraph(snapshot)],
    [
      "deserialize-creation-order",
      () => parsegraph.deserializeParsegraph(reordered),
    ],
  ].map(([id, operation]) => {
    const result = countCalls(root, operation);
    if (
      result.graph.nodes !== expected.nodes ||
      result.graph.paintGroups !== expected.paintGroups
    ) {
      throw new Error(`${id} produced different node or paint-group counts`);
    }
    return { id, ...result };
  });
  process.stdout.write(
    JSON.stringify(
      {
        schema: "freeform-grid-construction-diagnostics/1",
        capturedAt: new Date().toISOString(),
        config,
        node: process.version,
        v8: process.versions.v8,
        parsegraphVersion: parsegraphPackage.version,
        parsegraphEntry: parsegraphPath,
        parsegraphPackage: parsegraphPackagePath,
        parsegraphSource: parsegraphPackage.freeformBenchmarkSource || null,
        creaseRounds,
        hashes: {
          ...hashes,
          diagnostic: hash(fs.readFileSync(__filename)),
          parsegraphBundle: hash(fs.readFileSync(parsegraphPath)),
        },
        methodology: [
          "Operation counts only; prototype wrappers perturb execution, so no timings are reported.",
          "The baseline compiles the exact current buildGrid function from src/builders/builders.js.",
          "Both deserialization cases use identical already-parsed legacy records; only insertion order changes.",
          "Creation order is root, then each DOWNWARD spine node followed by its FORWARD chain.",
          "Fixture preparation, serialization, reordering, and final count validation are outside instrumentation.",
          "Each counter includes all calls to its named method, not only calls from one internal caller.",
        ],
        cases,
      },
      null,
      2
    ) + "\n"
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
