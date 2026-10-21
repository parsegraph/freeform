import { Direction, DirectionNode } from "parsegraph";
import * as builders from "./builders";
import * as importers from "./importers";
import { MAX_ROUNDS } from "./settings";
import { readGraph } from "./graphDocument";
import proportional from "./fixtures/v1/proportion-proportional.json";
import standard from "./fixtures/v1/proportion-standard.json";
import math from "./fixtures/v1/proportion-math.json";
import colors from "./fixtures/v1/appearance-colors.json";
import memory from "./fixtures/v1/memory-piers.json";

const DOCUMENT_EXAMPLES = { proportion_v1: proportional, proportion_standard_v1: standard,
  proportion_math_v1: math, appearance_v1: colors, memory_piers_v1: memory };

const TYPES = new Set([
  "blank", "json", "lisp", "grid", "daily_planner_5", "daily_planner_10",
  "daily_planner_15", "daily_planner_30", "daily_planner_60", "random",
  "alt_columns", "march_madness", "march_madness_vert", "playoffs",
  "playoffs_vert", "march", "rainbow", "rainbow_vert", "rainbow_random", "cross",
  ...Object.keys(DOCUMENT_EXAMPLES),
]);
const RANDOM_TYPES = new Set(["random", "alt_columns", "rainbow_random"]);

export function normalizeExample(value) {
  if (!value || !TYPES.has(value.type)) return null;
  const result = { type: value.type };
  if (value.type === "march" || value.type === "cross") {
    const max = value.type === "cross" ? MAX_ROUNDS - 3 : MAX_ROUNDS;
    result.rounds = Number.isInteger(value.rounds) ? Math.max(1, Math.min(max, value.rounds)) : 5;
    if (value.type === "march") result.vertical = value.vertical === true;
  }
  if (value.type === "grid" && value.size !== undefined) {
    if (!Number.isInteger(value.size) || value.size < 1 || value.size > 500) return null;
    result.size = value.size;
  }
  if (RANDOM_TYPES.has(value.type)) {
    if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) return null;
    result.seed = value.seed;
  }
  return result;
}

export function createExample(type, options = {}) {
  return normalizeExample({
    ...options,
    type,
    seed: options.seed ?? Math.floor(Math.random() * 0x100000000),
  });
}

export function exampleFromSample(sample) {
  if (!sample) return null;
  if (TYPES.has(sample)) return createExample(sample);
  const parts = sample.split("_");
  switch (parts[0]) {
    case "grid": return createExample("grid", { size: Number(parts[1]) });
    case "cross": return createExample("cross", { rounds: Number(parts[1]) });
    case "playoffs": return createExample(parts[1]?.startsWith("vert") ? "playoffs_vert" : "playoffs");
    case "march":
      if (parts[1] === "madness") {
        return createExample(parts[2]?.startsWith("vert") ? "march_madness_vert" : "march_madness");
      }
      return createExample("march", { rounds: Number(parts[1]), vertical: parts[2]?.startsWith("vert") });
    default: return null;
  }
}

// Keep random examples reproducible without storing their generated graph.
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function tournamentRounds(count) {
  return Array.from({ length: count }, (_, i) =>
    ["Championship", "Semifinals", "Quarterfinals"][i] || "Round " + (count - i)
  );
}

export async function loadExample(value) {
  const example = normalizeExample(value);
  if (!example) throw new Error("Unknown example or invalid example options.");
  if (DOCUMENT_EXAMPLES[example.type]) {
    return { graph: readGraph(DOCUMENT_EXAMPLES[example.type]), selectedNode: null,
      viewportData: null, example };
  }
  const random = seededRandom(example.seed ?? 0);
  let args;
  switch (example.type) {
    case "blank": args = [new DirectionNode()]; break;
    case "json":
    case "lisp": {
      const response = await fetch(example.type === "json" ? "/package.json" : "/surface.lisp");
      if (!response.ok) throw new Error("Could not load the example.");
      const text = await response.text();
      const graph = example.type === "json"
        ? importers.graphJson(JSON.parse(text))
        : importers.graphLisp(text);
      args = [graph, example.type === "json" && graph.neighbors().hasChild(Direction.INWARD)
        ? graph.neighbors().nodeAt(Direction.INWARD) : null];
      break;
    }
    case "grid": args = [builders.buildGrid(example.size)]; break;
    case "daily_planner_5":
    case "daily_planner_10":
    case "daily_planner_15":
    case "daily_planner_30":
    case "daily_planner_60": args = [builders.buildPlanner(Number(example.type.split("_")[2]))]; break;
    case "random": args = [builders.buildRandom(250, random)]; break;
    case "alt_columns": args = builders.buildAlternatingColumns(random); break;
    case "march_madness": args = [builders.buildMarchMadness(false)]; break;
    case "march_madness_vert": args = [builders.buildMarchMadness(true)]; break;
    case "playoffs": args = [builders.buildFootballPlayoffs(false)]; break;
    case "playoffs_vert": args = [builders.buildFootballPlayoffs(true)]; break;
    case "march": args = [builders.buildTournament(example.vertical, ...tournamentRounds(example.rounds))]; break;
    case "rainbow": args = builders.buildRainbow(); break;
    case "rainbow_vert": args = builders.buildRainbow(true); break;
    case "rainbow_random": args = builders.buildRandomRainbow(random); break;
    case "cross": args = [builders.buildCross(example.rounds)]; break;
    default: throw new Error("Unknown example.");
  }
  const [graph, selectedNode = null, , viewportData = null] = args;
  return { graph, selectedNode, viewportData, example };
}
