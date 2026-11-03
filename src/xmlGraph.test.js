import {
  Bidi,
  CommitLayout,
  Direction,
  DirectionCaret,
  DirectionNode,
  Fit,
  PreferredAxis,
} from "parsegraph";
import { TextDecoder, TextEncoder } from "util";
import { readFileSync } from "fs";
import { resolve } from "path";
import GraphStack from "./GraphStack";
import { DEFAULT_LAYOUT_DIRECTION } from "./settings";
import {
  graphXml,
  exportGraphToXml,
  exportGraphToSvg,
  readXmlFile,
} from "./xmlGraph";
import { documentState, graphNodes, readGraph, writeGraph } from "./graphDocument";
import { createLegacyLayout } from "./graphLayout";

const svg = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<!--before--><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
  <text xml:space="preserve">Hello <tspan> world </tspan>!</text>
  <use xlink:href="#a" data-empty="" data-special="a &amp; b &lt; c &quot; d &#9;&#10;&#13;"/>
  <g/><g id="a"/>
  <![CDATA[a < b && c > d]]><!--keep me--><?example some data?>
</svg><!--after-->`;

function tree(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  function snapshot(node) {
    return {
      type: node.nodeType,
      name: node.nodeName,
      ns: node.namespaceURI,
      ...(node.nodeValue !== null ? { data: node.nodeValue } : {}),
      ...(node.attributes
        ? {
            attrs: Array.from(node.attributes, (a) => [
              a.name,
              a.namespaceURI,
              a.value,
            ]),
          }
        : {}),
      children: Array.from(node.childNodes, snapshot),
    };
  }
  return snapshot(doc);
}

function expectMultislotSeparation(root) {
  const buds = graphNodes(root).filter((node) => node.value() === undefined);
  expect(buds.length).toBeGreaterThan(0);
  buds.forEach((bud) => {
    expect(bud.nodeFit()).toBe(Fit.EXACT);
    expect(bud.siblings().layoutOrder()[1]).toBe(Direction.DOWNWARD);
    expect(bud.separationFit(Direction.FORWARD)).toBe(Fit.LOOSE);
    expect(bud.separationFit(Direction.BACKWARD)).toBe(Fit.LOOSE);
    expect(bud.separationFit(Direction.DOWNWARD)).toBe(Fit.EXACT);
    expect(bud.separationFit(Direction.UPWARD)).toBe(Fit.EXACT);
  });
}

function layoutXml(root, defaultDirection = DEFAULT_LAYOUT_DIRECTION) {
  const layout = new CommitLayout(
    root,
    createLegacyLayout({
      resetTransform() {},
      measureText: (text) => ({ width: [...text].length * 6 }),
    }),
    defaultDirection
  );
  let steps = 0;
  while (layout.crank()) expect(++steps).toBeLessThan(10000);
  return Object.fromEntries(
    graphNodes(root).map((node) => [
      String(node.id()),
      [node.layout().absoluteX(), node.layout().absoluteY()],
    ])
  );
}

afterEach(() => jest.restoreAllMocks());

test("attributes are inward and a horizontal multislot has a forward spine with downward children", () => {
  const at = (node, direction) => node.neighbors().nodeAt(direction);
  const children = (node) => {
    const result = [];
    let bud = node.neighbors().hasChild(Direction.DOWNWARD)
      ? at(node, Direction.DOWNWARD)
      : null;
    while (bud) {
      expect(bud.value()).toBeUndefined();
      expect(bud.siblings().getLayoutPreference()).toBe(
        result.length ? PreferredAxis.PERPENDICULAR : PreferredAxis.PARENT
      );
      const content = at(bud, Direction.DOWNWARD);
      result.push(content);
      bud = bud.neighbors().hasChild(Direction.FORWARD)
        ? at(bud, Direction.FORWARD)
        : null;
    }
    return result;
  };
  const source = '<g fill="red" id="group"><rect/><g><circle/><ellipse/></g> tail<path/></g>';
  const root = graphXml(source);
  const [group] = children(root);
  const fill = at(group, Direction.INWARD);
  expect(fill.value()).toBe("@fill");
  expect(at(fill, Direction.FORWARD).value()).toBe("red");
  const id = at(fill, Direction.DOWNWARD);
  expect(id.value()).toBe("@id");
  expect(at(id, Direction.FORWARD).value()).toBe("group");
  const content = children(group);
  expect(content.map((node) => node.value())).toEqual(["<rect>", "<g>", "#text", "<path>"]);
  expect(children(content[1]).map((node) => node.value())).toEqual(["<circle>", "<ellipse>"]);
  expect(at(content[2], Direction.DOWNWARD).value()).toBe(" tail");
  expectMultislotSeparation(root);
  expect(exportGraphToXml(root)).toBe(source);
});

test("loose spine separation keeps uneven XML branches apart without changing the mapping", () => {
  const source =
    "<root><a><b><c>Long content across the deep branch</c></b></a>" +
    "<d>Wide shallow content</d><e><f>Middle-depth content</f></e></root>";
  const root = graphXml(source);
  const parent = graphNodes(root).find((node) => node.value() === "<root>");
  const first = parent.neighbors().nodeAt(Direction.DOWNWARD);
  const second = first.neighbors().nodeAt(Direction.FORWARD);
  const third = second.neighbors().nodeAt(Direction.FORWARD);
  layoutXml(root);
  const looseGap = second.layout().absoluteX() - first.layout().absoluteX();
  expect(second.layout().absoluteY()).toBeCloseTo(first.layout().absoluteY());
  expect(third.layout().absoluteY()).toBeCloseTo(first.layout().absoluteY());
  expectMultislotSeparation(root);
  const branchBounds = (bud) => {
    const jobs = [bud.neighbors().nodeAt(Direction.DOWNWARD)];
    let left = Infinity;
    let right = -Infinity;
    while (jobs.length) {
      const node = jobs.pop();
      const size = [0, 0];
      node.layout().size(size);
      const halfWidth = (size[0] * node.layout().absoluteScale()) / 2;
      left = Math.min(left, node.layout().absoluteX() - halfWidth);
      right = Math.max(right, node.layout().absoluteX() + halfWidth);
      [Direction.INWARD, Direction.DOWNWARD, Direction.FORWARD].forEach(
        (direction) => {
          if (node.neighbors().hasChild(direction))
            jobs.push(node.neighbors().nodeAt(direction));
        }
      );
    }
    return { left, right };
  };
  const branches = [first, second, third].map(branchBounds);
  expect(branches[1].left).toBeGreaterThan(branches[0].right);
  expect(branches[2].left).toBeGreaterThan(branches[1].right);

  graphNodes(root)
    .filter((node) => node.value() === undefined)
    .forEach((bud) => new DirectionCaret(bud).tighten());
  layoutXml(root);
  const exactGap = second.layout().absoluteX() - first.layout().absoluteX();
  expect(looseGap).toBeGreaterThan(exactGap);
  expect(exportGraphToXml(root)).toBe(source);
});

test("export reports malformed child buds instead of discarding their contents", () => {
  const root = graphXml("<a/>");
  const bud = root.neighbors().nodeAt(Direction.DOWNWARD);
  bud.setValue("unexpected text");
  expect(() => exportGraphToXml(root)).toThrow(/buds must be empty/);
  bud.setValue(undefined);
  bud.disconnect(Direction.DOWNWARD);
  expect(() => exportGraphToXml(root)).toThrow(/XML node below it/);
});

test("SVG round-trip preserves namespaces, attributes, mixed content, whitespace, CDATA, comments and PIs", () => {
  const graph = graphXml(svg);
  const xml = exportGraphToSvg(graph);
  expect(tree(xml)).toEqual(tree(svg));
  expect(xml).toContain('encoding="UTF-8"');
  expect(xml).toContain("Hello <tspan> world </tspan>!");
  expect(
    graphNodes(graph).filter((node) => node.value() === "#text").length
  ).toBeGreaterThan(5);
  expect(xml).toContain('data-empty=""');
  expect(xml).toContain("&#9;&#10;&#13;");
});

test("the XML mapping survives v2 save/reload and exports current graph edits", () => {
  const original = graphXml(svg);
  const saved = writeGraph(original);
  expect(saved.version).toBe(2);
  expect(saved.capabilities["separation/1"]).toBeDefined();
  const positions = layoutXml(original);
  const root = readGraph(saved);
  expectMultislotSeparation(root);
  expect(layoutXml(root)).toEqual(positions);
  const nodes = graphNodes(root);
  nodes
    .find((node) => node.value() === "@viewBox")
    .neighbors()
    .nodeAt(Direction.FORWARD)
    .setValue("0 0 200 200");
  nodes
    .find((node) => node.value() === "#comment")
    .neighbors()
    .nodeAt(Direction.DOWNWARD)
    .setValue("updated");
  const xml = exportGraphToXml(root);
  expect(xml).toContain('viewBox="0 0 200 200"');
  expect(xml).toContain("<!--updated-->");
  expect(tree(exportGraphToXml(graphXml(xml)))).toEqual(tree(xml));
});

test("the reference Parsegraph SVG exporter output can be viewed and round-tripped as XML", () => {
  const source = readFileSync(
    resolve(__dirname, "fixtures/xml/appearance-colors.svg"),
    "utf8"
  );
  const root = graphXml(source);
  expect(tree(exportGraphToSvg(root))).toEqual(tree(source));
});

test("normal Freeform snapshots and undo/redo retain XML nodes and whitespace", () => {
  const root = graphXml(svg);
  const history = new GraphStack();
  history.save(root);
  const originalPositions = layoutXml(root);
  const attribute = graphNodes(root).find(
    (node) => node.value() === "@viewBox"
  );
  attribute.neighbors().nodeAt(Direction.FORWARD).setValue("0 0 999 999");
  history.save(root);
  const editedPositions = layoutXml(root);
  history.undo();
  const undone = history.widget();
  expectMultislotSeparation(undone);
  expect(layoutXml(undone)).toEqual(originalPositions);
  expect(tree(exportGraphToSvg(undone))).toEqual(tree(svg));
  history.redo();
  const redone = history.widget();
  expectMultislotSeparation(redone);
  expect(layoutXml(redone)).toEqual(editedPositions);
  expect(exportGraphToSvg(redone)).toContain('viewBox="0 0 999 999"');
});

test("XML v2 saves and undo preserve three bidi declarations while markup keeps logical child order", () => {
  const source = '<root id="original"><left/><right><inside/></right></root>';
  const root = graphXml(source);
  expect(documentState(root)).toMatchObject({ version: 2, sourceVersion: 2 });
  expect(graphNodes(root).every((node) => node.bidi() === Bidi.INHERIT)).toBe(true);
  const element = graphNodes(root).find((node) => node.value() === "<root>");
  const right = graphNodes(root).find((node) => node.value() === "<right>");
  element.setBidi(Bidi.RTL);
  right.setBidi(Bidi.LTR);
  const declarations = (graph) => Object.fromEntries(graphNodes(graph).map((node) => [node.id(), node.bidi()]));
  const originalBidi = declarations(root);
  const originalTopology = Object.fromEntries(graphNodes(root).map((node) => [node.id(), {
    parent: node.neighbors().isRoot() ? null : node.neighbors().parentNode().id(),
    direction: node.neighbors().parentDirection(),
  }]));
  for (const direction of [Bidi.LTR, Bidi.RTL]) {
    const before = layoutXml(root, direction);
    expect(root.effectiveBidi()).toBe(direction);
    expect(element.effectiveBidi()).toBe(Bidi.RTL);
    expect(right.effectiveBidi()).toBe(Bidi.LTR);
    const firstBud = element.neighbors().nodeAt(Direction.DOWNWARD);
    const nextBud = firstBud.neighbors().nodeAt(Direction.FORWARD);
    expect(nextBud.layout().absoluteX()).toBeLessThan(firstBud.layout().absoluteX());
    const restored = readGraph(JSON.parse(JSON.stringify(writeGraph(root))));
    expect(declarations(restored)).toEqual(originalBidi);
    expect(Object.fromEntries(graphNodes(restored).map((node) => [node.id(), {
      parent: node.neighbors().isRoot() ? null : node.neighbors().parentNode().id(),
      direction: node.neighbors().parentDirection(),
    }]))).toEqual(originalTopology);
    expect(layoutXml(restored, direction)).toEqual(before);
    expect(exportGraphToXml(restored)).toBe(source);
  }
  const history = new GraphStack(); history.save(root);
  const attributeValue = element.neighbors().nodeAt(Direction.INWARD).neighbors().nodeAt(Direction.FORWARD);
  attributeValue.setValue("edited");
  history.save(root); history.undo();
  expect(declarations(history.widget())).toEqual(originalBidi);
  expect(exportGraphToXml(history.widget())).toBe(source);
  history.redo();
  expect(declarations(history.widget())).toEqual(originalBidi);
  expect(exportGraphToXml(history.widget())).toBe(source.replace("original", "edited"));
});

test("external DOCTYPEs round-trip as data and never reach the XML parser", () => {
  const parse = jest.spyOn(DOMParser.prototype, "parseFromString");
  const declaration =
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://example.invalid/svg.dtd">';
  const xml = exportGraphToSvg(
    graphXml(`${declaration}<svg xmlns="http://www.w3.org/2000/svg"/>`)
  );
  expect(xml).toContain(declaration);
  expect(
    parse.mock.calls.every(([source]) => !source.includes("<!DOCTYPE"))
  ).toBe(true);
  expect(() => graphXml('<!DOCTYPE a SYSTEM "a[b.dtd"><a/>')).not.toThrow();
});

test("doctype-like strings in comments, CDATA and PIs are ordinary content", () => {
  const source =
    "<!--<!DOCTYPE fake>--><root><![CDATA[<!DOCTYPE fake>]]><?test <!DOCTYPE fake>?></root>";
  expect(tree(exportGraphToXml(graphXml(source)))).toEqual(tree(source));
  expect(
    exportGraphToXml(graphXml("<?freeform-doctype custom?><root/>"))
  ).toContain("<?freeform-doctype custom?>");
});

test.each([
  "<a><b></a>",
  "<a/><b/>",
  "<p:a/>",
  '<a x="1" x="2"/>',
  "<a>&undefined;</a>",
  '<!DOCTYPE a [<!ENTITY x "expanded">]><a>&x;</a>',
  "<!DOCTYPE a [ ]><a/>",
  "<root><!DOCTYPE a></root>",
  "<a/><!DOCTYPE a>",
  "<!DOCTYPE a><!DOCTYPE a><a/>",
  '<!DOCTYPE a PUBLIC "bad & id" "uri"><a/>',
  '<?xml version="1.1"?><a/>',
  '<!DOCTYPE a SYSTEM "uri"><a>\u0000</a>',
])("malformed or unsupported XML is rejected: %s", (source) => {
  expect(() => graphXml(source)).toThrow(/XML:/);
});

test("legitimate parsererror elements in an application namespace are accepted", () => {
  const source = '<parsererror xmlns="urn:example">text</parsererror>';
  expect(tree(exportGraphToXml(graphXml(source)))).toEqual(tree(source));
});

test("SVG is inspected as data, including script text and resource references", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg"><script>window.xmlTestRan = true;</script><image href="https://example.invalid/image.png"/></svg>';
  expect(exportGraphToSvg(graphXml(source))).toContain(
    "window.xmlTestRan = true;"
  );
  expect(window.xmlTestRan).toBeUndefined();
  expect(
    document.querySelector('image[href="https://example.invalid/image.png"]')
  ).toBeNull();
});

test("export rejects arbitrary graphs, invalid XML edits, and non-SVG documents", () => {
  expect(() => exportGraphToXml(new DirectionNode("not XML"))).toThrow(
    /#document/
  );
  expect(() => exportGraphToSvg(graphXml("<root/>"))).toThrow(/SVG export/);
  expect(() => exportGraphToSvg(graphXml("<svg/>"))).toThrow(/namespace/);
  const root = graphXml('<root a="1"><!--valid--></root>');
  const nodes = graphNodes(root);
  const comment = nodes.find((node) => node.value() === "#comment");
  comment.neighbors().nodeAt(Direction.DOWNWARD).setValue("invalid--comment");
  expect(() => exportGraphToXml(root)).toThrow(/Comments/);
  comment.neighbors().nodeAt(Direction.DOWNWARD).setValue("valid");
  nodes.find((node) => node.value() === "<root>").setValue("<bad name>");
  expect(() => exportGraphToXml(root)).toThrow(/XML:/);
});

test("unexpected graph connections are not silently dropped during export", () => {
  const root = graphXml('<a value="data"/>');
  const value = graphNodes(root).find((node) => node.value() === "data");
  value.connect(Direction.DOWNWARD, new DirectionNode("extra"));
  expect(() => exportGraphToXml(root)).toThrow(/Unexpected connection/);
});

describe("XML file decoding", () => {
  beforeAll(() => {
    global.TextDecoder = TextDecoder;
  });
  const file = (bytes) => ({
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  });
  test("UTF-8 and UTF-16 characters survive, and export normalizes the encoding declaration", async () => {
    const source = '<?xml version="1.0" encoding="UTF-16"?><r>café 😀</r>';
    const utf16 = [0xff, 0xfe];
    for (let i = 0; i < source.length; i++)
      utf16.push(source.charCodeAt(i) & 255, source.charCodeAt(i) >> 8);
    const decoded = await readXmlFile(file(utf16));
    expect(exportGraphToXml(graphXml(decoded))).toContain(
      'encoding="UTF-8"?><r>café 😀</r>'
    );
    const utf8 = "<r>café 😀</r>";
    expect(await readXmlFile(file(new TextEncoder().encode(utf8)))).toBe(utf8);
  });
  test("a declared legacy encoding is honored rather than replaced with U+FFFD", async () => {
    const source = '<?xml version="1.0" encoding="ISO-8859-1"?><r>café</r>';
    expect(
      await readXmlFile(file([...source].map((char) => char.charCodeAt(0))))
    ).toBe(source);
    await expect(
      readXmlFile(file([0x3c, 0x72, 0x3e, 0xff, 0x3c, 0x2f, 0x72, 0x3e]))
    ).rejects.toThrow(/decode/);
  });
  test("mismatched declarations and unsupported encodings give actionable errors", async () => {
    const source = '<?xml version="1.0" encoding="UTF-16"?><r/>';
    await expect(
      readXmlFile(file([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(source)]))
    ).rejects.toThrow(/byte order/);
    await expect(readXmlFile(file([0xff, 0xfe, 0, 0]))).rejects.toThrow(
      /UTF-32/
    );
  });
});
