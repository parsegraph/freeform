import { graphNodes, readGraph, writeGraph } from "./graphDocument";
import { readLisp } from "./lispReader";
import {
  beginLispSourceInput, editLispSourceInput, finishLispSourceInput,
  createLispDraft, createStructuredLisp, exportStructuredLisp, structuredLispStatus,
  inspectLispSelection,
} from "./structuredLisp";

function start(root = createLispDraft(), node = root, options) {
  return beginLispSourceInput(root, node, options);
}
function type(session, source) {
  for (const char of source) {
    const text = session.text.slice(0, session.caret) + char + session.text.slice(session.caret);
    session = editLispSourceInput(session.root, session.state, text, session.caret + char.length);
    expect(structuredLispStatus(session.root).validStructure).toBe(true);
  }
  return session;
}
const finish = (session) => finishLispSourceInput(session.root, session.state);
const sourceOf = (session) => exportStructuredLisp(finish(session).root);

test("type a complete nested Scheme document key for key", () => {
  const source = "(define (square x)\n  (* x x))\n(square 5)";
  const session = type(start(), source);
  expect(sourceOf(session)).toBe(source);
  expect(exportStructuredLisp(readGraph(writeGraph(finish(session).root)))).toBe(source);
  expect(graphNodes(session.root).every((node) => node.value() !== undefined)).toBe(true);
});

test.each([
  "()", "(a )", "  (a  b)\n\n", "(a\r\n\t b)\r\n", '"a (space) and \\"quote\\""',
  '; comment (not a list)\n(display "a b")',
  '#| outer #| nested |# (comment) |#\n|escaped symbol|',
  "#\\( #\\) #\\space #\\ ",
  "'(a . b) `(a ,b ,@c) , @name",
  "#; (ignored form) (real form)", "#(a b) #U8(0 #xFF 6/2)",
  "' #; skipped kept", "(a)(b)\"c\"d",
  "(a ;c\n)", "(a . b ;last\n)", "((a ;nested\r\n) ;outer\r\n)",
])("source-entry delimiters preserve reader semantics and whitespace: %j", (source) => {
  expect(sourceOf(type(start(), source))).toBe(source);
});

test("an unfinished final comment receives a closing boundary only when entry finishes", () => {
  const session = type(start(), "(a ;unfinished");
  expect(structuredLispStatus(session.root)).toMatchObject({ validStructure: true, complete: false });
  expect(sourceOf(session)).toBe("(a ;unfinished\n)");
});

test.each(["#x", "#\\", '"unfinished', "|unfinished", "#| unfinished"])("partial source token %j survives native drafts", (source) => {
  const session = finish(type(start(), source));
  const loaded = readGraph(writeGraph(session.root));
  expect(inspectLispSelection(loaded, session.selectedNode.id()).text).toBe(source);
  expect(structuredLispStatus(loaded)).toMatchObject({ validStructure: true, complete: false });
});

test("source entry infers types, while ordinary raw editing remains independent", () => {
  let session = type(start(), "-");
  expect(inspectLispSelection(session.root, session.selectedNode).kind).toBe("symbol");
  session = type(session, "12");
  expect(inspectLispSelection(session.root, session.selectedNode).kind).toBe("number");
  session = type(session, " #xFF #t");
  expect(sourceOf(session)).toBe("-12 #xFF #t");
});

test("pasting complete source uses one atomic model event", () => {
  const source = '; preserved\n(define x "text with spaces")\n\n(+ x 1)\n';
  const session = start();
  const changed = editLispSourceInput(session.root, session.state, source);
  expect(sourceOf(changed)).toBe(source);
  expect(exportStructuredLisp(readGraph(writeGraph(finish(changed).root)))).toBe(source);
});

test("begin and Escape leave existing containers and tokens unchanged", () => {
  for (const source of ["(a)", "(a )", "(a\n)", "(a b)"]) {
    const root = createStructuredLisp(source);
    const list = graphNodes(root).find((node) => inspectLispSelection(root, node).kind === "list");
    expect(sourceOf(start(root, list))).toBe(source);
  }
  const root = createStructuredLisp("alpha beta");
  const alpha = graphNodes(root).find((node) => node.value() === "alpha");
  expect(sourceOf(start(root, alpha))).toBe("alpha beta");
});

test("whitespace creates one pending position and Escape retains only required holes", () => {
  let session = type(start(), "value   \n\n");
  expect(graphNodes(session.root).filter((node) => node.value() === "[value]")).toHaveLength(1);
  expect(sourceOf(session)).toBe("value   \n\n");
  session = finish(type(start(), "'"));
  expect(structuredLispStatus(session.root)).toMatchObject({ complete: false, slotCount: 1 });
  const original = createLispDraft();
  expect(structuredLispStatus(finish(start(original)).root).complete).toBe(false);
});

test("native caret edits split a token without losing its suffix", () => {
  const root = createStructuredLisp("foobar");
  const value = graphNodes(root).find((node) => node.value() === "foobar");
  let session = start(root, value);
  session = editLispSourceInput(session.root, session.state, "foo bar", 4);
  expect(session.text).toBe("bar");
  expect(session.caret).toBe(0);
  session = type(session, "new-");
  expect(sourceOf(session)).toBe("foo new-bar");
});

