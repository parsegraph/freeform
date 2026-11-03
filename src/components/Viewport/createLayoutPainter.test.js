import { Font, GlyphPainter } from "parsegraph-glyphpainter";
import { WebGLBlockPainter } from "parsegraph-blockpainter";
import SpotlightPainter from "parsegraph-spotlightpainter";
import {
  Alignment,
  Bidi,
  Axis,
  CommitLayout,
  createPresentation,
  Direction,
  DirectionNode,
  paintNodeLines,
} from "parsegraph";
import { createLayoutPainter } from "./createLayoutPainter";
import TypedBlockPainter from "./TypedBlockPainter";
import { hasJsonNodeBorder, JSON_BORDER_PADDING } from "../../structuredJsonBorders";
import { createStructuredJson } from "../../structuredJson";
import { jsonNodeKind } from "../../structuredJsonAppearance";
import { graphNodes } from "../../graphDocument";
import { FONT_UPSCALE, INWARD_SEPARATION } from "../../settings";

jest.mock("parsegraph", () => ({
  ...jest.requireActual("parsegraph"),
  paintNodeLines: jest.fn(),
  paintNodeBounds: (node, callback) => callback(0, 0, 20, 10),
}));

jest.mock("./TypedBlockPainter", () => ({
  __esModule: true,
  default: jest.fn(function (provider) {
    this.glProvider = () => provider;
    this.clear = jest.fn();
    this.initBuffer = jest.fn();
    this.setBorderColor = jest.fn();
    this.setBackgroundColor = jest.fn();
    this.backgroundColor = () => undefined;
    this.drawBlock = jest.fn();
  }),
}));

jest.mock("parsegraph-blockpainter", () => ({
  WebGLBlockPainter: jest.fn(function (provider) {
    this.glProvider = () => provider;
    this.clear = jest.fn();
    this.initBuffer = jest.fn();
    this.setBorderColor = jest.fn();
    this.setBackgroundColor = jest.fn();
    this.backgroundColor = () => undefined;
    this.drawBlock = jest.fn();
  }),
}));

jest.mock("parsegraph-spotlightpainter", () => ({
  __esModule: true,
  default: jest.fn(function (provider) {
    this._window = provider;
    this.clear = jest.fn();
    this.drawSpotlight = jest.fn();
  }),
}));

jest.mock("parsegraph-glyphpainter", () => ({
  GL_TEXTURE_SIZE: 1024,
  Font: jest.fn(function () {
    this.glyphs = new Map();
    this.font = () => "80px sans-serif";
    this.pageTextureSize = () => 512;
    this.getGlyph = (letter) => {
      if (!this.glyphs.has(letter)) {
        this.glyphs.set(letter, { letter, ascent: 8, descent: 2, height: 26 });
      }
      return this.glyphs.get(letter);
    };
  }),
  GlyphPainter: jest.fn(function (provider, font) {
    this._window = provider;
    this.font = () => font;
    this.clear = jest.fn();
    this.initBuffer = jest.fn();
    this.setColor = jest.fn();
    this.drawGlyph = jest.fn();
  }),
  Label: class {
    constructor(font) {
      this.font = font;
    }
    setText(text) {
      this.glyphs = Array.from(text, (letter) => this.font.getGlyph(letter));
    }
    glyphCount(counts) {
      counts[0] = (counts[0] || 0) + this.glyphs.length;
    }
    lineAt() {
      return { glyphs: () => this.glyphs };
    }
    width() {
      return this.glyphs.length * 5;
    }
    height() {
      return 10;
    }
    paint(x, y, scale, draw) {
      this.glyphs.forEach((glyph, index) =>
        draw(glyph, x + index * 5 * scale, y, scale)
      );
    }
  },
}));

function group(text) {
  const node = {
    effectiveBidi: () => "ltr",
    value: () => text,
    setValue: (value) => {
      text = value;
    },
    layout: () => ({ groupScale: () => 1 }),
    neighbors: () => ({ hasNode: () => false }),
    siblings: () => ({ forEach: (callback) => callback(node) }),
  };
  return node;
}

