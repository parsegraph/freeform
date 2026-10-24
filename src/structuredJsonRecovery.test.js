import { DirectionNode } from "parsegraph";
import {
  readGraph,
  writeGraph,
  graphSelection,
  graphViewport,
} from "./graphDocument";
import {
  applyJsonCommand,
  createStructuredJson,
  exportStructuredJson,
  inspectJsonSelection,
  structuredJsonStatus,
} from "./structuredJson";
import {
  JSON_RECOVERY_KEY,
  clearJsonRecovery,
  readJsonRecovery,
  writeJsonRecovery,
} from "./structuredJsonRecovery";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

function draftWithNumberToken(text) {
  const root = createStructuredJson(1);
  return applyJsonCommand(root, root, { type: "setText", text }).root;
}

test("recovering an unfinished numeric slot preserves its draft, selection, and camera", () => {
  const root = draftWithNumberToken("-");
  const cam = { cameraX: 20, cameraY: -30, scale: 0.8 };
  const data = writeGraph(root, root, { cam, showingUI: true }, 1);
  const savedAt = writeJsonRecovery(data);
  const recovered = readJsonRecovery();
  expect(recovered).toEqual({ document: data, savedAt });
  expect(graphSelection(recovered.document)).toBe(root.id());
  expect(graphViewport(recovered.document)).toEqual({ cam, showingUI: true });
  const restored = readGraph(recovered.document);
  expect(inspectJsonSelection(restored, restored).text).toBe("-");
  expect(structuredJsonStatus(restored).complete).toBe(false);
  expect(() => exportStructuredJson(restored)).toThrow();
});

test("recovery preserves an explicit empty slot without inventing null", () => {
  const initial = createStructuredJson(null);
  const { root } = applyJsonCommand(initial, initial, { type: "clear" });
  writeJsonRecovery(writeGraph(root, root, undefined, 1));
  const restored = readGraph(readJsonRecovery().document);
  expect(inspectJsonSelection(restored, restored).isSlot).toBe(true);
  expect(structuredJsonStatus(restored).complete).toBe(false);
});

test("the latest valid document replaces recovery, and clearing affects only its key", () => {
  localStorage.setItem("unrelated", "keep");
  writeJsonRecovery(
    writeGraph(createStructuredJson({ first: true }), undefined, undefined, 1)
  );
  const next = writeGraph(createStructuredJson([]), undefined, undefined, 1);
  writeJsonRecovery(next);
  expect(readJsonRecovery().document).toEqual(next);
  clearJsonRecovery();
  expect(readJsonRecovery()).toBeNull();
  expect(localStorage.getItem("unrelated")).toBe("keep");
});

test.each([
  "{broken",
  JSON.stringify({ version: 99, savedAt: 1, document: {} }),
  JSON.stringify({ version: 1, savedAt: "yesterday", document: {} }),
  JSON.stringify({
    version: 1,
    savedAt: 1,
    document: { format: "parsegraph", version: 99 },
  }),
])(
  "malformed recovery is reported and its stored bytes are retained: %s",
  (raw) => {
    localStorage.setItem(JSON_RECOVERY_KEY, raw);
    expect(() => readJsonRecovery()).toThrow(
      /Could not restore.*stored draft has been kept/
    );
    expect(localStorage.getItem(JSON_RECOVERY_KEY)).toBe(raw);
  }
);

test("ordinary graphs and malformed type metadata cannot replace a recoverable draft", () => {
  const valid = writeGraph(
    createStructuredJson({ a: 1 }),
    undefined,
    undefined,
    1
  );
  writeJsonRecovery(valid);
  const before = localStorage.getItem(JSON_RECOVERY_KEY);
  expect(() =>
    writeJsonRecovery(
      writeGraph(new DirectionNode("ordinary"), undefined, undefined, 1)
    )
  ).toThrow(/not a structured JSON draft/);
  const malformed = JSON.parse(JSON.stringify(valid));
  malformed.metadata.freeform.structuredJson.version = 999;
  expect(() => writeJsonRecovery(malformed)).toThrow();
  expect(localStorage.getItem(JSON_RECOVERY_KEY)).toBe(before);
});

test("invalid node kinds in a stored draft are reported without discarding its record", () => {
  const document = writeGraph(createStructuredJson(3), undefined, undefined, 1);
  document.metadata.freeform.structuredJson.nodes[document.root].kind =
    "unknown";
  const raw = JSON.stringify({ version: 1, savedAt: 1, document });
  localStorage.setItem(JSON_RECOVERY_KEY, raw);
  expect(() => readJsonRecovery()).toThrow(/Could not restore/);
  expect(localStorage.getItem(JSON_RECOVERY_KEY)).toBe(raw);
});

test("storage failures explain how to keep a downloadable draft and retain previous data", () => {
  const data = writeGraph(
    createStructuredJson("draft"),
    undefined,
    undefined,
    1
  );
  writeJsonRecovery(data);
  const before = localStorage.getItem(JSON_RECOVERY_KEY);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });
  expect(() => writeJsonRecovery(data)).toThrow(/quota exceeded.*Save draft/);
  expect(localStorage.getItem(JSON_RECOVERY_KEY)).toBe(before);
});

test("storage access errors remain recoverable errors instead of an absent draft", () => {
  const denied = {
    getItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(() => readJsonRecovery(denied)).toThrow(/Could not restore.*blocked/);
  expect(() => clearJsonRecovery(denied)).toThrow(/Could not clear.*blocked/);
});
