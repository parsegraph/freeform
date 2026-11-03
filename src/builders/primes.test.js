import { Bidi, CommitLayout, Direction } from "parsegraph";
import {
  buildPrimesDocument,
  buildPrimesGraph,
  DEFAULT_PRIMES_MAX,
} from "./index";
import { createDocumentLayout } from "../graphPresentation";
import {
  documentState,
  graphNodes,
  readGraph,
  writeGraph,
} from "../graphDocument";

function commit(graph) {
  const context = {
    save() {},
    restore() {},
    resetTransform() {},
    measureText: (line) => ({ width: Array.from(line).length * 6 }),
  };
  const layout = new CommitLayout(
    graph,
    createDocumentLayout(documentState(graph).presentation, context),
    Bidi.LTR
  );
  while (layout.crank());
  return graph;
}

test("numbers run forward through the inclusive maximum with distinct prime divisors upward", () => {
  const root = buildPrimesGraph(13);
  const columns = [];
  let node = root;
  do {
    expect(node.value()).toBe(String(columns.length + 1));
    const factors = [];
    let cell = node.neighbors().nodeAt(Direction.UPWARD);
    while (cell) {
      factors.push(cell.value());
      cell = cell.neighbors().nodeAt(Direction.UPWARD);
    }
    columns.push(factors);
    node = node.neighbors().nodeAt(Direction.FORWARD);
  } while (node);
  expect(columns).toHaveLength(13);
  expect(columns[0]).toEqual([]);
  expect(columns[1]).toEqual(["2"]);
  expect(columns[2]).toEqual(["", "3"]);
  expect(columns[3]).toEqual(["2", ""]);
  expect(columns[11]).toEqual(["2", "3", "", "", ""]);
  expect(columns[12]).toEqual(["", "", "", "", "", "13"]);
});

test("math presentation keeps blank cells full-sized and prime rows aligned after a native round trip", () => {
  const document = buildPrimesDocument(30);
  expect(document.version).toBe(2);
  expect(document.nodes.every((node) => node.bidi === Bidi.INHERIT)).toBe(true);
  const root = commit(readGraph(writeGraph(readGraph(document))));
  const presentation = documentState(root).presentation;
  const cells = graphNodes(root);
  const byId = new Map(cells.map((node) => [node.id(), node]));
  const side = 4 * presentation.text.fontSize;
  const primeRowY = new Map();
  for (const node of cells) {
    const size = [];
    node.layout().size(size);
    expect(size).toEqual([side, side]);
    expect(presentation.nodeStyles[node.id()]).toBe(
      node.value() === "" ? "slot" : "block"
    );
    const [, number, factor] = /^primes-(\d+)(?:-factor-(\d+))?$/.exec(
      node.id()
    );
    const base = byId.get(`primes-${number}`).layout();
    expect(node.layout().absoluteX()).toBeCloseTo(base.absoluteX(), 5);
    if (factor) {
      const y = node.layout().absoluteY();
      expect(y).toBeLessThan(base.absoluteY());
      if (!primeRowY.has(factor)) primeRowY.set(factor, y);
      expect(y).toBeCloseTo(primeRowY.get(factor), 5);
    } else {
      expect(base.absoluteY()).toBeCloseTo(root.layout().absoluteY(), 5);
      expect(base.absoluteX()).toBeCloseTo((Number(number) - 1) * side, 5);
    }
  }
  expect(primeRowY.size).toBe(10);
});

test("default and minimum limits produce deterministic native documents", () => {
  expect(DEFAULT_PRIMES_MAX).toBe(30);
  expect(buildPrimesDocument()).toEqual(buildPrimesDocument(30));
  const minimum = readGraph(buildPrimesDocument(1));
  expect(graphNodes(minimum)).toHaveLength(1);
  expect(minimum.value()).toBe("1");
});

test("a large chart includes its final integer with unique node IDs", () => {
  const document = buildPrimesDocument(1000);
  const ids = new Set(document.nodes.map((node) => node.id));
  expect(ids.size).toBe(document.nodes.length);
  expect(ids.has("primes-1000")).toBe(true);
  expect(ids.has("primes-1001")).toBe(false);
  expect(ids.has("primes-1000-factor-997")).toBe(true);
  expect(ids.has("primes-1000-factor-1000")).toBe(false);
});

test.each([0, -1, Number.MAX_SAFE_INTEGER + 1, 2.5, NaN, Infinity, "30", null])(
  "rejects invalid maximum %s",
  (max) => {
    expect(() => buildPrimesDocument(max)).toThrow(
      "positive safe integer"
    );
  }
);
