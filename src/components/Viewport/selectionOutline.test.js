import { Direction, DirectionNode } from "parsegraph";
import { drawJsonNodeBorder } from "../../structuredJsonBorders";
import { drawSelectionOutline } from "./selectionOutline";

function node({
  width = 100,
  height = 50,
  x = 0,
  y = 0,
  scale = 1,
  value = "selected",
} = {}) {
  const item = new DirectionNode(value);
  jest.spyOn(item, "layout").mockReturnValue({
    size: (size) => {
      size[0] = width;
      size[1] = height;
    },
    absoluteScale: () => scale,
    absoluteX: () => x,
    absoluteY: () => y,
    needsCommit: () => false,
    needsAbsolutePos: () => false,
  });
  return item;
}

function camera(scale = 1, x = 0, y = 0) {
  return { scale: () => scale, x: () => x, y: () => y };
}

function context() {
  const commands = [];
  const strokes = [];
  const ctx = {
    commands,
    strokes,
    ...Object.fromEntries(
      [
        "save",
        "restore",
        "resetTransform",
        "beginPath",
        "moveTo",
        "lineTo",
        "quadraticCurveTo",
        "closePath",
        "roundRect",
        "arc",
      ].map((name) => [
        name,
        jest.fn((...args) => commands.push([name, ...args])),
      ])
    ),
  };
  ctx.stroke = jest.fn(() => {
    commands.push(["stroke"]);
    strokes.push({ width: ctx.lineWidth, color: ctx.strokeStyle });
  });
  return ctx;
}

function contour(ctx) {
  return ctx.commands.filter(([name]) =>
    [
      "beginPath",
      "moveTo",
      "lineTo",
      "quadraticCurveTo",
      "closePath",
      "roundRect",
      "arc",
    ].includes(name)
  );
}

test.each([
  [0.02, 1],
  [0.2, 0.25],
  [1, 1],
  [4, 0.5],
  [20, 2],
])(
  "selection stays visible at camera scale %s and nested node scale %s",
  (cameraScale, nodeScale) => {
    const ctx = context();
    expect(
      drawSelectionOutline(ctx, node({ scale: nodeScale }), camera(cameraScale))
    ).toBe(true);
    expect(ctx.strokes).toEqual([
      { width: 5.5, color: "#ffffff" },
      { width: 2.5, color: "#245d50" },
    ]);
    // Both strokes reuse one screen-space path, without leaking the reset transform.
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.resetTransform).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
    expect(ctx.commands.slice(0, 2)).toEqual([["save"], ["resetTransform"]]);
    expect(ctx.commands.slice(-3)).toEqual([
      ["stroke"],
      ["stroke"],
      ["restore"],
    ]);
  }
);

test("ordinary block outline follows the projected body with an outer gap", () => {
  const ctx = context();
  // Center is ((10 + 30) * 2, (-20 + 40) * 2) = (80, 40).
  drawSelectionOutline(
    ctx,
    node({ x: 10, y: -20, scale: 0.5 }),
    camera(2, 30, 40)
  );
  expect(ctx.roundRect.mock.calls[0].slice(0, 4)).toEqual([28, 13, 104, 54]);
  expect(ctx.arc).not.toHaveBeenCalled();
});

test("an ordinary bud remains circular and a node with INWARD content remains a block", () => {
  const bud = node({ value: null, width: 20, height: 20 });
  const budContext = context();
  drawSelectionOutline(budContext, bud, camera(2, 10, -5));
  expect(budContext.arc).toHaveBeenCalledWith(20, -10, 22, 0, Math.PI * 2);
  expect(budContext.roundRect).not.toHaveBeenCalled();

  const geometry = bud.layout();
  bud.layout.mockRestore();
  bud.connect(Direction.INWARD, new DirectionNode("content"));
  jest.spyOn(bud, "layout").mockReturnValue(geometry);
  const blockContext = context();
  drawSelectionOutline(blockContext, bud, camera(2));
  expect(blockContext.roundRect).toHaveBeenCalledTimes(1);
  expect(blockContext.arc).not.toHaveBeenCalled();
});

test.each([
  [1, 1, 16, 16],
  [100, 1, 104, 16],
  [1, 100, 16, 104],
])(
  "tiny %s by %s pixel selections retain a centered minimum target",
  (width, height, expectedWidth, expectedHeight) => {
    const ctx = context();
    drawSelectionOutline(
      ctx,
      node({ width, height, x: 20, y: -10 }),
      camera(1, 40, 30),
      "array"
    );
    const [left, top, outlineWidth, outlineHeight] =
      ctx.roundRect.mock.calls[0];
    expect(outlineWidth).toBe(expectedWidth);
    expect(outlineHeight).toBe(expectedHeight);
    expect(left + outlineWidth / 2).toBe(60);
    expect(top + outlineHeight / 2).toBe(20);
    expect(ctx.closePath).not.toHaveBeenCalled();
  }
);

test.each(["object", "array", "boolean"])(
  "%s selection keeps the document's custom contour",
  (kind) => {
    const item = node({ width: 200, height: 100, x: 10, y: -20, scale: 0.5 });
    const cam = camera(2, 30, 40);
    const selectedContext = context();
    const normalContext = context();
    expect(drawSelectionOutline(selectedContext, item, cam, kind)).toBe(true);
    drawJsonNodeBorder(normalContext, item, cam, kind, {
      borderColor: "#123456",
      borderAlpha: 1,
    });
    expect(contour(selectedContext).map(([command]) => command)).toEqual(
      contour(normalContext).map(([command]) => command)
    );
    const [normalStartX, normalStartY] = normalContext.moveTo.mock.calls[0];
    expect(selectedContext.moveTo).toHaveBeenCalledWith(
      normalStartX - 2,
      normalStartY - 2
    );
    // Curly, square, and angle contours all grow outward without becoming rectangles.
    const extents = (ctx) => {
      const xs = [];
      const ys = [];
      for (const [command, ...points] of contour(ctx)) {
        if (!["moveTo", "lineTo", "quadraticCurveTo"].includes(command))
          continue;
        points.forEach((point, index) => (index % 2 ? ys : xs).push(point));
      }
      return [
        Math.min(...xs),
        Math.max(...xs),
        Math.min(...ys),
        Math.max(...ys),
      ];
    };
    const [left, right, top, bottom] = extents(normalContext);
    expect(extents(selectedContext)).toEqual([
      left - 2,
      right + 2,
      top - 2,
      bottom + 2,
    ]);
    expect(selectedContext.closePath).toHaveBeenCalledTimes(1);
    expect(selectedContext.stroke).toHaveBeenCalledTimes(2);
    expect(selectedContext.roundRect).not.toHaveBeenCalled();
    expect(selectedContext.arc).not.toHaveBeenCalled();
  }
);

test.each([
  ["zero width", { width: 0 }, 1],
  ["negative height", { height: -1 }, 1],
  ["infinite width", { width: Infinity }, 1],
  ["missing position", { x: NaN }, 1],
  ["infinite position", { y: Infinity }, 1],
  ["zero node scale", { scale: 0 }, 1],
  ["invalid node scale", { scale: NaN }, 1],
  ["zero camera scale", {}, 0],
  ["invalid camera scale", {}, NaN],
])("%s cannot draw an invalid selection", (name, geometry, cameraScale) => {
  const ctx = context();
  expect(drawSelectionOutline(ctx, node(geometry), camera(cameraScale))).toBe(
    false
  );
  expect(ctx.commands).toEqual([]);
  expect(ctx.stroke).not.toHaveBeenCalled();
});