test("whole-text input supports Unicode composition without treating letters as navigation", () => {
  let session = start();
  session = editLispSourceInput(session.root, session.state, "λ名前", 3);
  expect(session.text).toBe("λ名前");
  expect(sourceOf(session)).toBe("λ名前");
});

test("invalid character adjacency remains an editable draft instead of gaining whitespace", () => {
  const session = finish(type(start(), "#\\)suffix"));
  expect(inspectLispSelection(session.root, session.selectedNode).text).toBe("#\\)suffix");
  expect(structuredLispStatus(session.root)).toMatchObject({ validStructure: true, complete: false });
});

test("accepted adjacent reader forms retain their exact source through key-for-key input", () => {
  const forms = ["alpha", "(a)", '"x"', "#\\)", "|escaped|", "'a", "#;x y", "#| note |#", "; c\n"];
  let checked = 0;
  for (const left of forms) for (const right of forms) for (const separator of ["", " ", "\n"]) {
    const source = left + separator + right;
    try { readLisp(source); } catch { continue; }
    expect(sourceOf(type(start(), source))).toBe(source);
    checked++;
  }
  expect(checked).toBeGreaterThan(150);
});

const atPath = (root, path) => graphNodes(root).find((node) => inspectLispSelection(root, node).path === path);

test("change starts blank, retains token identity, and infers the replacement type", () => {
  const root = createStructuredLisp("(value other)");
  const value = atPath(root, "$[0][0]");
  let session = start(root, value, { mode: "change" });
  expect(session.text).toBe("");
  expect(session.selectedNode.id()).toBe(value.id());
  expect(structuredLispStatus(finish(session).root).complete).toBe(false);
  session = type(session, "42");
  expect(session.selectedNode.id()).toBe(value.id());
  expect(inspectLispSelection(session.root, session.selectedNode).kind).toBe("number");
  expect(sourceOf(session)).toBe("(42 other)");
  expect(() => start(root, atPath(root, "$[0]"), { mode: "change" })).toThrow(/token or slot/);
  expect(exportStructuredLisp(root)).toBe("(value other)");
});

test("opening above a function body inherits its CRLF indentation without splitting its row", () => {
  const source = "(define (square x)\r\n\t(display x) (* x x))\r\n(square 5)";
  const root = createStructuredLisp(source);
  const body = atPath(root, "$[0][3]");
  const session = type(start(root, body, { mode: "above" }), "(debug x)");
  expect(sourceOf(session)).toBe("(define (square x)\r\n\t(debug x)\r\n\t(display x) (* x x))\r\n(square 5)");
});

test("opening below a header inherits the next body row's indentation", () => {
  const source = "(define (square x)\n  (* x x))";
  const root = createStructuredLisp(source);
  const header = atPath(root, "$[0][1]");
  expect(sourceOf(type(start(root, header, { mode: "below" }), "(debug x)")))
    .toBe("(define (square x)\n  (debug x)\n  (* x x))");
});

test.each(["above", "below"])("untouched %s keeps existing whitespace exactly", (mode) => {
  for (const source of ["(a b)", "(a\r\n\r\n\tbody)\r\n", "  a b\n\nlast\t", "; EOF", " \r\n"]) {
    const root = createStructuredLisp(source);
    const selected = source.startsWith("(") ? atPath(root, "$[0][0]") : root;
    expect(sourceOf(start(root, selected, { mode }))).toBe(source);
  }
});

test("source row commands promote reader-prefix operands to their enclosing row", () => {
  const source = "'value\r\nnext";
  const root = createStructuredLisp(source);
  const operand = atPath(root, "$[0][0]");
  expect(sourceOf(type(start(root, operand, { mode: "above" }), "debug"))).toBe("debug\r\n'value\r\nnext");
  expect(sourceOf(type(start(root, operand, { mode: "below" }), "debug"))).toBe("'value\r\ndebug\r\nnext");
});

test("a dotted tail accepts an earlier row and rejects a later sibling row", () => {
  const root = createStructuredLisp("(a\n . tail)");
  const operand = atPath(root, "$[0][1][0]");
  expect(sourceOf(type(start(root, operand, { mode: "above" }), "extra"))).toBe("(a\n extra\n . tail)");
  expect(() => start(root, operand, { mode: "below" })).toThrow(/dotted tail ends its list/);
  expect(exportStructuredLisp(root)).toBe("(a\n . tail)");
});

test("document row commands open the beginning and end without reindenting existing rows", () => {
  const root = createStructuredLisp("first same\n  last");
  expect(sourceOf(type(start(root, root, { mode: "above" }), "debug"))).toBe("debug\nfirst same\n  last");
  expect(sourceOf(type(start(root, root, { mode: "below" }), "debug"))).toBe("first same\n  last\n  debug");
});

test("opened rows retain existing blank lines and deliberate whitespace", () => {
  const root = createStructuredLisp("(a\n\n  body)");
  const body = atPath(root, "$[0][1]");
  expect(sourceOf(type(start(root, body, { mode: "above" }), "debug"))).toBe("(a\n\n  debug\n  body)");
  expect(sourceOf(type(start(root, body, { mode: "above" }), " "))).toBe("(a\n\n   \n  body)");
});
