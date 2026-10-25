import { Direction, DirectionNode } from "parsegraph";
import { graphNodes, readGraph, writeGraph } from "./graphDocument";
import {
  createLispDraft,
  createStructuredLisp,
  applyLispCommand,
  exportStructuredLisp,
  structuredLispStatus,
} from "./structuredLisp";
import { createJsonDraft } from "./structuredJson";
import { JSON_RECOVERY_KEY, writeJsonRecovery } from "./structuredJsonRecovery";
import {
  LISP_RECOVERY_KEY,
  readLispRecovery,
  readStructuredRecovery,
  writeStructuredRecovery,
} from "./structuredRecovery";

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

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
