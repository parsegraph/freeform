import { FONT_UPSCALE } from "./settings";

/** Capture the same glyph placement used by the GPU, in node-local font pixels. */
export function captureGlyphText(
  glyph,
  callbackX,
  callbackY,
  fontScale,
  nodeX,
  nodeY,
  nodeScale
) {
  // glyphpainter's texture starts at baseline - ascent, but its SDF image has
  // an inset above the ink. The library does not assign GlyphData.radius;
  // recover that inset from its padded height instead of assuming a radius.
  const inset = (glyph.height - glyph.ascent - glyph.descent) / 2;
  const toFontPixels = FONT_UPSCALE / nodeScale;
  return [
    glyph.letter,
    (callbackX - nodeX) * toFontPixels,
    (callbackY - nodeY + inset * fontScale) * toFontPixels,
  ];
}

/** Draw a captured layout without measuring, shaping, or positioning it again. */
export function drawGlyphText(
  ctx,
  { glyphs, font, worldX, worldY, worldScale, fillStyle }
) {
  ctx.save();
  try {
    ctx.translate(worldX, worldY);
    const scale = worldScale / FONT_UPSCALE;
    ctx.scale(scale, scale);
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (fillStyle !== undefined) ctx.fillStyle = fillStyle;
    for (const [letter, x, y] of glyphs) ctx.fillText(letter, x, y);
  } finally {
    ctx.restore();
  }
}