const style = (textColor = "#000000") => ({
  lineColor: "#000000",
  lineAlpha: 1,
  backgroundColor: "#ffffff",
  backgroundAlpha: 1,
  borderColor: "#000000",
  borderAlpha: 1,
  textColor,
  textAlpha: 1,
});

const implementations = [
  Font,
  GlyphPainter,
  WebGLBlockPainter,
  TypedBlockPainter,
  SpotlightPainter,
].map((mock) => [mock, mock.getMockImplementation()]);

beforeEach(() => {
  jest.clearAllMocks();
  paintNodeLines.mockReset();
  implementations.forEach(([mock, implementation]) =>
    mock.mockImplementation(implementation)
  );
});

test("paint groups share one atlas while retaining independent buffers and text colors", () => {
  const font = new Font();
  const painters = new WeakMap();
  const first = group("AB");
  const second = group("AC");
  const layout = createLayoutPainter(
    painters,
    new WeakMap(),
    {},
    {},
    (node) => style(node === first ? "#ff0000" : "#0000ff"),
    undefined,
    undefined,
    font
  );
  layout.paint(first);
  layout.paint(second);
  const firstPainter = painters.get(first).glyphPainter;
  const secondPainter = painters.get(second).glyphPainter;
  expect(firstPainter).not.toBe(secondPainter);
  expect(firstPainter.font()).toBe(font);
  expect(secondPainter.font()).toBe(font);
  expect(Font).toHaveBeenCalledTimes(1);
  expect(GlyphPainter).toHaveBeenCalledTimes(2);
  expect(firstPainter.initBuffer).toHaveBeenCalledWith({ 0: 2 });
  expect(secondPainter.initBuffer).toHaveBeenCalledWith({ 0: 2 });
  expect(firstPainter.setColor.mock.calls[0][0].asHex()).toBe("#ff0000");
  expect(secondPainter.setColor.mock.calls[0][0].asHex()).toBe("#0000ff");
  expect(firstPainter.drawGlyph.mock.calls[0][0]).toBe(
    secondPainter.drawGlyph.mock.calls[0][0]
  );
  expect(Array.from(font.glyphs.keys())).toEqual(["A", "B", "C"]);
});

test("repainting and editing labels preserve the atlas and existing per-group painter", () => {
  const font = new Font();
  const painters = new WeakMap();
  const bounds = new WeakMap();
  const provider = {};
  const node = group("A");
  const makeLayout = () =>
    createLayoutPainter(
      painters,
      bounds,
      provider,
      {},
      () => style(),
      undefined,
      undefined,
      font
    );
  makeLayout().paint(node);
  const painter = painters.get(node).glyphPainter;
  const originalTextLayout = painters.get(node).textLayouts.get(node);
  const firstGlyph = painter.drawGlyph.mock.calls[0][0];
  node.setValue("AΩ");
  makeLayout().paint(node);
  expect(painters.get(node).glyphPainter).toBe(painter);
  const updatedTextLayout = painters.get(node).textLayouts.get(node);
  expect(updatedTextLayout).not.toBe(originalTextLayout);
  expect(updatedTextLayout.glyphs.map(([letter]) => letter)).toEqual(["A", "Ω"]);
  expect(painter.clear).toHaveBeenCalledTimes(1);
  expect(painter.initBuffer).toHaveBeenLastCalledWith({ 0: 2 });
  expect(painter.drawGlyph.mock.calls.at(-2)[0]).toBe(firstGlyph);
  expect(painter.drawGlyph.mock.calls.at(-1)[0].letter).toBe("Ω");
  expect(Font).toHaveBeenCalledTimes(1);
  expect(GlyphPainter).toHaveBeenCalledTimes(1);
});

