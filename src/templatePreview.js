import { Alignment, CommitLayout, Direction, paintNodeLines } from "parsegraph";
import Color from "parsegraph-color";
import { documentState, nodeLabel, presentationStyle } from "./graphDocument";
import { createLegacyLayout } from "./graphLayout";
import { createDocumentLayout } from "./graphPresentation";
import { jsonNodeAppearance } from "./structuredJsonAppearance";
import { lispNodeAppearance } from "./structuredLispAppearance";
import {
  BORDER_ROUNDEDNESS,
  BORDER_THICKNESS,
  DEFAULT_NODE_STYLE,
  FONT_SIZE,
  INWARD_SEPARATION,
  LINE_HEIGHT,
  LINE_THICKNESS,
  PAGE_BACKGROUND_COLOR,
  nodeHasValue,
} from "./settings";

const escapeXml = (value) =>
  String(value)
    // XML 1.0 cannot represent these controls, even as character references.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const number = (value) => String(Number(value.toFixed(3)));
const own = (object, key) =>
  Object.prototype.hasOwnProperty.call(object ?? {}, key);
const attr = (values) =>
  Object.entries(values)
    .map(
      ([key, value]) =>
        `${key}="${escapeXml(
          typeof value === "number" ? number(value) : value
        )}"`
    )
    .join(" ");

function parentFirst(root) {
  const nodes = [],
    stack = [root],
    visited = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (visited.has(node))
      throw new Error("Preview graph contains a repeated child");
    visited.add(node);
    nodes.push(node);
    for (const direction of [
      Direction.BACKWARD,
      Direction.FORWARD,
      Direction.UPWARD,
      Direction.DOWNWARD,
      Direction.INWARD,
    ]) {
      if (node.neighbors().hasChild(direction))
        stack.push(node.neighbors().nodeAt(direction));
    }
  }
  return nodes;
}

function defaultStyle() {
  return Object.fromEntries(
    Object.entries(DEFAULT_NODE_STYLE).flatMap(([key, color]) => [
      [key, color.asHex()],
      [key.replace("Color", "Alpha"), color.a()],
    ])
  );
}

/**
 * Offline, DOM-free thumbnails of real examples. Layout is synchronous: call
 * this from the asset generator, never while opening the template chooser.
 * measureText(line, textStyle) returns an advance or a Canvas-like {width}.
 * Without a font measurer the deterministic 0.6em advance is representative;
 * SVG textLength preserves that advance on machines with different fonts.
 * cropHeight frames the beginning of tall planners without changing the graph.
 */
