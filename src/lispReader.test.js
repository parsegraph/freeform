import {
  isSchemeByte,
  isSchemeNumber,
  lispScalarProblem,
  LISP_PREFIXES,
  MAX_LISP_DEPTH,
  readLisp,
} from "./lispReader";

const forms = (source) => readLisp(source).entries.map(({ value }) => value);

// Reconstruct only from parsed tokens and their owned whitespace. This catches
// dropped separators without relying on the graph/exporter implementation.
function sourceOf(item) {
  if (!item.entries) return item.text;
  const contents = item.entries.map(({ leading, value }) => leading + sourceOf(value)).join("") + item.trailing;
  if (item.kind === "document") return contents;
  if (LISP_PREFIXES[item.kind]) return LISP_PREFIXES[item.kind] + contents;
  return (item.kind === "list" ? "(" : item.kind === "vector" ? "#(" : item.prefix) + contents + ")";
}

test.each([
  "",
  " \t\r\n\n",
  "(a b\tc\n  d\n\n  e\r\n)",
  "' ; lead\r\n#| block\ncomment |#\n datum",
  "(head \n .\t#|before|#\r\n tail ; after\r\n \t)\n",
  "#;\t#;first\nsecond\r\nthird",
  '#U8( 0\t1\n #;999 255\r\n)\n#(\n|a b|\t"x\\\r\n  y"\n)',
  "('a)(#|between|#\"b\" #\\newline)",
  "#\\ \n#\\\n\r\n",
])("source whitespace has exactly one owner and reconstructs verbatim: %p", (source) => {
  expect(sourceOf(readLisp(source))).toBe(source);
});

test("same-line separators, blank lines, indentation, and closing newlines stay distinct", () => {
  const document = readLisp("\r\n(define (sum x y)\n\t(+ x y)\n)\n\n(sum 1 2)\r\n");
  expect(document.entries.map(({ leading }) => leading)).toEqual(["\r\n", "\n\n"]);
  expect(document.trailing).toBe("\r\n");
  const definition = document.entries[0].value;
  expect(definition.entries.map(({ leading }) => leading)).toEqual(["", " ", "\n\t"]);
  expect(definition.trailing).toBe("\n");
  expect(definition.entries[1].value.entries.map(({ leading }) => leading)).toEqual(["", " ", " "]);
});

test("prefix and dotted-tail comments retain their precise separator ownership", () => {
  const document = readLisp("'\t; quote\r\n(a \n .\t#| tail |#\r\nb ; after\n  )  next");
  const quote = document.entries[0].value;
  expect(quote.entries.map(({ leading }) => leading)).toEqual(["\t", "\r\n"]);
  expect(quote.trailing).toBe("");
  const list = quote.entries[1].value;
  const tail = list.entries[1];
  expect(tail.leading).toBe(" \n ");
  expect(tail.value.entries.map(({ leading }) => leading)).toEqual(["\t", "\r\n", " "]);
  expect(tail.value.trailing).toBe("");
  expect(list.trailing).toBe("\n  ");
  expect(document.entries[1].leading).toBe("  ");
});

test("the reader preserves scalar spellings, escapes, case, and numeric precision", () => {
  const tokens = [
    ["symbol", "MiXeD"],
    ["symbol", "λ→值"],
    ["symbol", String.raw`|name with \| and \x3bb;|`],
    ["string", String.raw`"line\nquote\"slash\\\x1f600;"`],
    ["number", "1234567890123456789012345678901234567890"],
    ["number", "#E#Xff"],
    ["number", "003/004"],
    ["number", "1.00E+03"],
    ["number", "2-3i"],
    ["number", "+inf.0"],
    ["boolean", "#TRUE"],
    ["character", String.raw`#\x1F600`],
    ["character", String.raw`#\space`],
    ["character", String.raw`#\)`],
  ];
  expect(forms(tokens.map(([, text]) => text).join(" "))).toEqual(
    tokens.map(([kind, text]) => ({ kind, text }))
  );
});

test("strings retain literal line endings and Scheme line continuations", () => {
  const text = '"one\\  \r\n  two\nthree"';
  expect(forms(text)).toEqual([{ kind: "string", text }]);
  expect(lispScalarProblem("string", text)).toBeNull();
});

test("line, nested block, and datum comments remain ordered around a quoted operand", () => {
  const [quote] = forms(
    "' ; first\r\n#| outer #| inner |# end |# #;hidden kept"
  );
  expect(quote.kind).toBe("quote");
  expect(quote.entries.map(({ value }) => value.kind)).toEqual([
    "comment",
    "block-comment",
    "datum-comment",
    "symbol",
  ]);
  expect(quote.entries[0].value.text).toBe("; first");
  expect(quote.entries[1].value.text).toBe("#| outer #| inner |# end |#");
  expect(quote.entries[2].value.entries[0].value.text).toBe("hidden");
  expect(quote.entries[3].value.text).toBe("kept");
  expect(forms("#; #; first second third").map((node) => node.kind)).toEqual([
    "datum-comment",
    "symbol",
  ]);
});