test.each([
  ["scalar", false, Alignment.NONE],
  ["horizontal inward", true, Alignment.NONE],
  ["vertical inward", true, Alignment.INWARD_VERTICAL],
])("%s worker text retains the exact GPU positions across nested scales", (name, hasInward, alignment) => {
  for (const scale of [0.125, 0.75, 2]) {
    const node = group("AVyg");
    node.layout = () => ({ groupScale: () => scale });
    node.neighbors = () => ({ hasNode: () => hasInward, getAlignment: () => alignment });
    const painters = new WeakMap();
    createLayoutPainter(
      painters, new WeakMap(), {}, {}, () => style(), undefined, undefined,
      new Font(), () => "object"
    ).paint(node);
    const { glyphPainter, textLayouts } = painters.get(node);
    const text = textLayouts.get(node);
    expect(text.font).toBe("80px sans-serif");
    expect(text.glyphs).toHaveLength(4);
    glyphPainter.drawGlyph.mock.calls.forEach(([glyph, x, y, fontScale], index) => {
      const [letter, workerX, workerY] = text.glyphs[index];
      expect(letter).toBe(glyph.letter);
      expect(workerX * scale / FONT_UPSCALE).toBeCloseTo(x);
      // The GPU quad includes the atlas's eight-pixel SDF margin above ink.
      expect(workerY * scale / FONT_UPSCALE).toBeCloseTo(y + 8 * fontScale);
    });
  }
});

test("replacing the document font or GL provider rebuilds a stale glyph painter", () => {
  const painters = new WeakMap();
  const bounds = new WeakMap();
  const node = group("A");
  const firstFont = new Font();
  const secondFont = new Font();
  const provider = {};
  const paint = (font, glProvider) =>
    createLayoutPainter(
      painters,
      bounds,
      glProvider,
      {},
      () => style(),
      undefined,
      undefined,
      font
    ).paint(node);
  paint(firstFont, provider);
  const firstPainter = painters.get(node).glyphPainter;
  paint(secondFont, provider);
  const secondPainter = painters.get(node).glyphPainter;
  expect(secondPainter).not.toBe(firstPainter);
  expect(secondPainter.font()).toBe(secondFont);
  const nextProvider = {};
  paint(secondFont, nextProvider);
  expect(painters.get(node).glyphPainter).not.toBe(secondPainter);
  expect(painters.get(node).glyphPainter._window).toBe(nextProvider);
});

test("one typed painter preserves shape kinds, colors, alpha, and append order throughout a JSON group", () => {
  const painters = new WeakMap();
  const kinds = ["object", "array", "boolean", "string", "number", "null", "key", "slot", undefined];
  const nodes = kinds.map(group);
  const pg = nodes[0];
  pg.siblings = () => ({ forEach: (callback) => nodes.forEach(callback) });
  const appearance = {
    ...style(),
    backgroundColor: "#c8def5",
    backgroundAlpha: 0.6,
    borderColor: "#37648a",
    borderAlpha: 0.8,
    lineColor: "#123456",
    lineAlpha: 0.25,
  };
  paintNodeLines.mockImplementation((node, thickness, draw) =>
    draw(nodes.indexOf(node), 1, 2, 3)
  );
  createLayoutPainter(
    painters,
    new WeakMap(),
    {},
    {},
    () => appearance,
    undefined,
    undefined,
    new Font(),
    (node) => node.value()
  ).paint(pg);
  const painter = painters.get(pg).painter;
  expect(TypedBlockPainter).toHaveBeenCalledTimes(1);
  expect(WebGLBlockPainter).not.toHaveBeenCalled();
  expect(painters.get(pg).typedShapes).toBe(true);
  expect(painter.initBuffer).toHaveBeenCalledWith(2 * nodes.length);
  expect(painter.drawBlock).toHaveBeenCalledTimes(2 * nodes.length);
  nodes.forEach((node, index) => {
    const lineIndex = 2 * index;
    const blockIndex = lineIndex + 1;
    expect(painter.drawBlock.mock.calls[lineIndex]).toEqual([index, 1, 2, 3, 0, 0]);
    expect(painter.setBorderColor.mock.calls[lineIndex][0].asRGBA()).toBe(
      "rgba(18, 52, 86, 0.25)"
    );
    expect(painter.setBackgroundColor.mock.calls[lineIndex][0].asRGBA()).toBe(
      "rgba(18, 52, 86, 0.25)"
    );
    const call = painter.drawBlock.mock.calls[blockIndex];
    const border = painter.setBorderColor.mock.calls[blockIndex][0];
    const background = painter.setBackgroundColor.mock.calls[blockIndex][0];
    expect(background.asRGBA()).toBe("rgba(200, 222, 245, 0.6)");
    expect(border.asRGBA()).toBe("rgba(55, 100, 138, 0.8)");
    expect(call[5]).toBeGreaterThan(0);
    if (kinds[index] === undefined) {
      expect(call).toEqual([0, 0, 20, 10, 20, 1]);
    } else {
      expect(call).toEqual([0, 0, 20, 10, 5, 1, kinds[index], 1]);
    }
  });
});

