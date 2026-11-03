import { Bidi, Direction, DirectionNode } from "parsegraph";
import { documentState, graphNodes, readGraph, writeGraph } from "./graphDocument";
import {
  createLispDraft,
  createStructuredLisp,
  applyLispCommand,
  exportStructuredLisp,
  structuredLispStatus,
} from "./structuredLisp";
import { createJsonDraft } from "./structuredJson";
import { JSON_RECOVERY_KEY, readJsonRecovery, writeJsonRecovery } from "./structuredJsonRecovery";
import {
  LISP_RECOVERY_KEY,
  readLispRecovery,
  readStructuredRecovery,
  writeLispRecovery,
  writeStructuredRecovery,
} from "./structuredRecovery";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test.each([
  ["JSON", createJsonDraft, JSON_RECOVERY_KEY, readJsonRecovery, writeJsonRecovery, "structuredJson"],
  ["Lisp", createLispDraft, LISP_RECOVERY_KEY, readLispRecovery, writeLispRecovery, "structuredLisp"],
])("%s recovery reads legacy drafts without rewriting and upgrades only the native document on save", (_name, create, key, read, write, language) => {
  const root = create();
  const current = writeGraph(root, root, { cam: { cameraX: 10, cameraY: 20, scale: 3 }, showingUI: true });
  const legacy = { ...current, version: 1,
    nodes: current.nodes.map(({ bidi, ...node }) => ({ ...node, rightToLeft: true })),
    capabilities: { ...current.capabilities, "future/1": { payload: [false, null] } },
    metadata: { ...current.metadata, custom: { source: "keep" } },
  };
  const raw = JSON.stringify({ version: 1, savedAt: 100, document: legacy });
  localStorage.setItem(key, raw);
  expect(read().document).toEqual(legacy);
  expect(localStorage.getItem(key)).toBe(raw);
  expect(documentState(readGraph(read().document)).sourceVersion).toBe(1);
  write(read().document);
  const record = JSON.parse(localStorage.getItem(key));
  expect(record.version).toBe(1);
  expect(record.document.version).toBe(2);
  expect(record.document.metadata.freeform[language].version).toBe(1);
  expect(record.document.metadata).toEqual(legacy.metadata);
  expect(record.document.capabilities).toEqual(legacy.capabilities);
  expect(record.document.nodes.find((node) => node.id === record.document.root).bidi).toBe("ltr");
  expect(record.document.nodes.filter((node) => node.id !== record.document.root).every((node) => node.bidi === "inherit")).toBe(true);
});

test.each([
  ["JSON", createJsonDraft, JSON_RECOVERY_KEY, readJsonRecovery, writeJsonRecovery],
  ["Lisp", createLispDraft, LISP_RECOVERY_KEY, readLispRecovery, writeLispRecovery],
])("%s native recovery preserves bidi declarations and rejects malformed v2 without replacing the draft", (_name, create, key, read, write) => {
  const root = create();
  graphNodes(root).forEach((node, index) => node.setBidi([Bidi.INHERIT, Bidi.RTL, Bidi.LTR][index % 3]));
  const data = writeGraph(root, root);
  write(data);
  expect(read().document).toEqual(data);
  const before = localStorage.getItem(key);
  const malformed = JSON.parse(JSON.stringify(data));
  malformed.nodes[0].bidi = "automatic";
  expect(() => write(malformed)).toThrow();
  expect(localStorage.getItem(key)).toBe(before);
});

test("Lisp recovery preserves incomplete tokens and slots in native documents", () => {
  const source = '; heading\r\n(define name\r\n\t"complete")\r\n';
  const root = createStructuredLisp(source);
  const string = graphNodes(root).find((node) => node.value() === '"complete"');
  const edited = applyLispCommand(root, string, {
    type: "setText",
    text: '"unfinished',
  });
  const draft = writeGraph(edited.root, edited.selectedNode);
  writeStructuredRecovery(draft);
  expect(readLispRecovery().document).toEqual(draft);
  expect(
    structuredLispStatus(readGraph(readLispRecovery().document))
  ).toMatchObject({ validStructure: true, complete: false });
  const recovered = readGraph(readLispRecovery().document);
  const fixed = applyLispCommand(recovered, edited.selectedNode.id(), {
    type: "setText",
    text: '"restored"',
  });
  expect(exportStructuredLisp(fixed.root)).toBe(
    source.replace('"complete"', '"restored"')
  );
  writeStructuredRecovery(writeGraph(createLispDraft()));
  expect(
    structuredLispStatus(readGraph(readLispRecovery().document))
  ).toMatchObject({ complete: false });
});

test("JSON and Lisp recovery remain separate and the chooser offers the newest valid draft", () => {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValue(100);
  const json = writeGraph(createJsonDraft());
  writeJsonRecovery(json);
  now.mockReturnValue(200);
  const lisp = writeGraph(createLispDraft());
  writeStructuredRecovery(lisp);
  expect(readStructuredRecovery()).toEqual({
    recovery: { document: lisp, savedAt: 200 },
    error: null,
  });
  expect(JSON.parse(localStorage.getItem(JSON_RECOVERY_KEY)).document).toEqual(
    json
  );
  localStorage.setItem(LISP_RECOVERY_KEY, "{broken");
  const state = readStructuredRecovery();
  expect(state.recovery.document).toEqual(json);
  expect(state.error).toMatch(/stored draft has been kept/i);
  expect(localStorage.getItem(LISP_RECOVERY_KEY)).toBe("{broken");
});

test("malformed topology or failed storage cannot replace a recoverable Lisp draft", () => {
  const root = createLispDraft();
  writeStructuredRecovery(writeGraph(root));
  const original = localStorage.getItem(LISP_RECOVERY_KEY);
  root.connect(Direction.FORWARD, new DirectionNode("untyped"));
  expect(() => writeStructuredRecovery(writeGraph(root))).toThrow();
  expect(localStorage.getItem(LISP_RECOVERY_KEY)).toBe(original);
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(() => writeStructuredRecovery(writeGraph(createLispDraft()))).toThrow(
    /quota/
  );
  expect(localStorage.getItem(LISP_RECOVERY_KEY)).toBe(original);
});
