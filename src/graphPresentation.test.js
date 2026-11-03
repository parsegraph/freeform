import { Alignment, Bidi, CommitLayout, createPresentation, Direction, DirectionNode } from "parsegraph";
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
  const layout = new CommitLayout(root, painter, "ltr");
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
  const layout = new CommitLayout(root, painter, "ltr");
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

test.each([
  ["default horizontal inward", true, false, false, undefined, -47, 0, "left"],
  ["padded horizontal inward", true, false, false, 8, -39, 0, "left"],
  ["padded square horizontal inward", true, false, true, 8, -39, 0, "left"],
  ["default vertical inward", true, true, false, undefined, 0, -42.5, "center"],
  ["padded vertical inward", true, true, false, 8, 0, -42.5, "center"],
  ["default square vertical inward", true, true, true, undefined, 0, -42.5, "center"],
  ["padded square vertical inward", true, true, true, 8, 0, -34.5, "center"],
  ["padded leaf", false, false, false, 8, 0, 0, "center"],
])("presentation label coordinates respect side padding for %s", (
  name, hasInward, vertical, square, padding, x, y, textAlign
) => {
  const presentation = createPresentation();
  presentation.styles.custom = { ...presentation.styles.block, square };
  presentation.nodeStyles.label = "custom";
  const node = {
    effectiveBidi: () => "ltr",
    id: () => "label",
    value: () => "label",
    layout: () => ({
      size: (out) => { out[0] = 100; out[1] = 100; },
      absoluteX: () => 20,
      absoluteY: () => 30,
      absoluteScale: () => 0.5,
    }),
    neighbors: () => ({
      hasNode: () => hasInward,
      getAlignment: () => vertical ? Alignment.INWARD_VERTICAL : Alignment.NONE,
    }),
  };
  const ctx = context();
  drawDocumentLabel(
    ctx,
    node,
    { scale: () => 2, x: () => 10, y: () => -10 },
    presentation,
    { textColor: "#123456", textAlpha: 1 },
    padding
  );
  expect(ctx.fillText).toHaveBeenCalledWith("label", x, y);
  expect(ctx.textAlign).toBe(textAlign);
  expect(ctx.translate.mock.calls).toEqual([[10, -10], [20, 30]]);
  expect(ctx.scale.mock.calls).toEqual([[2, 2], [0.5, 0.5]]);
});

test("Memory Piers keeps static slider geometry and its original recipe after edits", () => {
  const root = readGraph(memory);
  const state = documentState(root);
  const layout = new CommitLayout(
    root,
    createDocumentLayout(state.presentation, context()),
    "ltr"
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

test.each([Bidi.LTR, Bidi.RTL])("horizontal inward labels follow each resolved scope in a %s layout", (surrounding) => {
  const root = new DirectionNode("outer");
  const inward = new DirectionNode("inner");
  const nested = new DirectionNode("nested");
  root.connect(Direction.INWARD, inward);
  inward.connect(Direction.INWARD, nested);
  inward.setBidi(surrounding === Bidi.LTR ? Bidi.RTL : Bidi.LTR);
  const presentation = createPresentation();
  const ctx = context();
  const job = new CommitLayout(root, createDocumentLayout(presentation, ctx), surrounding);
  while (job.crank()) {}
  for (const [node, rtl] of [[root, surrounding === Bidi.RTL], [inward, surrounding === Bidi.LTR]]) {
    ctx.fillText.mockClear();
    drawDocumentLabel(ctx, node, { scale: () => 1, x: () => 0, y: () => 0 },
      presentation, { textColor: "#000000", textAlpha: 1 });
    const [label, x] = ctx.fillText.mock.calls[0];
    expect(label).toBe(node.value());
    expect(Math.sign(x)).toBe(rtl ? 1 : -1);
    expect(ctx.textAlign).toBe(rtl ? "right" : "left");
    const child = node.neighbors().nodeAt(Direction.INWARD);
    expect(Math.sign(child.layout().absoluteX() - node.layout().absoluteX())).toBe(rtl ? -1 : 1);
  }
  expect(root.bidi()).toBe(Bidi.INHERIT);
  expect(nested.bidi()).toBe(Bidi.INHERIT);
});
