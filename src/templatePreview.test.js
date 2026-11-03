import { Alignment, Bidi, Direction, DirectionNode } from "parsegraph";
import { renderTemplatePreview } from "./templatePreview";
import { documentState, graphNodes, readGraph } from "./graphDocument";
import { buildPlanner } from "./builders";
import appearanceFixture from "./fixtures/v1/appearance-colors.json";
import mathFixture from "./fixtures/v1/proportion-math.json";
import mathGeometry from "./fixtures/v1/proportion-math.geometry.json";

function parse(svg) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(doc.querySelector("parsererror")).toBeNull();
  return doc.documentElement;
}

function label(svg, value) {
  return Array.from(svg.querySelectorAll("text")).find(
    (text) => text.textContent === value
  );
}

test("renders actual legacy node geometry, lines across paint groups, and escaped text", () => {
  const root = new DirectionNode("<parent & child>");
  const child = new DirectionNode('"nested"');
  root.connect(Direction.FORWARD, child);
  child.setScale(0.5);
  child.paintGroups().crease();
  const svg = parse(
    renderTemplatePreview(
      { graph: root },
      { measureText: (text) => text.length * 6 }
    )
  );
  expect(svg.querySelectorAll("g")).toHaveLength(2);
  const childBody = label(svg, '"nested"').parentElement;
  expect(childBody.getAttribute("transform")).toBe(
    `translate(${child.layout().absoluteX()} ${child
      .layout()
      .absoluteY()}) scale(0.5)`
  );
  expect(label(svg, "<parent & child>").getAttribute("textLength")).toBe("96");
  expect(
    Array.from(svg.children).filter((child) => child.localName === "rect")
  ).toHaveLength(2); // Page + actual connector.
  expect(svg.querySelector("rect").getAttribute("fill")).toBe("#edf0ef");
});

test("v1 thumbnails retain fixture geometry and use squared presentation styles", () => {
  const graph = readGraph(mathFixture);
  const svg = parse(
    renderTemplatePreview(
      { graph },
      { measureText: (line) => Array.from(line).length * 6 }
    )
  );
  graphNodes(graph).forEach((node) => {
    const expected = mathGeometry[node.id()];
    const size = [];
    node.layout().size(size);
    expect(node.layout().absoluteX()).toBeCloseTo(expected.x, 5);
    expect(node.layout().absoluteY()).toBeCloseTo(expected.y, 5);
    expect(size[0]).toBeCloseTo(expected.width, 5);
    expect(size[1]).toBeCloseTo(expected.height, 5);
  });
  const squared = graphNodes(graph).filter((node) => {
    const presentation = documentState(graph).presentation;
    return presentation.styles[
      presentation.nodeStyles[node.id()] ?? presentation.defaultStyle
    ].square;
  });
  expect(squared.length).toBeGreaterThan(0);
  expect(svg.querySelectorAll('g > rect[rx="0"]')).toHaveLength(squared.length);
});

test("appearance defaults, per-node alpha, and legacy viewport overrides survive", () => {
  const graph = readGraph(appearanceFixture);
  const appearance = documentState(graph).appearance;
  const svg = parse(
    renderTemplatePreview({
      graph,
      viewportData: {
        defaultNodeStyle: { borderColor: "#123456" },
        styles: { child: { textColor: "#abcdef", textAlpha: 0 } },
        pageBackgroundColor: "rgba(1, 2, 3, 0.5)",
      },
    })
  );
  const defaultBody = label(svg, "Default").parentElement.querySelector("rect");
  expect(defaultBody.getAttribute("fill")).toBe(
    appearance.defaults.backgroundColor
  );
  expect(defaultBody.getAttribute("stroke")).toBe("#123456");
  const transparent = label(svg, "Transparent").parentElement.querySelector(
    "rect"
  );
  expect(Number(transparent.getAttribute("fill-opacity"))).toBe(
    appearance.nodeStyles.transparent.backgroundAlpha
  );
  expect(label(svg, "Override").getAttribute("fill")).toBe("#abcdef");
  expect(label(svg, "Override").getAttribute("fill-opacity")).toBe("0");
  expect(svg.querySelector("rect").getAttribute("fill")).toBe("#010203");
  expect(svg.querySelector("rect").getAttribute("fill-opacity")).toBe("0.5");
  const view = svg.getAttribute("viewBox").split(" ").map(Number);
  expect(view[2] / view[3]).toBeCloseTo(480 / 300, 4);
  expect(svg.getAttribute("style")).toBeNull(); // Paint page alpha only once.
});