test("a reused typed painter receives the current kind after custom and ordinary type changes", () => {
  const painters = new WeakMap();
  const node = group("object");
  const layout = createLayoutPainter(
    painters,
    new WeakMap(),
    {},
    {},
    () => style(),
    undefined,
    undefined,
    new Font(),
    (item) => item.value()
  );
  layout.paint(node);
  const painter = painters.get(node).painter;
  for (const kind of ["string", "array", "number", "boolean", "null", undefined]) {
    node.setValue(kind);
    layout.paint(node);
    expect(painters.get(node).painter).toBe(painter);
    expect(painter.drawBlock.mock.calls.at(-1)[6]).toBe(kind);
    expect(painter.drawBlock.mock.calls.at(-1)[5]).toBeGreaterThan(0);
    expect(painter.setBorderColor.mock.calls.at(-1)[0].asHex()).toBe("#000000");
  }
  expect(TypedBlockPainter).toHaveBeenCalledTimes(1);
  expect(WebGLBlockPainter).not.toHaveBeenCalled();
  expect(painter.clear).toHaveBeenCalledTimes(6);
});

test.each([0.5, 2])("typed blocks receive their group scale %s for border clearance", (scale) => {
  const painters = new WeakMap();
  const node = group("true");
  node.layout = () => ({ groupScale: () => scale });
  createLayoutPainter(
    painters, new WeakMap(), {}, {}, () => style(), undefined, undefined,
    new Font(), () => "boolean"
  ).paint(node);
  expect(painters.get(node).painter.drawBlock).toHaveBeenCalledWith(
    0, 0, 20, 10, Math.min(5 * scale, 5), scale, "boolean", scale
  );
});

test("omitting the shape callback preserves the WebGL painter even for a JSON-like label", () => {
  const painters = new WeakMap();
  const node = group("{}");
  createLayoutPainter(
    painters,
    new WeakMap(),
    {},
    {},
    () => style(),
    undefined,
    undefined,
    new Font()
  ).paint(node);
  const painter = painters.get(node).painter;
  expect(WebGLBlockPainter).toHaveBeenCalledTimes(1);
  expect(TypedBlockPainter).not.toHaveBeenCalled();
  expect(painters.get(node).typedShapes).toBe(false);
  expect(painter.drawBlock.mock.calls[0][5]).toBeGreaterThan(0);
  expect(painter.setBorderColor.mock.calls[0][0].asHex()).toBe("#000000");
});

test("changing the document between typed and ordinary rebuilds only its block painter", () => {
  const painters = new WeakMap();
  const node = group("{}");
  const provider = {};
  const font = new Font();
  const paint = (getNodeShape) => createLayoutPainter(
    painters, new WeakMap(), provider, {}, () => style(), undefined, undefined,
    font, getNodeShape
  ).paint(node);
  paint(() => "object");
  const typed = painters.get(node).painter;
  const glyphs = painters.get(node).glyphPainter;
  paint(undefined);
  const ordinary = painters.get(node).painter;
  expect(ordinary).not.toBe(typed);
  expect(typed.clear).toHaveBeenCalledTimes(1);
  expect(painters.get(node).glyphPainter).toBe(glyphs);
  expect(painters.get(node).typedShapes).toBe(false);
  paint(() => "array");
  expect(painters.get(node).painter).not.toBe(ordinary);
  expect(ordinary.clear).toHaveBeenCalledTimes(1);
  expect(TypedBlockPainter).toHaveBeenCalledTimes(2);
  expect(WebGLBlockPainter).toHaveBeenCalledTimes(1);
  expect(painters.get(node).painter.drawBlock.mock.calls[0][6]).toBe("array");
});

