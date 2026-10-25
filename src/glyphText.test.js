import { captureGlyphText, drawGlyphText } from "./glyphText";
import { FONT_UPSCALE } from "./settings";
import { Label } from "parsegraph-glyphpainter";

const glyph = (letter, ascent, descent, radius) => ({
  letter,
  ascent,
  descent,
  height: ascent + descent + radius * 2,
});

test.each([1, 0.25, 2.75])(
  "captured ink matches the GPU atlas at node scale %s across camera pans",
  (nodeScale) => {
    const nodeX = 12.3,
      nodeY = -8.125;
    const callbackX = nodeX - 7.25 * nodeScale;
    const callbackY = nodeY + 3.125 * nodeScale;
    const fontScale = nodeScale / FONT_UPSCALE;
    const original = glyph("g", 53.5, 17.25, 8);
    const captured = captureGlyphText(
      original,
      callbackX,
      callbackY,
      fontScale,
      nodeX,
      nodeY,
      nodeScale
    );
    expect(captured[0]).toBe("g");
    // SDF ink is inset from its quad's top, whereas Canvas2D ink is above
    // its alphabetic baseline. These independently calculated positions
    // must agree after both group and camera transforms.
    for (const groupScale of [0.4, 1, 3]) {
      for (const camera of [
        { x: 0, y: 0, scale: 1 },
        { x: 0.35, y: -13.1, scale: 2.6 },
      ]) {
        const worldX = 100 + nodeX * groupScale;
        const worldY = -35 + nodeY * groupScale;
        const scale = (nodeScale * groupScale) / FONT_UPSCALE;
        const workerX = worldX + captured[1] * scale;
        const workerInkY = worldY + (captured[2] - original.ascent) * scale;
        const gpuX = 100 + callbackX * groupScale;
        const gpuInkY =
          -35 + (callbackY + (8 - original.ascent) * fontScale) * groupScale;
        expect((workerX + camera.x) * camera.scale).toBeCloseTo(
          (gpuX + camera.x) * camera.scale,
          9
        );
        expect((workerInkY + camera.y) * camera.scale).toBeCloseTo(
          (gpuInkY + camera.y) * camera.scale,
          9
        );
      }
    }
  }
);

test("atlas inset comes from glyph geometry, including fractional metrics", () => {
  const original = glyph("A", 51.25, 0.75, 5.5);
  expect(original.radius).toBeUndefined();
  expect(captureGlyphText(original, 0, 0, 1 / FONT_UPSCALE, 0, 0, 1)).toEqual([
    "A",
    0,
    5.5,
  ]);
});

test("actual Label placement survives multiline, combining-mark, and RTL refinement", () => {
  const atlas = new Map();
  const label = new Label({
    getGlyph: (letter) => {
      if (!atlas.has(letter)) {
        const ascent = letter === "x" ? 37 : 51.25;
        atlas.set(letter, {
          ...glyph(letter, ascent, 3.5, 8),
          width: 54,
          advance: letter === " " ? 22 : 38,
        });
      }
      return atlas.get(letter);
    },
  });
  label.setText("AV\nx e\u0301\nאב");
  const nodeX = 15.25,
    nodeY = -17.5,
    nodeScale = 0.375;
  const scale = nodeScale / FONT_UPSCALE;
  const gpu = [],
    captured = [];
  label.paint(
    nodeX - (label.width() * scale) / 2,
    nodeY - (label.height() * scale) / 2,
    scale,
    (original, x, y, glyphScale) => {
      gpu.push({ original, x, y, scale: glyphScale });
      captured.push(
        captureGlyphText(original, x, y, glyphScale, nodeX, nodeY, nodeScale)
      );
    }
  );
  expect(captured.some(([letter]) => letter === "e\u0301")).toBe(true);
  // Inspect the final RTL run without reinterpreting the library's preceding
  // direction transition; every emitted callback must be preserved below.
  const rtl = gpu.filter(({ original }) => /[אב]/.test(original.letter)).slice(-2);
  expect(rtl).toHaveLength(2);
  expect(rtl[0].x).toBeGreaterThan(rtl[1].x);
  captured.forEach(([letter, x, y], i) => {
    const expected = gpu[i];
    expect(letter).toBe(expected.original.letter);
    expect(nodeX + x * scale).toBeCloseTo(expected.x, 10);
    // Compare the ink edge, not merely the two APIs' differently defined y.
    const canvasInk = nodeY + (y - expected.original.ascent) * scale;
    const sdfInk = expected.y + (8 - expected.original.ascent) * expected.scale;
    expect(canvasInk).toBeCloseTo(sdfInk, 10);
  });
});

test("worker uses cached glyph order and baselines for mixed scripts, clusters, and lines", () => {
  const layouts = [
    [glyph("A", 50, 0, 8), -8.125, -2],
    [glyph("e\u0301", 54, 0, 8), -1.3125, -2],
    [glyph("\ufefb", 46, 9, 8), 5.75, -2],
    [glyph("😀", 57, 1, 8), -8.125, 8.5],
  ];
  const glyphs = layouts.map(([data, x, y]) =>
    captureGlyphText(data, x, y, 1 / FONT_UPSCALE, 0, 0, 1)
  );
  const ctx = {
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillText: jest.fn(),
    measureText: jest.fn(() => {
      throw new Error("Must not remeasure");
    }),
  };
  drawGlyphText(ctx, {
    glyphs,
    font: "80px sans-serif",
    worldX: 135.2,
    worldY: -9.5,
    worldScale: 0.625,
    fillStyle: "rgba(10, 20, 30, 0.5)",
  });
  expect(ctx.translate).toHaveBeenCalledWith(135.2, -9.5);
  expect(ctx.scale).toHaveBeenCalledWith(
    0.625 / FONT_UPSCALE,
    0.625 / FONT_UPSCALE
  );
  expect(ctx.font).toBe("80px sans-serif");
  expect(ctx.textAlign).toBe("left");
  expect(ctx.textBaseline).toBe("alphabetic");
  expect(ctx.fillStyle).toBe("rgba(10, 20, 30, 0.5)");
  expect(ctx.fillText.mock.calls).toEqual(glyphs);
  expect(ctx.measureText).not.toHaveBeenCalled();
  expect(ctx.save).toHaveBeenCalledTimes(1);
  expect(ctx.restore).toHaveBeenCalledTimes(1);
});

test("empty text does not create glyphs and drawing restores the context on failure", () => {
  const ctx = {
    save: jest.fn(),
    restore: jest.fn(),
    translate: jest.fn(),
    scale: jest.fn(),
    fillText: jest.fn(() => {
      throw new Error("context lost");
    }),
    fillStyle: "red",
  };
  const layout = {
    font: "80px sans-serif",
    worldX: 0,
    worldY: 0,
    worldScale: 1,
  };
  drawGlyphText(ctx, { ...layout, glyphs: [] });
  expect(ctx.fillText).not.toHaveBeenCalled();
  expect(ctx.fillStyle).toBe("red");
  expect(() =>
    drawGlyphText(ctx, { ...layout, glyphs: [["x", 1, 2]] })
  ).toThrow("context lost");
  expect(ctx.restore).toHaveBeenCalledTimes(2);
});
