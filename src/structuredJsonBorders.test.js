import Camera from "parsegraph-camera";
import { drawJsonNodeBorder, jsonBorderGeometry, JSON_BORDER_DEPTH } from "./structuredJsonBorders";

function node(width, height, x = 0, y = 0, scale = 1) {
  return { layout: () => ({
    size: (size) => { size[0] = width; size[1] = height; },
    absoluteScale: () => scale,
    absoluteX: () => x,
    absoluteY: () => y,
  }) };
}

function camera(scale = 1) {
  const cam = new Camera();
  cam.setSize(800, 600);
  cam.setOrigin(400, 300);
  cam.setScale(scale);
  return cam;
}

function context() {
  return Object.fromEntries(["save", "restore", "resetTransform", "beginPath", "moveTo", "lineTo", "quadraticCurveTo", "stroke"].map((name) => [name, jest.fn()]));
}

const style = { borderColor: "#1a365d", borderAlpha: 0.8 };

test("brackets stay narrow when the container grows or the camera zooms", () => {
  const ordinary = jsonBorderGeometry(node(200, 100), camera());
  const tall = jsonBorderGeometry(node(200, 100000), camera());
  const zoomed = jsonBorderGeometry(node(200, 100), camera(20));
  expect(ordinary.depth).toBe(JSON_BORDER_DEPTH);
  expect(tall.depth).toBe(ordinary.depth);
  expect(tall.bend).toBe(ordinary.bend);
  expect(zoomed.depth).toBe(ordinary.depth);
  expect(zoomed.bend).toBe(ordinary.bend);
  expect(tall.bottom - tall.top).toBeGreaterThan(ordinary.bottom - ordinary.top);
});

test.each(["object", "array", "boolean"])("%s has mirrored border accents in the captured camera pose", (kind) => {
  const ctx = context();
  const cam = camera(2);
  const item = node(200, 100, 10, -20, 0.5);
  const box = jsonBorderGeometry(item, cam);
  expect(drawJsonNodeBorder(ctx, item, cam, kind, style)).toBe(true);
  expect(ctx.resetTransform).toHaveBeenCalledTimes(1);
  expect(ctx.moveTo).toHaveBeenNthCalledWith(1, box.left + box.depth, box.top);
  expect(ctx.moveTo).toHaveBeenNthCalledWith(2, box.right - box.depth, box.top);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
  expect(ctx.restore).toHaveBeenCalledTimes(1);
  if (kind === "object") expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(8);
  else expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
});

test("tiny nodes, invalid geometry, buds and ordinary values add no border noise", () => {
  const ctx = context();
  expect(drawJsonNodeBorder(ctx, node(4, 4), camera(), "object", style)).toBe(false);
  expect(drawJsonNodeBorder(ctx, node(NaN, 30), camera(), "array", style)).toBe(false);
  for (const kind of [undefined, "entry", "slot", "string", "key", "number", "null"]) {
    expect(drawJsonNodeBorder(ctx, node(200, 100), camera(), kind, style)).toBe(false);
  }
  expect(ctx.beginPath).not.toHaveBeenCalled();
});