test.each([Alignment.NONE, Alignment.INWARD_VERTICAL])(
  "glyph labels reserve side padding only for horizontal inward content (%s)",
  (alignment) => {
    const node = group("{}");
    node.neighbors = () => ({ hasNode: () => true, getAlignment: () => alignment });
    const painters = new WeakMap();
    createLayoutPainter(
      painters, new WeakMap(), {}, {}, () => style(), undefined, undefined,
      new Font(), () => "object"
    ).paint(node);
    const x = painters.get(node).glyphPainter.drawGlyph.mock.calls[0][1];
    expect(x).toBe(alignment === Alignment.INWARD_VERTICAL
      ? -10 / FONT_UPSCALE / 2
      : -20 / 2 + INWARD_SEPARATION / 4 + JSON_BORDER_PADDING);
  }
);

test.each([Bidi.LTR, Bidi.RTL])("legacy glyphs anchor horizontal inward labels on the %s leading side without mirroring letters", (direction) => {
  const node = group("AB");
  node.effectiveBidi = () => direction;
  node.neighbors = () => ({ hasNode: () => true, getAlignment: () => Alignment.NONE });
  const painters = new WeakMap();
  createLayoutPainter(
    painters, new WeakMap(), {}, {}, () => style(), undefined, undefined,
    new Font(), () => "object"
  ).paint(node);
  const calls = painters.get(node).glyphPainter.drawGlyph.mock.calls;
  const padding = INWARD_SEPARATION / 4 + JSON_BORDER_PADDING;
  expect(calls[0][1]).toBe(direction === Bidi.RTL
    ? 20 / 2 - padding - 10 / FONT_UPSCALE
    : -20 / 2 + padding);
  expect(calls[1][1]).toBeGreaterThan(calls[0][1]);
  expect(calls.map(([glyph]) => glyph.letter)).toEqual(["A", "B"]);
});

function measurementContext() {
  return {
    save: () => {},
    restore: () => {},
    resetTransform: () => {},
    measureText: (text) => ({ width: [...text].length * 6 }),
  };
}

function geometry(getNodeShape, presentation) {
  return createLayoutPainter(
    new WeakMap(), new WeakMap(), {}, measurementContext(), () => style(),
    presentation, undefined, new Font(), getNodeShape
  );
}

function commit(root, painter) {
  const layout = new CommitLayout(root, painter, "ltr");
  let steps = 0;
  while (layout.crank()) expect(++steps).toBeLessThan(10000);
}

function sizeOf(node) {
  const size = [];
  node.layout().size(size);
  return size;
}

function absoluteBox(node) {
  const [width, height] = sizeOf(node);
  const layout = node.layout();
  const scale = layout.absoluteScale();
  return {
    left: layout.absoluteX() - width * scale / 2,
    right: layout.absoluteX() + width * scale / 2,
    top: layout.absoluteY() - height * scale / 2,
    bottom: layout.absoluteY() + height * scale / 2,
  };
}

test.each([
  ["legacy horizontal", undefined, Alignment.NONE, false],
  ["legacy vertical", undefined, Alignment.INWARD_VERTICAL, false],
  ["presentation horizontal", "standard", Alignment.NONE, false],
  ["presentation vertical", "standard", Alignment.INWARD_VERTICAL, false],
  ["square horizontal", "math", Alignment.NONE, true],
  ["square vertical", "math", Alignment.INWARD_VERTICAL, true],
])("%s reserves padding in node size and inward separation", (name, preset, alignment, square) => {
  const root = new DirectionNode("{}");
  root.connect(Direction.INWARD, new DirectionNode("content"));
  root.neighbors().align(Direction.INWARD, alignment);
  const presentation = preset ? createPresentation(preset) : undefined;
  const padded = geometry((node) => node === root ? "object" : "string", presentation);
  const ordinary = geometry(undefined, presentation);
  commit(root, padded);
  const plainSize = [];
  ordinary.size(root, plainSize);
  expect(sizeOf(root)).toEqual([
    plainSize[0] + 2 * JSON_BORDER_PADDING,
    plainSize[1] + (square ? 2 * JSON_BORDER_PADDING : 0),
  ]);
  const additionalSeparation = alignment !== Alignment.INWARD_VERTICAL || square
    ? 2 * JSON_BORDER_PADDING : 0;
  expect(padded.getSeparation(root, Axis.Z)).toBe(
    ordinary.getSeparation(root, Axis.Z) + additionalSeparation
  );
  for (const axis of [Axis.HORIZONTAL, Axis.VERTICAL]) {
    expect(padded.getSeparation(root, axis)).toBe(ordinary.getSeparation(root, axis));
  }
  const container = absoluteBox(root);
  const content = absoluteBox(root.neighbors().nodeAt(Direction.INWARD));
  expect(content.left).toBeGreaterThanOrEqual(container.left + JSON_BORDER_PADDING);
  expect(content.right).toBeLessThanOrEqual(container.right - JSON_BORDER_PADDING);
  expect(content.top).toBeGreaterThanOrEqual(container.top);
  expect(content.bottom).toBeLessThanOrEqual(container.bottom);
});

