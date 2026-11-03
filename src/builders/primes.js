import {
  createPresentation,
  DirectionCaret,
  serializeParsegraphDocument,
} from "parsegraph";
import Color from "parsegraph-color";
import { appearanceFromViewport } from "../graphDocument";

export const DEFAULT_PRIMES_MAX = 30;
export const PRIMES_SLIDER_MAX = 1000;

/**
 * Prime-divisor chart from Parsegraph's examples/generators/primes.ts.
 * The number line runs FORWARD, with one UPWARD cell per discovered prime.
 * max is the largest integer shown, inclusive, not the number of primes.
 */
export function buildPrimesGraph(max = DEFAULT_PRIMES_MAX) {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error("Maximum must be a positive safe integer.");
  }

  const caret = new DirectionCaret("1");
  caret.node().setId("primes-1");
  const knownPrimes = [];
  for (let number = 2; number <= max; ++number) {
    caret.spawnMove("f", String(number)).setId(`primes-${number}`);
    caret.push();
    caret.pull("u");
    let isPrime = true;
    for (let index = 0; index < knownPrimes.length; ++index) {
      const prime = knownPrimes[index];
      const divides = number % prime === 0;
      caret
        .spawnMove("u", divides ? String(prime) : "")
        .setId(`primes-${number}-factor-${prime}`);
      if (divides) isPrime = false;
      // Retain the original widget's paint-group interval.
      if (index % 250 === 0) caret.crease();
    }
    if (isPrime) {
      caret
        .spawnMove("u", String(number))
        .setId(`primes-${number}-factor-${number}`);
      knownPrimes.push(number);
    }
    caret.pop();
  }
  return caret.root();
}

function primeColor(value) {
  const number = Number(value);
  if (number < 2) return null;
  for (let divisor = 2; divisor * divisor <= number; ++divisor) {
    if (number % divisor === 0) return null;
  }
  // Color depends only on the prime, even when the chart's maximum changes.
  return Color.fromLCH(82, 35, (number * 137.508) % 360, 1).asHex();
}

export function buildPrimesDocument(max = DEFAULT_PRIMES_MAX) {
  const root = buildPrimesGraph(max);
  const presentation = createPresentation("math");
  const appearance = appearanceFromViewport({});
  const colors = new Map();
  // Empty cells occupy the same space as labels, so prime rows stay aligned.
  const side = (String(max).length + 2) * presentation.text.fontSize;
  for (const style of Object.values(presentation.styles)) {
    style.minWidth = style.minHeight = side;
  }
  root.paintGroup().forEach((group) =>
    group.siblings().forEach((node) => {
      const id = String(node.id());
      const value = node.value();
      presentation.nodeStyles[id] = value === "" ? "slot" : "block";
      if (value !== "") {
        if (!colors.has(value)) {
          colors.set(value, primeColor(value));
        }
        const backgroundColor = colors.get(value);
        if (backgroundColor) {
          appearance.nodeStyles[id] = { backgroundColor };
        }
      }
    })
  );
  return serializeParsegraphDocument(root, { presentation, appearance });
}
