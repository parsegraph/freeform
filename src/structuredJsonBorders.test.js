import Camera from "parsegraph-camera";
import {
  drawJsonNodeBorder,
  jsonBorderGeometry,
  JSON_BORDER_BEND,
  JSON_BORDER_DEPTH,
  JSON_BORDER_LINE_WIDTH,
  JSON_BORDER_PADDING,
} from "./structuredJsonBorders";

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
  const commands = [];
  return {
    commands,
    ...Object.fromEntries([
      "save", "restore", "resetTransform", "beginPath", "moveTo", "lineTo",
      "quadraticCurveTo", "closePath", "stroke",
    ].map((name) => [name, jest.fn((...args) => commands.push([name, ...args]))])),
  };
}

const style = { borderColor: "#1a365d", borderAlpha: 0.8 };

test("brackets stay narrow when the container grows or the camera zooms", () => {
  const ordinary = jsonBorderGeometry(node(200, 100), camera(8));
  const tall = jsonBorderGeometry(node(200, 100000), camera(8));
  const zoomed = jsonBorderGeometry(node(200, 100), camera(20));
  expect(ordinary.depth).toBe(JSON_BORDER_DEPTH);
  expect(tall.depth).toBe(ordinary.depth);
  expect(tall.bend).toBe(ordinary.bend);
  expect(zoomed.depth).toBe(ordinary.depth);
  expect(zoomed.bend).toBe(ordinary.bend);
  expect(tall.bottom - tall.top).toBeGreaterThan(ordinary.bottom - ordinary.top);
});

test("large shapes use the fourfold 32-pixel depth cap and independent 8-pixel bend cap", () => {
  const box = jsonBorderGeometry(node(200, 100), camera(8));
  expect(JSON_BORDER_DEPTH).toBe(4 * 8);
  expect(box.depth).toBe(32);
  expect(box.bend).toBe(JSON_BORDER_BEND);
  expect(box.bend).toBe(8);
});

test.each([
  [0.01, 1],
  [0.5, 1],
  [1, 1],
  [2, 0.5],
  [4, 0.25],
  [20, 0.01],
])("border depth fits reserved side padding at camera scale %s and node scale %s", (cameraScale, nodeScale) => {
  const box = jsonBorderGeometry(node(200, 100, 0, 0, nodeScale), camera(cameraScale));
  const reservedPixels = JSON_BORDER_PADDING * cameraScale * nodeScale;
  expect(box.depth).toBeGreaterThan(0);
  expect(box.depth).toBeCloseTo(reservedPixels);
  expect(box.depth).toBeLessThanOrEqual(JSON_BORDER_DEPTH);
  expect(box.bend).toBeLessThanOrEqual(JSON_BORDER_BEND);
});

test.each([
  [3, 100, 1, 8],
  [200, 3, 2, 0.5],
])("small %s by %s nodes bound the depth and bend by their actual dimensions", (width, height, depth, bend) => {
  const box = jsonBorderGeometry(node(width, height), camera());
  expect(box.depth).toBe(depth);
  expect(box.bend).toBe(bend);
});

test.each(["object", "array", "boolean"])("%s has one continuous outline with top and bottom edges in the captured camera pose", (kind) => {
  const ctx = context();
  const cam = camera(2);
  const item = node(200, 100, 10, -20, 0.5);
  const box = jsonBorderGeometry(item, cam);
  expect(drawJsonNodeBorder(ctx, item, cam, kind, style)).toBe(true);
  expect(ctx.resetTransform).toHaveBeenCalledTimes(1);
  expect(ctx.beginPath).toHaveBeenCalledTimes(1);
  expect(ctx.moveTo).toHaveBeenCalledTimes(1);
  expect(ctx.moveTo).toHaveBeenCalledWith(box.left + box.depth, box.top);
  const endpoints = ctx.commands
    .filter(([name]) => ["moveTo", "lineTo", "quadraticCurveTo"].includes(name))
    .map((command) => command.slice(-2));
  const bottomRight = endpoints.findIndex(([x, y]) =>
    x === box.right - box.depth && y === box.bottom
  );
  expect(bottomRight).toBeGreaterThan(0);
  expect(endpoints[bottomRight - 1]).toEqual([box.left + box.depth, box.bottom]);
  expect(endpoints.at(-1)).toEqual([box.right - box.depth, box.top]);
  expect(ctx.closePath).toHaveBeenCalledTimes(1);
  expect(ctx.commands.slice(-3)).toEqual([["closePath"], ["stroke"], ["restore"]]);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
  expect(ctx.restore).toHaveBeenCalledTimes(1);
  expect(ctx.lineWidth).toBe(JSON_BORDER_LINE_WIDTH);
  if (kind === "object") expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(8);
  else expect(ctx.quadraticCurveTo).not.toHaveBeenCalled();
});

test.each([0, 0.8, 1])("the custom outline preserves border alpha %s", (borderAlpha) => {
  const ctx = context();
  drawJsonNodeBorder(ctx, node(200, 100), camera(), "object", { ...style, borderAlpha });
  expect(ctx.strokeStyle).toBe(`rgba(26, 54, 93, ${borderAlpha})`);
});

test.each(["object", "array", "boolean"])("tiny %s nodes retain a proportionally thinner outline", (kind) => {
  const ctx = context();
  const item = node(200, 100);
  const cam = camera(0.01);
  const box = jsonBorderGeometry(item, cam);
  expect(drawJsonNodeBorder(ctx, item, cam, kind, style)).toBe(true);
  expect(ctx.lineWidth).toBeGreaterThan(0);
  expect(ctx.lineWidth).toBeLessThan(JSON_BORDER_LINE_WIDTH);
  expect(ctx.lineWidth).toBeLessThan(box.bottom - box.top);
  expect(box.left).toBeLessThan(box.right);
  expect(box.top).toBeLessThan(box.bottom);
  expect(ctx.closePath).toHaveBeenCalledTimes(1);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
});

test.each([
  [NaN, 30], [20, Infinity], [0, 30], [20, 0], [-10, 30], [20, -30],
])("invalid node dimensions %s by %s do not draw an outline", (width, height) => {
  const ctx = context();
  expect(jsonBorderGeometry(node(width, height), camera())).toBeNull();
  expect(drawJsonNodeBorder(ctx, node(width, height), camera(), "array", style)).toBe(false);
  expect(ctx.beginPath).not.toHaveBeenCalled();
});

test("buds and ordinary values do not add custom outlines", () => {
  const ctx = context();
  for (const kind of [undefined, "entry", "slot", "string", "key", "number", "null"]) {
    expect(drawJsonNodeBorder(ctx, node(200, 100), camera(), kind, style)).toBe(false);
  }
  expect(ctx.beginPath).not.toHaveBeenCalled();
});