export function renderTemplatePreview(
  loaded,
  {
    width = 480,
    height = 300,
    measureText = (line, text) => Array.from(line).length * text.fontSize * 0.6,
    cropHeight,
  } = {}
) {
  if (!loaded?.graph) throw new Error("A preview requires a graph");
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Preview dimensions must be positive and finite");
  }
  if (
    cropHeight !== undefined &&
    (!Number.isFinite(cropHeight) || cropHeight <= 0)
  ) {
    throw new Error("Preview crop height must be positive and finite");
  }
  const { graph, viewportData } = loaded;
  const state = documentState(graph);
  const presentation = state?.presentation;
  const appearance = state?.appearance;
  const text = presentation?.text ?? {
    fontFamily: "sans-serif",
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
  };
  const measure = (line) => {
    const result = measureText(line, text);
    const advance = typeof result === "number" ? result : result?.width;
    if (!Number.isFinite(advance) || advance < 0)
      throw new Error("Invalid preview text measurement");
    return advance;
  };
  const ctx = {
    save() {},
    restore() {},
    resetTransform() {},
    measureText: (line) => ({ width: measure(line) }),
  };
  const nodes = parentFirst(graph);
  const layout = new CommitLayout(
    graph,
    presentation
      ? createDocumentLayout(presentation, ctx)
      : createLegacyLayout(ctx)
  );
  while (layout.crank()) {
    /* Asset generation deliberately completes layout. */
  }

  const defaults = {
    ...defaultStyle(),
    ...appearance?.defaults,
    ...viewportData?.defaultNodeStyle,
  };
  let page = PAGE_BACKGROUND_COLOR.clone();
  if (appearance)
    page = Color.fromHex(appearance.pageBackgroundColor).setA(
      appearance.pageBackgroundAlpha
    );
  if (viewportData?.pageBackgroundColor) {
    page = viewportData.pageBackgroundColor.startsWith("#")
      ? Color.fromHex(viewportData.pageBackgroundColor)
      : Color.fromRGB(viewportData.pageBackgroundColor);
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const include = (x, y, w, h) => {
    if (![x, y, w, h].every(Number.isFinite) || w < 0 || h < 0)
      throw new Error("Invalid preview layout geometry");
    minX = Math.min(minX, x - w / 2);
    minY = Math.min(minY, y - h / 2);
    maxX = Math.max(maxX, x + w / 2);
    maxY = Math.max(maxY, y + h / 2);
  };
  const geometry = nodes.map((node) => {
    const nodeLayout = node.layout();
    const size = [0, 0];
    nodeLayout.size(size);
    const x = nodeLayout.absoluteX(),
      y = nodeLayout.absoluteY(),
      scale = nodeLayout.absoluteScale();
    include(x, y, size[0] * scale, size[1] * scale);
    const group = node.paintGroup().node().layout();
    const groupScale = group.absoluteScale(),
      lines = [];
    paintNodeLines(node, LINE_THICKNESS / 2, (gx, gy, w, h) => {
      const line = [
        group.absoluteX() + gx * groupScale,
        group.absoluteY() + gy * groupScale,
        w * groupScale,
        h * groupScale,
      ];
      include(...line);
      lines.push(line);
    });
    return { node, size, x, y, scale, lines };
  });
  if (cropHeight !== undefined) maxY = Math.min(maxY, minY + cropHeight);
  const padding = 12;
  let viewWidth = Math.max(1, maxX - minX) + 2 * padding;
  let viewHeight = Math.max(1, maxY - minY) + 2 * padding;
  let viewX = minX - padding,
    viewY = minY - padding;
  // Match the image aspect ratio so one background covers its full area.
  // A CSS background plus a page rect would double semitransparent page alpha.
  if (viewWidth / viewHeight < width / height) {
    const expanded = (viewHeight * width) / height;
    viewX -= (expanded - viewWidth) / 2;
    viewWidth = expanded;
  } else {
    const expanded = (viewWidth * height) / width;
    viewY -= (expanded - viewHeight) / 2;
    viewHeight = expanded;
  }
  const screenScale = Math.min(width / viewWidth, height / viewHeight);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" ${attr({
      width,
      height,
      viewBox: [viewX, viewY, viewWidth, viewHeight].map(number).join(" "),
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
    })}>`,
    `<title>Parsegraph template preview</title>`,
    `<rect ${attr({
      x: viewX,
      y: viewY,
      width: viewWidth,
      height: viewHeight,
      fill: page.asHex(),
      "fill-opacity": page.a(),
    })}/>`,
  ];
  for (const { node, size, x, y, scale, lines } of geometry) {
    const id = String(node.id());
    const style = {
      ...defaults,
      ...(jsonNodeAppearance(graph, node) ?? lispNodeAppearance(graph, node)),
      ...(own(appearance?.nodeStyles, id) ? appearance.nodeStyles[id] : {}),
      ...(own(viewportData?.styles, id) ? viewportData.styles[id] : {}),
    };
    for (const [lx, ly, w, h] of lines) {
      parts.push(
        `<rect ${attr({
          x: lx - w / 2,
          y: ly - h / 2,
          width: w,
          height: h,
          fill: style.lineColor,
          "fill-opacity": style.lineAlpha,
        })}/>`
      );
    }
    const inward = node.neighbors().hasNode(Direction.INWARD);
    const isBud = !presentation && !nodeHasValue(node) && !inward;
    const stroke = Math.min(BORDER_THICKNESS, size[0], size[1]);
    const radius =
      presentation && presentationStyle(presentation, node).square
        ? 0
        : isBud
        ? size[0]
        : Math.min(BORDER_ROUNDEDNESS, size[0] / 2, size[1] / 2);
    parts.push(
      `<g ${attr({
        transform: `translate(${number(x)} ${number(y)}) scale(${number(
          scale
        )})`,
      })}>`
    );
    parts.push(
      `<rect ${attr({
        x: (-size[0] + stroke) / 2,
        y: (-size[1] + stroke) / 2,
        width: size[0] - stroke,
        height: size[1] - stroke,
        rx: radius,
        fill: style.backgroundColor,
        "fill-opacity": style.backgroundAlpha,
        stroke: style.borderColor,
        "stroke-opacity": style.borderAlpha,
        "stroke-width": stroke,
      })}/>`
    );
    const label = nodeLabel(node, presentation);
    if (label !== null && text.fontSize * scale * screenScale >= 3) {
      const labelLines = label.split("\n");
      let labelX = 0,
        labelY =
          (-labelLines.length * text.lineHeight) / 2 + text.lineHeight / 2;
      let anchor = "middle";
      if (inward) {
        const paddingStyle = presentation
          ? presentationStyle(presentation, node)
          : {
              paddingX: INWARD_SEPARATION / 4,
              paddingY: INWARD_SEPARATION / 4,
            };
        if (
          node.neighbors().getAlignment(Direction.INWARD) ===
          Alignment.INWARD_VERTICAL
        ) {
          labelY = -size[1] / 2 + paddingStyle.paddingY + text.lineHeight / 2;
        } else {
          labelX = -size[0] / 2 + paddingStyle.paddingX;
          anchor = "start";
        }
      }
      labelLines.forEach((line, index) => {
        if (!line) return;
        parts.push(
          `<text ${attr({
            x: labelX,
            y: labelY + index * text.lineHeight,
            "text-anchor": anchor,
            "dominant-baseline": "central",
            fill: style.textColor,
            "fill-opacity": style.textAlpha,
            "font-family": text.fontFamily,
            "font-size": text.fontSize,
            textLength: measure(line),
            lengthAdjust: "spacingAndGlyphs",
            "xml:space": "preserve",
          })}>${escapeXml(line)}</text>`
        );
      });
    }
    parts.push("</g>");
  }
  parts.push("</svg>");
  return parts.join("");
}
