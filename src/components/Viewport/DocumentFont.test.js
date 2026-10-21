import { Font } from "parsegraph-glyphpainter";
import { measureBenchmark } from "../../benchmark";
import DocumentFont from "./DocumentFont";

jest.mock("../../benchmark", () => ({
  measureBenchmark: jest.fn((run, name, fn) => fn()),
}));

jest.mock("parsegraph-glyphpainter", () => ({
  Font: jest.fn(function () {
    this._windows = new Map();
    this._numGlyphs = 0;
    this.glyphs = new Map();
    this.uploads = [];
    this.dispose = jest.fn((provider) => this._windows.delete(provider));
    this.rawUpdate = jest.fn((provider) => {
      this.uploads.push({ previous: this._windows.get(provider)?._numGlyphs });
      this._windows.set(provider, { _numGlyphs: this._numGlyphs });
    });
    this.update = this.rawUpdate;
  }),
}));

const implementations = [Font, measureBenchmark].map((mock) => [
  mock,
  mock.getMockImplementation(),
]);

beforeEach(() => {
  jest.clearAllMocks();
  implementations.forEach(([mock, implementation]) =>
    mock.mockImplementation(implementation)
  );
});

test("a document reuses its font across layouts and isolates other documents and providers", () => {
  const resource = new DocumentFont();
  const document = {};
  const provider = {};
  const font = resource.get(document, provider);
  expect(resource.get(document, provider)).toBe(font);
  expect(Font).toHaveBeenCalledTimes(1);
  expect(font.dispose).not.toHaveBeenCalled();

  const nextDocument = {};
  const nextFont = resource.get(nextDocument, provider);
  expect(nextFont).not.toBe(font);
  expect(font.dispose).toHaveBeenCalledWith(provider);
  const nextProvider = {};
  const providerFont = resource.get(nextDocument, nextProvider);
  expect(providerFont).not.toBe(nextFont);
  expect(nextFont.dispose).toHaveBeenCalledWith(provider);
  expect(resource.get(nextDocument, nextProvider)).toBe(providerFont);
  expect(Font).toHaveBeenCalledTimes(3);
});

test("later glyph edits invalidate the uploaded atlas once without replacing glyph coordinates", () => {
  const resource = new DocumentFont();
  const provider = {};
  const font = resource.get({}, provider);
  const originalGlyph = { x: 4, y: 6 };
  font.glyphs.set("A", originalGlyph);
  font._numGlyphs = 1;
  font.update(provider);
  font.update(provider);
  expect(font.dispose).not.toHaveBeenCalled();
  expect(font.uploads).toEqual([{ previous: undefined }, { previous: 1 }]);

  font.glyphs.set("Ω", { x: 20, y: 6 });
  font._numGlyphs = 2;
  font.update(provider);
  expect(font.dispose).toHaveBeenCalledTimes(1);
  expect(font.dispose).toHaveBeenCalledWith(provider);
  expect(font.uploads.at(-1)).toEqual({ previous: undefined });
  expect(font.glyphs.get("A")).toBe(originalGlyph);
  expect(font._windows.get(provider)._numGlyphs).toBe(2);

  font.update(provider);
  expect(font.dispose).toHaveBeenCalledTimes(1);
  expect(font.uploads.at(-1)).toEqual({ previous: 2 });
});

test("context loss drops uploaded textures while retaining the font used by existing painters", () => {
  const resource = new DocumentFont();
  const document = {};
  const provider = {};
  const font = resource.get(document, provider);
  const glyph = { x: 3, y: 7 };
  font.glyphs.set("A", glyph);
  font._numGlyphs = 1;
  font.update(provider);
  resource.contextLost();
  expect(font.dispose).toHaveBeenCalledWith(provider);
  expect(font._windows.has(provider)).toBe(false);
  expect(resource.get(document, provider)).toBe(font);
  expect(font.glyphs.get("A")).toBe(glyph);
  font.update(provider);
  expect(font.uploads.at(-1)).toEqual({ previous: undefined });
  expect(Font).toHaveBeenCalledTimes(1);
});

test("explicit disposal is repeatable and a subsequent document gets a fresh resource", () => {
  const resource = new DocumentFont();
  const document = {};
  const provider = {};
  const font = resource.get(document, provider);
  resource.dispose();
  resource.dispose();
  expect(font.dispose).toHaveBeenCalledTimes(1);
  expect(resource.get(document, provider)).not.toBe(font);
});

test("the shared font's update probe follows the current run without stacking wrappers", () => {
  const resource = new DocumentFont();
  const document = {};
  const provider = {};
  const firstRun = {};
  const secondRun = {};
  const font = resource.get(document, provider, firstRun);
  font.update(provider);
  expect(resource.get(document, provider, secondRun)).toBe(font);
  font.update(provider);
  expect(measureBenchmark.mock.calls.map(([run, name]) => [run, name])).toEqual(
    [
      [firstRun, "Glyph atlas update"],
      [secondRun, "Glyph atlas update"],
    ]
  );
  expect(font.rawUpdate).toHaveBeenCalledTimes(2);
});
