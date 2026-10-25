import { CommitLayout, Direction } from "parsegraph";
import { buildProportionDocument } from "./index";
import { createDocumentLayout } from "../graphPresentation";
import { documentState, graphNodes, readGraph } from "../graphDocument";
import fixture from "../fixtures/v1/proportion-proportional.json";
import fixtureGeometry from "../fixtures/v1/proportion-proportional.geometry.json";

function commit(graph) {
  const context = {
    save() {}, restore() {}, resetTransform() {},
    measureText: (line) => ({ width: Array.from(line).length * 6 }),
  };
  const layout = new CommitLayout(graph, createDocumentLayout(documentState(graph).presentation, context));
  while (layout.crank());
  return graph;
}

test("default proportion document preserves the 25-node v1 fixture and its geometry", () => {
  // Node-table order is not semantic; the current package traverses independent
  // paint groups in a different order than the fixture's original generator.
  const canonical = (document) => ({
    ...document,
    nodes: [...document.nodes].sort((a, b) => a.id.localeCompare(b.id)),
  });
  expect(canonical(buildProportionDocument())).toEqual(canonical(fixture));
  const graph = commit(readGraph(buildProportionDocument(3)));
  expect(graphNodes(graph)).toHaveLength(25);
  graphNodes(graph).forEach((node) => {
    const expected = fixtureGeometry[node.id()];
    const size = [];
    node.layout().size(size);
    expect(node.layout().absoluteX()).toBeCloseTo(expected.x, 5);
    expect(node.layout().absoluteY()).toBeCloseTo(expected.y, 5);
    expect(size[0]).toBeCloseTo(expected.width, 5);
    expect(size[1]).toBeCloseTo(expected.height, 5);
  });
});

test.each([1, 5, 12])("count %s creates that many paired columns with level endpoints", (count) => {
  const data = buildProportionDocument(count);
  expect(data.nodes).toHaveLength(count * count + 4 * count + 4);
  expect(new Set(data.nodes.map((node) => node.id)).size).toBe(data.nodes.length);
  const graph = commit(readGraph(data));
  let row = graph;
  const endpoints = [];
  for (let index = 0; index < count; ++index) {
    for (const side of [Direction.BACKWARD, Direction.FORWARD]) {
      let node = row.neighbors().nodeAt(side);
      expect(node.value()).toBeUndefined();
      for (let step = 0; step < count - index; ++step) node = node.neighbors().nodeAt(Direction.DOWNWARD);
      expect(node.value()).toBe(String(count - index));
      expect(node.neighbors().hasChild(Direction.DOWNWARD)).toBe(false);
      endpoints.push(node);
    }
    row = row.neighbors().nodeAt(Direction.DOWNWARD);
    expect(row.value()).toBe("");
  }
  expect(row.neighbors().hasChild(Direction.DOWNWARD)).toBe(false);
  expect(endpoints).toHaveLength(2 * count);
  endpoints.forEach((node) => expect(node.layout().absoluteY()).toBeCloseTo(endpoints[0].layout().absoluteY(), 5));
});

test("upper bound is accepted and generated IDs stay deterministic", () => {
  const data = buildProportionDocument(200);
  expect(data.nodes).toHaveLength(40804);
  expect(new Set(data.nodes.map((node) => node.id)).size).toBe(data.nodes.length);
  expect(buildProportionDocument(5)).toEqual(buildProportionDocument(5));
});

test.each([0, -1, 201, 2.5, NaN, Infinity, "3", null])("rejects invalid count %s", (count) => {
  expect(() => buildProportionDocument(count)).toThrow("integer between 1 and 200");
});
