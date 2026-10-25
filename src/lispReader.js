// A reader for editable Scheme data, never an evaluator. Scalar spellings are
// retained verbatim; comments are nodes rather than discarded atmosphere.
export const LISP_CONTAINERS = ["document", "list", "vector", "bytevector"];
export const LISP_PREFIXES = {
  quote: "'", quasiquote: "`", unquote: ",", "unquote-splicing": ",@",
  "datum-comment": "#;", "dotted-tail": ".",
};
export const LISP_SCALARS = [
  "symbol", "string", "number", "boolean", "character", "comment", "block-comment",
];
export const isLispComment = (item) =>
  ["comment", "block-comment", "datum-comment"].includes(item.kind);
export const MAX_LISP_DEPTH = 512;
const delimiter = (char) => char === undefined || /[\s()";|]/u.test(char);
const scalarValue = (hex) => {
  const value = Number.parseInt(hex, 16);
  return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
};

function numberParts(text) {
  let body = text;
  let radix = 10;
  let exactness;
  let hasRadix = false;
  while (/^#[bodeix]/i.test(body)) {
    const prefix = body[1].toLowerCase();
    if (prefix === "e" || prefix === "i") {
      if (exactness) return null;
      exactness = prefix;
    } else {
      if (hasRadix) return null;
      hasRadix = true;
      radix = { b: 2, o: 8, d: 10, x: 16 }[prefix];
    }
    body = body.slice(2);
  }
  return { body, radix, exactness };
}

export function isSchemeNumber(text) {
  const parts = numberParts(text);
  if (!parts) return false;
  const { body, radix } = parts;
  const digits = { 2: "[01]", 8: "[0-7]", 10: "[0-9]", 16: "[0-9a-f]" }[radix];
  const integer = `${digits}+`;
  const decimal = radix === 10
    ? "(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:e[+-]?[0-9]+)?"
    : integer;
  const unsigned = `(?:${integer}/${integer}|${decimal})`;
  const special = "[+-](?:inf|nan)\\.0";
  const real = `(?:[+-]?${unsigned}|${special})`;
  const imaginary = `(?:[+-](?:${unsigned})?|${special})i`;
  return new RegExp(`^(?:${real}|${real}@${real}|(?:${real})?${imaginary})$`, "i").test(body);
}

// Bytevector validation needs a bounded integer, not JS floating point. This
// covers radix integers, exact rationals, and explicitly exact decimal forms.
export function isSchemeByte(text) {
  if (!isSchemeNumber(text)) return false;
  const { body, radix, exactness } = numberParts(text);
  if (exactness === "i") return false;
  let unsigned = body;
  let sign = 1n;
  if (/^[+-]/.test(unsigned)) {
    if (unsigned[0] === "-") sign = -1n;
    unsigned = unsigned.slice(1);
  }
  const toInteger = (value) => {
    const prefix = { 2: "0b", 8: "0o", 10: "", 16: "0x" }[radix];
    return BigInt(prefix + value);
  };
  try {
    let numerator;
    let denominator = 1n;
    if (unsigned.includes("/")) {
      const parts = unsigned.split("/");
      numerator = toInteger(parts[0]); denominator = toInteger(parts[1]);
    } else if (radix === 10 && /[.e]/i.test(unsigned)) {
      if (exactness !== "e") return false;
      const match = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(unsigned);
      if (!match) return false;
      numerator = BigInt((match[1] || "0") + (match[2] || ""));
      const power = Number(match[3] || 0) - (match[2]?.length || 0);
      if (Math.abs(power) > 1000) return numerator === 0n;
      if (power < 0) denominator = 10n ** BigInt(-power);
      else numerator *= 10n ** BigInt(power);
    } else numerator = toInteger(unsigned);
    numerator *= sign;
    return denominator !== 0n && numerator % denominator === 0n &&
      numerator / denominator >= 0n && numerator / denominator <= 255n;
  } catch { return false; }
}

const initial = (char) => Boolean(char) && (/^[a-z!$%&*/:<=>?@^_~]$/i.test(char) ||
  (char.codePointAt(0) > 127 && /^[\p{L}\p{Nl}\p{Mn}\p{No}\p{Pd}\p{Pc}\p{Po}\p{Sc}\p{Sm}\p{Sk}\p{So}\p{Co}\u200c\u200d]$/u.test(char)));
const subsequent = (char) => initial(char) || /^[0-9+\-.\p{Nd}\p{Mc}\p{Me}]$/u.test(char);
function isSymbol(text) {
  const chars = [...text];
  if (!chars.length || !chars.every(subsequent)) return false;
  if (initial(chars[0])) return true;
  const signNext = (char) => initial(char) || /^[+\-@]$/.test(char);
  const dotNext = (char) => char === "." || signNext(char);
  if (chars[0] === "+" || chars[0] === "-") {
    return chars.length === 1 || signNext(chars[1]) ||
      (chars[1] === "." && chars.length > 2 && dotNext(chars[2]));
  }
  return chars[0] === "." && chars.length > 1 && dotNext(chars[1]);
}

export function readLisp(source) {
  if (typeof source !== "string") throw new Error("Scheme: source must be text.");
  let offset = 0;
  const fail = (message) => {
    const prefix = source.slice(0, offset);
    const line = prefix.split(/\r\n|\r|\n/).length;
    throw new Error(`Scheme: line ${line}, offset ${offset}: ${message}`);
  };
  const whitespace = () => {
    const start = offset;
    while (offset < source.length && /\s/u.test(source[offset])) offset++;
    return source.slice(start, offset);
  };
  const entry = (depth) => {
    const leading = whitespace();
    return { leading, value: datum(depth) };
  };
  const delimited = (start, quote, kind) => {
    offset++;
    while (offset < source.length) {
      const char = source[offset++];
      if (char === quote) return { kind, text: source.slice(start, offset) };
      if (char !== "\\") continue;
      const escape = source[offset++];
      if (escape === undefined) fail("Unfinished escape sequence.");
      if ("abtnr|".includes(escape) || (kind === "string" && '\\"'.includes(escape))) continue;
      if (escape === "x") {
        const match = /^[0-9a-f]+;/i.exec(source.slice(offset));
        if (!match || !scalarValue(match[0].slice(0, -1))) fail("Invalid Unicode scalar escape.");
        offset += match[0].length;
        continue;
      }
      if (kind === "string" && /[ \t\r\n]/.test(escape)) {
        offset--;
        const match = /^[ \t]*(?:\r\n|\r|\n)[ \t]*/.exec(source.slice(offset));
        if (!match) fail("String continuation requires a line ending.");
        offset += match[0].length;
        continue;
      }
      fail("Unsupported escape sequence.");
    }
    fail(kind === "string" ? "Unclosed string." : "Unclosed escaped symbol.");
  };
  const datum = (depth) => {
    if (depth > MAX_LISP_DEPTH) fail("Supported nesting depth exceeded.");
    const start = offset;
    if (offset === source.length) fail("Expected a datum.");
    const char = source[offset];
    if (char === ";") {
      while (offset < source.length && !/[\r\n]/.test(source[offset])) offset++;
      return { kind: "comment", text: source.slice(start, offset) };
    }
    if (source.startsWith("#|", offset)) {
      offset += 2;
      let level = 1;
      while (offset < source.length && level) {
        if (source.startsWith("#|", offset)) { level++; offset += 2; }
        else if (source.startsWith("|#", offset)) { level--; offset += 2; }
        else offset++;
      }
      if (level) fail("Unclosed block comment.");
      return { kind: "block-comment", text: source.slice(start, offset) };
    }
    const prefix = source.startsWith(",@", offset) ? ",@"
      : source.startsWith("#;", offset) ? "#;"
      : "'`,".includes(char) ? char : null;
    if (prefix) {
      offset += prefix.length;
      const entries = [];
      do { entries.push(entry(depth + 1)); }
      while (isLispComment(entries.at(-1).value));
      const kind = Object.keys(LISP_PREFIXES).find((kind) => LISP_PREFIXES[kind] === prefix);
      return { kind, entries, trailing: "" };
    }
    const open = source.slice(offset).match(/^(#u8\(|#\(|\()/i)?.[0];
    if (open) {
      offset += open.length;
      const kind = open.length === 1 ? "list" : open.length === 2 ? "vector" : "bytevector";
      const entries = [];
      let trailing = "";
      while (true) {
        const leading = whitespace();
        if (offset === source.length) fail("Unclosed container.");
        if (source[offset] === ")") { trailing = leading; offset++; break; }
        if (source[offset] === "." && delimiter(source[offset + 1])) {
          if (kind !== "list" || !entries.some(({ value }) => !isLispComment(value))) fail("A dotted tail requires a preceding list datum.");
          offset++;
          const tail = [];
          while (true) {
            const leading = whitespace();
            if (source[offset] === ")") { trailing = leading; break; }
            tail.push({ leading, value: datum(depth + 1) });
          }
          if (tail.filter(({ value }) => !isLispComment(value)).length !== 1) fail("A dotted tail requires exactly one datum.");
          entries.push({ leading, value: { kind: "dotted-tail", entries: tail, trailing: "" } });
          offset++;
          break;
        }
        const value = datum(depth + 1);
        if (kind === "bytevector" && !isLispComment(value) &&
            (value.kind !== "number" || !isSchemeByte(value.text))) fail("A bytevector requires exact integers from 0 to 255.");
        entries.push({ leading, value });
      }
      // Preserve #U8 versus #u8 too: this is a literal prefix spelling.
      return { kind, entries, trailing, ...(kind === "bytevector" ? { prefix: open } : {}) };
    }
    if (char === '"') return delimited(start, '"', "string");
    if (char === "|") return delimited(start, "|", "symbol");
    if (source.startsWith("#\\", offset)) {
      offset += 2;
      if (offset === source.length) fail("Unfinished character literal.");
      const first = String.fromCodePoint(source.codePointAt(offset));
      offset += first.length;
      if (!delimiter(first)) while (!delimiter(source[offset])) offset++;
      else if (!delimiter(source[offset])) fail("Character literals require a delimiter.");
      const name = source.slice(start + 2, offset);
      if ([...name].length !== 1 && !/^(alarm|backspace|delete|escape|newline|null|return|space|tab)$/.test(name) &&
          !(/^x[0-9a-f]+$/i.test(name) && scalarValue(name.slice(1)))) fail("Unsupported character literal.");
      return { kind: "character", text: source.slice(start, offset) };
    }
    if (char === ")") fail("Unexpected closing parenthesis.");
    while (!delimiter(source[offset])) offset++;
    const text = source.slice(start, offset);
    if (/^#(?:t|f|true|false)$/i.test(text)) return { kind: "boolean", text };
    if (isSchemeNumber(text)) return { kind: "number", text };
    if (text.startsWith("#")) fail("Unsupported or invalid reader form (datum labels and directives are not supported).");
    if (!isSymbol(text)) fail("Invalid symbol or numeric literal.");
    return { kind: "symbol", text };
  };
  const entries = [];
  while (true) {
    const leading = whitespace();
    if (offset === source.length) return { kind: "document", entries, trailing: leading };
    entries.push({ leading, value: datum(0) });
  }
}

export function lispScalarProblem(kind, text) {
  try {
    const items = readLisp(text).entries;
    if (items.length !== 1 || items[0].value.kind !== kind || items[0].value.text !== text) {
      return `Enter one complete ${kind} token, including its source delimiters.`;
    }
    return null;
  } catch (error) { return error.message; }
}