test.each([false, true])(
  "inward content follows its container, with vertical alignment %s",
  (vertical) => {
    const root = new DirectionNode("Parent");
    const child = new DirectionNode("Child");
    root.connect(Direction.INWARD, child);
    if (vertical)
      root.neighbors().align(Direction.INWARD, Alignment.INWARD_VERTICAL);
    const svg = parse(renderTemplatePreview({ graph: root }));
    expect(
      Array.from(svg.querySelectorAll("text")).map((text) => text.textContent)
    ).toEqual(["Parent", "Child"]);
    const parentLabel = label(svg, "Parent");
    expect(parentLabel.getAttribute("text-anchor")).toBe(
      vertical ? "middle" : "start"
    );
    expect(Number(parentLabel.getAttribute(vertical ? "y" : "x"))).toBeLessThan(
      0
    );
  }
);

test("planner framing crops the view while preserving the complete graph", () => {
  const graph = buildPlanner(5);
  const before = graphNodes(graph).length;
  const whole = parse(renderTemplatePreview({ graph }));
  const cropped = parse(renderTemplatePreview({ graph }, { cropHeight: 200 }));
  expect(graphNodes(graph)).toHaveLength(before);
  expect(cropped.querySelectorAll("g")).toHaveLength(before);
  const view = cropped.getAttribute("viewBox").split(" ").map(Number);
  expect(view[3]).toBe(224);
  expect(view[3]).toBeLessThan(
    Number(whole.getAttribute("viewBox").split(" ")[3])
  );
  expect(cropped.querySelectorAll("text").length).toBeGreaterThan(
    whole.querySelectorAll("text").length
  );
  expect(
    cropped.querySelectorAll("g")[before - 1].getAttribute("transform")
  ).toBe(whole.querySelectorAll("g")[before - 1].getAttribute("transform"));
});

test("numeric and Canvas text measurers agree, and invalid measurements fail clearly", () => {
  const render = (measureText) =>
    renderTemplatePreview(
      { graph: new DirectionNode("test") },
      { measureText }
    );
  expect(render(() => 31)).toBe(render(() => ({ width: 31 })));
  expect(() => render(() => NaN)).toThrow("text measurement");
  expect(() =>
    renderTemplatePreview({ graph: new DirectionNode() }, { width: 0 })
  ).toThrow("dimensions");
  expect(() =>
    renderTemplatePreview({ graph: new DirectionNode() }, { cropHeight: -1 })
  ).toThrow("crop height");
});

test.each([Bidi.LTR, Bidi.RTL])("previews preserve inherited declarations and draw mixed-direction labels/connectors under %s", (defaultDirection) => {
  const root = new DirectionNode("Outer");
  const inner = new DirectionNode("Inner");
  const opposite = new DirectionNode("Opposite");
  const nested = new DirectionNode("Nested");
  root.connect(Direction.INWARD, inner);
  root.connect(Direction.FORWARD, opposite);
  opposite.setBidi(defaultDirection === Bidi.LTR ? Bidi.RTL : Bidi.LTR);
  opposite.connect(Direction.INWARD, nested);
  opposite.connect(Direction.FORWARD, new DirectionNode("Inherited branch"));
  opposite.paintGroups().crease();
  const svg = parse(renderTemplatePreview({ graph: root }, { defaultDirection }));
  const rtl = defaultDirection === Bidi.RTL;
  expect(label(svg, "Outer").getAttribute("text-anchor")).toBe(rtl ? "end" : "start");
  expect(label(svg, "Opposite").getAttribute("text-anchor")).toBe(rtl ? "start" : "end");
  expect(Math.sign(opposite.layout().absoluteX())).toBe(rtl ? -1 : 1);
  const line = Array.from(svg.children).filter((item) => item.localName === "rect")[1];
  const middle = Number(line.getAttribute("x")) + Number(line.getAttribute("width")) / 2;
  expect(Math.sign(middle)).toBe(rtl ? -1 : 1);
  expect(Number(line.getAttribute("width"))).toBeGreaterThan(0);
  const oppositeSize = [];
  opposite.layout().absoluteSize(oppositeSize);
  // At a bidi boundary the connector reaches the near extent silhouette,
  // rather than crossing the region to its far-side entry body.
  const nearBodyEdge = opposite.layout().absoluteX() + (rtl ? 1 : -1) * oppositeSize[0] / 2;
  const endpoint = middle + (rtl ? -1 : 1) * Number(line.getAttribute("width")) / 2;
  expect((endpoint - nearBodyEdge) * (rtl ? -1 : 1)).toBeLessThan(0);
  expect(root.bidi()).toBe(Bidi.INHERIT);
  expect(inner.bidi()).toBe(Bidi.INHERIT);
});
