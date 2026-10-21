import { Font, GlyphPainter } from "parsegraph-glyphpainter";
import { WebGLBlockPainter } from "parsegraph-blockpainter";
import SpotlightPainter from "parsegraph-spotlightpainter";
import { createLayoutPainter } from "./createLayoutPainter";

jest.mock("parsegraph", () => ({
  ...jest.requireActual("parsegraph"),
  paintNodeLines: () => {},
  paintNodeBounds: (node, callback) => callback(0, 0, 20, 10),
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
    this.pageTextureSize = () => 512;
    this.getGlyph = (letter) => {
      if (!this.glyphs.has(letter)) {
        this.glyphs.set(letter, { letter, ascent: 8, descent: 2 });
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
  SpotlightPainter,
].map((mock) => [mock, mock.getMockImplementation()]);

beforeEach(() => {
  jest.clearAllMocks();
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
  const firstGlyph = painter.drawGlyph.mock.calls[0][0];
  node.setValue("AΩ");
  makeLayout().paint(node);
  expect(painters.get(node).glyphPainter).toBe(painter);
  expect(painter.clear).toHaveBeenCalledTimes(1);
  expect(painter.initBuffer).toHaveBeenLastCalledWith({ 0: 2 });
  expect(painter.drawGlyph.mock.calls.at(-2)[0]).toBe(firstGlyph);
  expect(painter.drawGlyph.mock.calls.at(-1)[0].letter).toBe("Ω");
  expect(Font).toHaveBeenCalledTimes(1);
  expect(GlyphPainter).toHaveBeenCalledTimes(1);
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