test.each([undefined, "standard"])("nested JSON content fits inside padded containers without changing sibling heights or spacing (%s)", (preset) => {
  const value = { nested: [true, { label: "inside", empty: [] }, false], next: 42 };
  const root = createStructuredJson(value);
  const baseline = createStructuredJson(value);
  const presentation = preset ? createPresentation(preset) : undefined;
  const padded = geometry((node) => jsonNodeKind(root, node), presentation);
  const ordinary = geometry(undefined, presentation);
  commit(root, padded);
  commit(baseline, ordinary);
  const baselineNodes = new Map(graphNodes(baseline).map((node) => [node.id(), node]));
  graphNodes(root).forEach((node) => {
    const before = baselineNodes.get(node.id());
    expect(sizeOf(node)[1]).toBeCloseTo(sizeOf(before)[1]);
    expect(node.layout().absoluteY()).toBeCloseTo(before.layout().absoluteY());
    expect(node.layout().absoluteScale()).toBe(before.layout().absoluteScale());
    const kind = jsonNodeKind(root, node);
    const plainSize = [];
    ordinary.size(node, plainSize);
    expect(sizeOf(node)[0]).toBeCloseTo(
      plainSize[0] + (hasJsonNodeBorder(kind) ? 2 * JSON_BORDER_PADDING : 0)
    );
    if (!node.neighbors().hasNode(Direction.INWARD)) return;
    const container = absoluteBox(node);
    const padding = JSON_BORDER_PADDING * node.layout().absoluteScale();
    const visit = (child) => {
      const box = absoluteBox(child);
      expect(box.left).toBeGreaterThanOrEqual(container.left + padding - 1e-8);
      expect(box.right).toBeLessThanOrEqual(container.right - padding + 1e-8);
      expect(box.top).toBeGreaterThanOrEqual(container.top - 1e-8);
      expect(box.bottom).toBeLessThanOrEqual(container.bottom + 1e-8);
      for (const direction of [Direction.INWARD, Direction.FORWARD, Direction.DOWNWARD]) {
        if (child.neighbors().hasChild(direction)) visit(child.neighbors().nodeAt(direction));
      }
    };
    visit(node.neighbors().nodeAt(Direction.INWARD));
  });
});

test.each([undefined, "standard", "math"])("ordinary graph geometry is unchanged when no node has a shape (%s)", (preset) => {
  const makeRoot = () => {
    const root = new DirectionNode("{}");
    root.setId("root");
    const child = new DirectionNode("[]");
    child.setId("child");
    const sibling = new DirectionNode("true");
    sibling.setId("sibling");
    root.connect(Direction.INWARD, child);
    child.connect(Direction.DOWNWARD, sibling);
    return root;
  };
  const root = makeRoot();
  const baseline = makeRoot();
  const presentation = preset ? createPresentation(preset) : undefined;
  commit(root, geometry(() => undefined, presentation));
  commit(baseline, geometry(undefined, presentation));
  const baselineNodes = new Map(graphNodes(baseline).map((node) => [node.id(), node]));
  graphNodes(root).forEach((node) => {
    const before = baselineNodes.get(node.id());
    expect(sizeOf(node)).toEqual(sizeOf(before));
    expect(absoluteBox(node)).toEqual(absoluteBox(before));
  });
});