test("dotted tails retain comments on either side without treating them as datums", () => {
  const [list] = forms("(head #; skipped . #|before|# tail ; after\n)");
  expect(list.entries.map(({ value }) => value.kind)).toEqual([
    "symbol",
    "datum-comment",
    "dotted-tail",
  ]);
  expect(list.entries[2].value.entries.map(({ value }) => value)).toEqual([
    { kind: "block-comment", text: "#|before|#" },
    { kind: "symbol", text: "tail" },
    { kind: "comment", text: "; after" },
  ]);
});

test("vectors and bytevectors preserve distinct syntax and bytevector prefix case", () => {
  const [vector, bytes] = forms("#(a 'b ,c ,@d) #U8(#xFF #e2.0 6/2 #; 999)");
  expect(vector.kind).toBe("vector");
  expect(vector.entries.map(({ value }) => value.kind)).toEqual([
    "symbol",
    "quote",
    "unquote",
    "unquote-splicing",
  ]);
  expect(bytes.kind).toBe("bytevector");
  expect(bytes.prefix).toBe("#U8(");
  expect(bytes.entries.map(({ value }) => value.text)).toEqual([
    "#xFF",
    "#e2.0",
    "6/2",
    undefined,
  ]);
});

test.each(["+", "-", "...", "+name", "-.name", ".name", "|+1oops|", "á", "λ2"])(
  "valid peculiar or Unicode identifier retains its spelling: %s",
  (text) => {
    expect(forms(text)).toEqual([{ kind: "symbol", text }]);
  }
);

test.each([
  ".",
  "+1oops",
  "-.2oops",
  "foo#bar",
  "a,b",
  "foo'bar",
  "a\\b",
  "1name",
  "[a]",
  "{a}",
])(
  "invalid ASCII identifier syntax is rejected instead of silently reclassified: %s",
  (text) => {
    expect(() => readLisp(text)).toThrow(/Scheme:/);
  }
);

test.each([
  "#b101",
  "#o17",
  "#D12",
  "#Xab",
  "#e#xFF",
  "#x#E10",
  "1/3",
  "1e-5",
  ".5",
  "1.",
  "-i",
  "+i",
  "+2i",
  "1+i",
  "1-2i",
  "1@2",
  "+nan.0",
  "-inf.0i",
])("Scheme number spelling is accepted without conversion: %s", (text) => {
  expect(isSchemeNumber(text)).toBe(true);
  expect(forms(text)).toEqual([{ kind: "number", text }]);
});

test.each(["#e#i1", "#x#b1", "#b2", "1e", "1/", "2i", "1.2.3"])(
  "invalid numeric spelling is rejected: %s",
  (text) => {
    expect(isSchemeNumber(text)).toBe(false);
    expect(() => readLisp(text)).toThrow(/Scheme:/);
  }
);

test("bytevector values use exact bounded integer arithmetic", () => {
  for (const text of [
    "0",
    "+255",
    "-0",
    "#xFF",
    "#e2.0",
    "510/2",
    "#e0e10001",
  ]) {
    expect(isSchemeByte(text)).toBe(true);
    expect(() => readLisp(`#u8(${text})`)).not.toThrow();
  }
  for (const text of [
    "-1",
    "256",
    "#i1",
    "1.0",
    "1/2",
    "1/0",
    "#e256.0",
    "1+0i",
    "9999999999999999999999",
  ]) {
    expect(isSchemeByte(text)).toBe(false);
    expect(() => readLisp(`#u8(${text})`)).toThrow(/bytevector/);
  }
});

test.each([
  "#1=(a . #1#)",
  "#1#",
  "#!fold-case A",
  "#!no-fold-case A",
  "#.call",
  "#vu8(1)",
  "#hash(a)",
  "#\\Space",
  "#\\unknown",
  "#\\xD800",
  "#\\x110000",
  '"\\q"',
  '"\\xD800;"',
  '"\\x110000;"',
  "|bad\\q|",
])(
  "unsupported reader syntax and invalid escapes are reported: %s",
  (source) => {
    expect(() => readLisp(source)).toThrow(/Scheme:/);
  }
);

test.each([
  "'",
  "#;",
  "(a",
  "#| unfinished",
  '"unfinished',
  "|unfinished",
  "(a .)",
  "(. a)",
  "(a . b c)",
  "#(a . b)",
])(
  "unfinished or malformed containers and prefixes are rejected: %s",
  (source) => {
    expect(() => readLisp(source)).toThrow(/Scheme:/);
  }
);

test("scalar draft validation distinguishes partial tokens from complete source", () => {
  expect(lispScalarProblem("string", '"complete"')).toBeNull();
  expect(lispScalarProblem("number", "#xFF")).toBeNull();
  expect(lispScalarProblem("comment", "; intact comment")).toBeNull();
  expect(lispScalarProblem("number", "#x")).toMatch(/Scheme:/);
  expect(lispScalarProblem("string", '"unfinished')).toMatch(/Unclosed string/);
  expect(lispScalarProblem("symbol", "one two")).toMatch(/one complete/);
  expect(lispScalarProblem("symbol", " one ")).toMatch(/one complete/);
  expect(lispScalarProblem("boolean", "name")).toMatch(/one complete/);
});

test("errors include source locations and deeply nested input fails with a reader error", () => {
  expect(() => readLisp("one\r\n\r\ntwo\n)")).toThrow(/line 4, offset/);
  const depth = MAX_LISP_DEPTH + 2;
  expect(() => readLisp("(".repeat(depth) + ")".repeat(depth))).toThrow(
    /nesting depth/
  );
});
