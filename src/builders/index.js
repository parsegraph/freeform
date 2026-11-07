import * as builders from "./builders";
import { normalizeGraph } from "../graphDocument";

export { buildProportionDocument } from "./proportion";
export {
  buildPrimesDocument,
  buildPrimesGraph,
  DEFAULT_PRIMES_MAX,
  PRIMES_SLIDER_MAX,
} from "./primes";

// Builders return a graph, or [graph, selectedNode, , viewportData]. They are
// finished as documents here rather than in their bodies, which stay free of
// app imports so the construction benchmarks can run their exact source.
const finished = (build) => (...args) => {
  const result = build(...args);
  if (Array.isArray(result)) {
    normalizeGraph(result[0]);
    return result;
  }
  return normalizeGraph(result);
};

export const buildMarchMadness = finished(builders.buildMarchMadness);
export const buildFootballPlayoffs = finished(builders.buildFootballPlayoffs);
export const buildTournament = finished(builders.buildTournament);
export const buildAlternatingColumns = finished(builders.buildAlternatingColumns);
export const buildGrid = finished(builders.buildGrid);
export const buildPlanner = finished(builders.buildPlanner);
export const buildRandom = finished(builders.buildRandom);
export const buildRandomRainbow = finished(builders.buildRandomRainbow);
export const buildRainbow = finished(builders.buildRainbow);
export const buildCross = finished(builders.buildCross);
