import fs from "fs";
import path from "path";
import { Direction } from "parsegraph";
import { createExample, exampleFromSample, loadExample } from "./examples";
import { documentState, readGraph, writeGraph } from "./graphDocument";
import proportional from "./fixtures/v1/proportion-proportional.json";
import standard from "./fixtures/v1/proportion-standard.json";
import math from "./fixtures/v1/proportion-math.json";
import memory from "./fixtures/v1/memory-piers.json";
import * as builders from "./builders";

jest.mock("./builders", () => ({
  buildGrid: jest.fn(() => "grid"),
  buildCross: jest.fn(() => "cross"),
  buildTournament: jest.fn(() => "tournament"),
  buildRandom: jest.fn((steps, random) => Array.from({ length: steps }, random)),
  buildAlternatingColumns: jest.fn((random) => ["columns", null, null, { styles: [random(), random()] }]),
  buildProportionDocument: jest.fn(),
  buildPrimesDocument: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  builders.buildGrid.mockReturnValue("grid");
  builders.buildCross.mockReturnValue("cross");
  builders.buildTournament.mockReturnValue("tournament");
  builders.buildRandom.mockImplementation((steps, random) => Array.from({ length: steps }, random));
  builders.buildAlternatingColumns.mockImplementation((random) => ["columns", null, null, { styles: [random(), random()] }]);
  builders.buildProportionDocument.mockReturnValue(proportional);
  builders.buildPrimesDocument.mockImplementation((max) => jest.requireActual("./builders/primes").buildPrimesDocument(max));
});

function documentById(document) {
  // Serialization may choose another traversal order without changing the graph.
  return { ...document, nodes: Object.fromEntries(document.nodes.map((node) => [node.id, node])) };
}

function expectMigratedExample(graph, fixture) {
  const saved = writeGraph(graph);
  expect(documentState(graph).sourceVersion).toBe(1);
  expect(saved.version).toBe(2);
  expect(documentById(saved)).toEqual(documentById(writeGraph(readGraph(fixture))));
  expect(saved.nodes.find((node) => node.id === saved.root).bidi).toBe("ltr");
  expect(saved.nodes.filter((node) => node.id !== saved.root)
    .every((node) => node.bidi === "inherit")).toBe(true);
  // Migration replaces only the inert legacy direction flag. Keep IDs,
  // topology, values, scales, fitting, alignment, and paint groups unchanged.
  const semanticNodes = (document) => Object.fromEntries(document.nodes.map(
    ({ bidi, rightToLeft, ...node }) => [node.id, node]
  ));
  expect(semanticNodes(saved)).toEqual(semanticNodes(fixture));
}

test("template options survive reconstruction", async () => {
  const source = createExample("march", { rounds: 4, vertical: true });
  const loaded = await loadExample(JSON.parse(JSON.stringify(source)));
  expect(loaded.example).toEqual(source);
  expect(builders.buildTournament).toHaveBeenCalledWith(true, "Championship", "Semifinals", "Quarterfinals", "Round 1");
});

test("random examples rebuild identically from a seed", async () => {
  const source = createExample("random", { seed: 123 });
  const first = await loadExample(source);
  const second = await loadExample(JSON.parse(JSON.stringify(source)));
  expect(second.graph).toEqual(first.graph);
  expect((await loadExample(createExample("random", { seed: 456 }))).graph).not.toEqual(first.graph);
});

test("random color options are seeded too", async () => {
  const source = createExample("alt_columns", { seed: 123 });
  expect((await loadExample(source)).viewportData).toEqual((await loadExample(source)).viewportData);
});

test("sample links use the same loader as the template picker", async () => {
  await loadExample(exampleFromSample("grid_12"));
  expect(builders.buildGrid).toHaveBeenCalledWith(12);
  await loadExample(exampleFromSample("cross_3"));
  expect(builders.buildCross).toHaveBeenCalledWith(3);
  expect(exampleFromSample("march_4_vertical")).toEqual({ type: "march", rounds: 4, vertical: true });
  expect(exampleFromSample("march_madness_vertical")).toEqual({ type: "march_madness_vert" });
});

test("invalid or unbounded stored recipes are rejected or bounded", async () => {
  await expect(loadExample({ type: "unknown" })).rejects.toThrow();
  expect(createExample("grid", { size: -1 })).toBeNull();
  expect(createExample("cross", { rounds: 100000 }).rounds).toBe(11);
});

test("Primes links and recipes use an inclusive maximum and retain native presentation", async () => {
  expect(exampleFromSample("primes")).toEqual({ type: "primes", max: 30 });
  const recipe = exampleFromSample("primes", new URLSearchParams("max=12"));
  expect(recipe).toEqual({ type: "primes", max: 12 });
  const loaded = await loadExample(JSON.parse(JSON.stringify(recipe)));
  expect(loaded.example).toEqual(recipe);
  expect(builders.buildPrimesDocument).toHaveBeenCalledWith(12);
  const document = writeGraph(loaded.graph);
  expect(document.version).toBe(2);
  expect(document.nodes.some((node) => node.id === "primes-12")).toBe(true);
  expect(document.nodes.some((node) => node.id === "primes-13")).toBe(false);
  expect(documentState(loaded.graph).presentation.nodeStyles["primes-12-factor-5"]).toBe("slot");
});

test("Primes accepts positive safe integer maxima, and max does not affect other templates", async () => {
  for (const max of [1, 30, 1000, 2310, Number.MAX_SAFE_INTEGER]) {
    expect(createExample("primes", { max })).toEqual({ type: "primes", max });
    expect(exampleFromSample("primes", new URLSearchParams({ max }))).toEqual({ type: "primes", max });
  }
  for (const max of [0, -1, Number.MAX_SAFE_INTEGER + 1, 2.5, "30", null, NaN, Infinity]) {
    expect(createExample("primes", { max })).toBeNull();
    await expect(loadExample({ type: "primes", max })).rejects.toThrow();
  }
  for (const max of ["", "no", "0", "-1", "2.5", String(Number.MAX_SAFE_INTEGER + 1), "Infinity"]) {
    expect(exampleFromSample("primes", new URLSearchParams({ max }))).toBeNull();
  }
  expect(exampleFromSample("grid_12", new URLSearchParams("max=100"))).toEqual({ type: "grid", size: 12 });
});

test("explicit Proportion columns survive reconstruction and reach the document builder", async () => {
  const source = createExample("proportion_v1", { columns: 7 });
  expect(source).toEqual({ type: "proportion_v1", columns: 7 });
  const loaded = await loadExample(JSON.parse(JSON.stringify(source)));
  expect(loaded.example).toEqual(source);
  expect(builders.buildProportionDocument).toHaveBeenCalledTimes(1);
  expect(builders.buildProportionDocument).toHaveBeenCalledWith(7);
  expectMigratedExample(loaded.graph, proportional);
});

test("Proportion columns accept only bounded integers, while an omitted value retains its old recipe", async () => {
  for (const columns of [1, 3, 200]) {
    expect(createExample("proportion_v1", { columns })).toEqual({ type: "proportion_v1", columns });
  }
  for (const columns of [0, -1, 201, 2.5, "3", null, NaN, Infinity]) {
    expect(createExample("proportion_v1", { columns })).toBeNull();
    await expect(loadExample({ type: "proportion_v1", columns })).rejects.toThrow();
  }
  const source = createExample("proportion_v1");
  expect(source).toEqual({ type: "proportion_v1" });
  const loaded = await loadExample(source);
  expect(loaded.example).toEqual(source);
  expectMigratedExample(loaded.graph, proportional);
  expect(builders.buildProportionDocument).not.toHaveBeenCalled();
});

test.each([
  ["proportion_standard_v1", standard],
  ["proportion_math_v1", math],
  ["memory_piers_v1", memory],
])("retired gallery recipe %s still restores its original document", async (type, fixture) => {
  const recipe = { type };
  expect(exampleFromSample(type)).toEqual(recipe);
  const loaded = await loadExample(recipe);
  expect(loaded.example).toEqual(recipe);
  expectMigratedExample(loaded.graph, fixture);
});

// Load the shipped assets through the real importers as well as checking URLs.
test.each(["", "/freeform", "/freeform/"])(
  "JSON and Lisp samples load under PUBLIC_URL=%s",
  async (publicUrl) => {
    const originalPublicUrl = process.env.PUBLIC_URL;
    const originalFetch = global.fetch;
    process.env.PUBLIC_URL = publicUrl;
    global.fetch = jest.fn();
    try {
      for (const type of ["json", "lisp"]) {
        const filename = `sample.${type}`;
        const text = fs.readFileSync(
          path.join(__dirname, "../public/examples", filename),
          "utf8"
        );
        global.fetch.mockResolvedValueOnce({ ok: true, text: async () => text });
        const result = await loadExample(createExample(type));
        const expectedBase = publicUrl ? "/freeform" : "";
        expect(global.fetch).toHaveBeenLastCalledWith(
          `${expectedBase}/examples/${filename}`
        );
        expect(result.graph.neighbors().hasNode(Direction.INWARD)).toBe(true);
      }
    } finally {
      if (originalPublicUrl === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = originalPublicUrl;
      if (originalFetch === undefined) delete global.fetch;
      else global.fetch = originalFetch;
    }
  }
);
