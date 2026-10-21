import { createExample, exampleFromSample, loadExample } from "./examples";
import * as builders from "./builders";

jest.mock("./builders", () => ({
  buildGrid: jest.fn(() => "grid"),
  buildCross: jest.fn(() => "cross"),
  buildTournament: jest.fn(() => "tournament"),
  buildRandom: jest.fn((steps, random) => Array.from({ length: steps }, random)),
  buildAlternatingColumns: jest.fn((random) => ["columns", null, null, { styles: [random(), random()] }]),
}));

beforeEach(() => {
  jest.clearAllMocks();
  builders.buildGrid.mockReturnValue("grid");
  builders.buildCross.mockReturnValue("cross");
  builders.buildTournament.mockReturnValue("tournament");
  builders.buildRandom.mockImplementation((steps, random) => Array.from({ length: steps }, random));
  builders.buildAlternatingColumns.mockImplementation((random) => ["columns", null, null, { styles: [random(), random()] }]);
});

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
