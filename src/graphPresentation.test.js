import { CommitLayout } from "parsegraph";
import { readGraph, documentState, graphNodes } from "./graphDocument";
import { createDocumentLayout, drawDocumentLabel } from "./graphPresentation";
import standard from "./fixtures/v1/proportion-standard.json";
import proportional from "./fixtures/v1/proportion-proportional.json";
import math from "./fixtures/v1/proportion-math.json";
import standardGeometry from "./fixtures/v1/proportion-standard.geometry.json";
import proportionalGeometry from "./fixtures/v1/proportion-proportional.geometry.json";
import mathGeometry from "./fixtures/v1/proportion-math.geometry.json";
import memory from "./fixtures/v1/memory-piers.json";
import { writeGraph } from "./graphDocument";

function context() {
  return {
    save: jest.fn(),
    restore: jest.fn(),
    resetTransform: jest.fn(),
    scale: jest.fn(),
    translate: jest.fn(),
    fillText: jest.fn(),
    measureText: (line) => ({ width: [...line].length * 6 }),
  };
}

test.each([
  ["standard", standard, standardGeometry],
  ["proportional", proportional, proportionalGeometry],
  ["math", math, mathGeometry],
])("Freeform geometry matches the %s fixture", (name, fixture, expected) => {
  const root = readGraph(fixture);
  const painter = createDocumentLayout(
    documentState(root).presentation,
    context()
  );
  const layout = new CommitLayout(root, painter);
  let steps = 0;
  while (layout.crank()) expect(++steps).toBeLessThan(10000);
  graphNodes(root).forEach((node) => {
    const size = [0, 0];
    node.layout().size(size);
    const target = expected[node.id()];
    expect(node.layout().absoluteX()).toBeCloseTo(target.x, 5);
    expect(node.layout().absoluteY()).toBeCloseTo(target.y, 5);
    expect(size[0]).toBeCloseTo(target.width, 5);
    expect(size[1]).toBeCloseTo(target.height, 5);
  });
  if (name === "proportional") {
    const endpoints = graphNodes(root).filter(
      (node) => typeof node.value() === "string" && node.value()
    );
    expect(
      new Set(endpoints.map((node) => node.layout().absoluteY())).size
    ).toBe(1);
  }
});

test("text drawing and measurement use the same newline, font, and line-height policy", () => {
  const root = readGraph(standard);
  root.setValue("A\r\n😀\r");
  const presentation = documentState(root).presentation;
  presentation.text = { fontFamily: "serif", fontSize: 14, lineHeight: 18 };
  const ctx = context();
  const painter = createDocumentLayout(presentation, ctx);
  const layout = new CommitLayout(root, painter);
  while (layout.crank());
  drawDocumentLabel(
    ctx,
    root,
    { scale: () => 1, x: () => 0, y: () => 0 },
    presentation,
    { textColor: "#123456", textAlpha: 0 }
  );
  expect(ctx.font).toBe("normal 14px serif");
  expect(ctx.fillText.mock.calls.map(([line]) => line)).toEqual([
    "A",
    "😀",
    "",
  ]);
  expect(ctx.fillText.mock.calls[1][2] - ctx.fillText.mock.calls[0][2]).toBe(
    18
  );
  root.setValue({ label: "not standard text" });
  const size = [];
  expect(() => painter.size(root, size)).not.toThrow();
  ctx.fillText.mockClear();
  drawDocumentLabel(
    ctx,
    root,
    { scale: () => 1, x: () => 0, y: () => 0 },
    presentation,
    { textColor: "#123456", textAlpha: 1 }
  );
  expect(ctx.fillText).not.toHaveBeenCalled();
});

test("Memory Piers keeps static slider geometry and its original recipe after edits", () => {
  const root = readGraph(memory);
  const state = documentState(root);
  const layout = new CommitLayout(
    root,
    createDocumentLayout(state.presentation, context())
  );
  while (layout.crank());
  const sliders = graphNodes(root).filter(
    (node) => state.presentation.nodeStyles[node.id()] === "slider"
  );
  expect(sliders.length).toBeGreaterThan(0);
  sliders.forEach((node) => {
    const size = [];
    node.layout().size(size);
    expect(size).toEqual([320, 15]);
  });
  root.setValue("edited");
  expect(writeGraph(root).capabilities["generation/1"]).toEqual(
    memory.capabilities["generation/1"]
  );
  expect(
    writeGraph(root).nodes.find((node) => node.id === root.id()).value
  ).toBe("edited");
});
