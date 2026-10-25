import { LISP_CONTAINERS, LISP_PREFIXES, isLispComment, readLisp } from "./lispReader";

const wrappers = Object.keys(LISP_PREFIXES);
const delimiter = (char) => char === undefined || /[\s()";|]/u.test(char);
const isPending = (value) => value.kind === "slot";
const replace = (value, next) => {
  const id = value.id;
  Object.keys(value).forEach((key) => delete value[key]);
  Object.assign(value, next, id ? { id } : {});
};

// Source entry retains partial raw tokens. Classification is deliberately
// separate from the ordinary, fixed-type literal editor.
function tokenKind(text) {
  try {
    const parsed = readLisp(text);
    if (parsed.entries.length === 1 && parsed.entries[0].value.text === text)
      return parsed.entries[0].value.kind;
  } catch { /* An unfinished token remains editable in the graph. */ }
  if (text.startsWith('"')) return "string";
  if (text.startsWith("#|")) return "block-comment";
  if (text.startsWith(";")) return "comment";
  if (text.startsWith("#\\")) return "character";
  if (/^#(?:t|f)/i.test(text) || text === "#") return "boolean";
  if (/^(?:#[bodeix]|[+-]?(?:\d|\.\d))/i.test(text)) return "number";
  return "symbol";
}

function scan(text) {
  const tokens = [];
  let at = 0;
  const push = (type, start, extra = {}) => tokens.push({ type, start, end: at, raw: text.slice(start, at), ...extra });
  while (at < text.length) {
    const start = at;
    const char = text[at];
    if (/\s/u.test(char)) {
      while (at < text.length && /\s/u.test(text[at])) at++;
      push("space", start); continue;
    }
    if (char === ";") {
      while (at < text.length && !/[\r\n]/.test(text[at])) at++;
      push("atom", start); continue;
    }
    if (text.startsWith("#|", at)) {
      at += 2;
      let depth = 1;
      while (at < text.length && depth) {
        if (text.startsWith("#|", at)) { depth++; at += 2; }
        else if (text.startsWith("|#", at)) { depth--; at += 2; }
        else at++;
      }
      push("atom", start); continue;
    }
    if (char === '"' || char === "|") {
      at++;
      while (at < text.length) {
        const next = text[at++];
        if (next === "\\") { if (at < text.length) at++; }
        else if (next === char) break;
      }
      push("atom", start); continue;
    }
    if (text.startsWith("#\\", at)) {
      at += 2;
      if (at < text.length) {
        const first = String.fromCodePoint(text.codePointAt(at));
        at += first.length;
        // A delimiter character still needs a boundary after itself. Keep an
        // invalid suffix in this token instead of silently inserting a space.
        while (!delimiter(text[at])) at++;
      }
      push("atom", start); continue;
    }
    const open = /^(#u8\(|#\(|\()/i.exec(text.slice(at))?.[0];
    if (open) {
      at += open.length;
      push("open", start, { kind: open.length === 1 ? "list" : open.length === 2 ? "vector" : "bytevector" });
      continue;
    }
    if (char === ")") { at++; push("close", start); continue; }
    const prefix = text.startsWith(",@", at) ? ",@" : text.startsWith("#;", at) ? "#;"
      : "'`,".includes(char) ? char : null;
    if (prefix) {
      at += prefix.length;
      push("prefix", start, { kind: wrappers.find((kind) => LISP_PREFIXES[kind] === prefix) });
      continue;
    }
    while (!delimiter(text[at])) at++;
    push("atom", start);
  }
  return tokens;
}

function session(tree, state = {}) {
  const parents = new Map();
  const ids = new Map();
  const visit = (value, parent = null, entry = null) => {
    parents.set(value, { parent, entry });
    if (value.id) ids.set(value.id, value);
    value.entries?.forEach((child) => visit(child.value, value, child));
  };
  visit(tree);
  const created = new Set();
  const cleanup = new Map();
  for (const saved of state.created || []) {
    const value = ids.get(saved.id);
    if (!value) continue;
    created.add(value);
    if (saved.untouched !== undefined) cleanup.set(value, {
      untouched: saved.untouched,
      restoreNextId: saved.restoreNextId,
      restoreNextLeading: saved.restoreNextLeading,
    });
    // Spacing repair may temporarily separate a pending slot from its neighbor.
    // Retain the whitespace actually typed at that insertion position.
    if (isPending(value)) parents.get(value).entry.leading = saved.leading;
  }
  const pending = (parent, index, leading = "") => {
    const value = { kind: "slot" };
    const entry = { value, leading };
    parent.entries.splice(index, 0, entry);
    parents.set(value, { parent, entry });
    created.add(value);
    return value;
  };
  const indexOf = (parent, entry) => parent.entries.at(-1) === entry
    ? parent.entries.length - 1 : parent.entries.indexOf(entry);
  const optional = (value) => {
    const { parent } = parents.get(value);
    return parent && (LISP_CONTAINERS.includes(parent.kind) ||
      parent.entries.some((entry) => entry.value !== value && !isLispComment(entry.value) && !isPending(entry.value)));
  };
  const remove = (value) => {
    const { parent, entry } = parents.get(value);
    const index = indexOf(parent, entry);
    const next = parent.entries[index + 1];
    const pendingCleanup = cleanup.get(value);
    if (pendingCleanup?.untouched) {
      const originalNext = ids.get(pendingCleanup.restoreNextId);
      if (originalNext && parents.get(originalNext)?.parent === parent) {
        parents.get(originalNext).entry.leading = pendingCleanup.restoreNextLeading;
      }
    } else if (next) next.leading = entry.leading + (next.leading || "");
    else parent.trailing = entry.leading + (parent.trailing || "");
    parent.entries.splice(index, 1);
    created.delete(value);
    cleanup.delete(value);
    parents.delete(value);
    return parent.entries[index - 1]?.value || next?.value || parent;
  };
  const after = (value, leading = "") => {
    let context = parents.get(value);
    while (context.parent && wrappers.includes(context.parent.kind) &&
        context.parent.kind !== "dotted-tail" && !isLispComment(value)) {
      value = context.parent;
      context = parents.get(value);
    }
    if (!context.parent) return pending(value, value.entries.length, leading);
    return pending(context.parent, indexOf(context.parent, context.entry) + 1, leading);
  };
  const inside = (value) => {
    if (wrappers.includes(value.kind)) {
      const operand = value.entries.find((entry) => !isLispComment(entry.value));
      if (operand) return operand.value.entries ? inside(operand.value) : operand.value;
    }
    const tail = value.entries.findIndex((entry) => entry.value.kind === "dotted-tail");
    const index = tail < 0 ? value.entries.length : tail;
    const last = value.entries[index - 1];
    if (last && isPending(last.value)) return last.value;
    const leading = index === value.entries.length ? value.trailing || "" : "";
    if (index === value.entries.length) value.trailing = "";
    return pending(value, index, leading);
  };
  const openRow = (selected, mode) => {
    let value = selected;
    let context = parents.get(value);
    while (context.parent && wrappers.includes(context.parent.kind)) {
      value = context.parent;
      context = parents.get(value);
    }
    const parent = context.parent || value;
    if (!LISP_CONTAINERS.includes(parent.kind)) throw new Error("Scheme: select a form in a source row.");
    if (!parent.entries.length || (parent === tree && parent.entries.length === 1 && isPending(parent.entries[0].value)))
      return inside(parent);
    let start = context.parent ? indexOf(parent, context.entry)
      : mode === "above" ? 0 : parent.entries.length - 1;
    while (start > 0 && !/[\r\n]/.test(parent.entries[start].leading)) start--;
    let end = start + 1;
    while (end < parent.entries.length && !/[\r\n]/.test(parent.entries[end].leading)) end++;
    const current = parent.entries[start];
    const next = parent.entries[end];
    const newline = [...parent.entries.map((entry) => entry.leading), parent.trailing]
      .find((leading) => /[\r\n]/.test(leading || ""))?.match(/\r\n|\r|\n/)[0] || "\n";
    const rowLeading = current.leading;
    const nearbyLeading = /[\r\n]/.test(rowLeading) || rowLeading ? rowLeading
      : next?.leading || (start > 0 ? parent.entries[start - 1].leading : "");
    const indent = mode === "above" ? rowLeading.match(/[^\r\n]*$/)[0]
      : nearbyLeading ? nearbyLeading.match(/[^\r\n]*$/)[0]
      : parent.kind === "document" ? "" : "  ";
    if (mode === "below" && parent.entries[end - 1].value.kind === "dotted-tail")
      throw new Error("Scheme: a dotted tail ends its list; select the containing list to open a row after it.");
    let gap;
    if (mode === "above") {
      const originalLeading = current.leading;
      gap = pending(parent, start, originalLeading);
      current.leading = newline + indent;
      cleanup.set(gap, { untouched: true, restoreNextId: current.value.id, restoreNextLeading: originalLeading });
    } else {
      gap = pending(parent, end, newline + indent);
      cleanup.set(gap, { untouched: true });
    }
    return gap;
  };
  return { parents, ids, created, cleanup, pending, optional, remove, after, inside, openRow };
}

function result(selected, edit, text = selected.text || "", caret = text.length) {
  return { selected, created: [...edit.created].map((value) => ({ value, leading: edit.parents.get(value).entry.leading, ...edit.cleanup.get(value) })), text, caret };
}

export function beginSourceInput(tree, selected, { mode = "insert" } = {}) {
  const edit = session(tree);
  if (mode === "change") {
    if (selected.entries) throw new Error("Scheme: select a token or slot to change.");
    replace(selected, { kind: "slot" });
  } else if (mode === "above" || mode === "below") selected = edit.openRow(selected, mode);
  else if (mode === "insert") {
    if (selected.entries) selected = edit.inside(selected);
  } else throw new Error("Scheme: unknown source insertion mode.");
  return result(selected, edit);
}

export function editSourceInput(tree, state, text, caret = text.length) {
  if (typeof text !== "string") throw new Error("Scheme: source input must be text.");
  const edit = session(tree, state);
  let cursor = edit.ids.get(state.nodeId);
  if (!cursor || cursor.entries) throw new Error("Scheme: the source insertion point is no longer editable.");
  caret = Math.max(0, Math.min(text.length, Number.isFinite(caret) ? caret : text.length));
  const initial = edit.parents.get(cursor);
  if (text && edit.cleanup.has(cursor)) edit.cleanup.get(cursor).untouched = false;
  // A comma typed on its own has already opened an unquote operand.
  if (isPending(cursor) && edit.created.has(cursor) && initial.parent?.kind === "unquote" &&
      !initial.entry.leading && text.startsWith("@")) {
    initial.parent.kind = "unquote-splicing";
    text = text.slice(1); caret = Math.max(0, caret - 1);
  }
  replace(cursor, { kind: "slot" });
  const tokens = scan(text);
  let selectedAtCaret;
  let caretInToken = 0;
  const ensureGap = () => { if (!isPending(cursor)) cursor = edit.after(cursor); };
  tokens.forEach((token, index) => {
    if (token.type === "space") {
      if (!isPending(cursor)) cursor = edit.after(cursor, token.raw);
      else edit.parents.get(cursor).entry.leading += token.raw;
    } else if (token.type === "open" || token.type === "prefix") {
      ensureGap();
      replace(cursor, { kind: token.kind, entries: [], trailing: "",
        ...(token.kind === "bytevector" ? { prefix: token.raw } : {}) });
      cursor = edit.pending(cursor, 0);
    } else if (token.type === "close") {
      let container = edit.parents.get(cursor).parent;
      while (container && !LISP_CONTAINERS.includes(container.kind)) container = edit.parents.get(container).parent;
      if (!container || container.kind === "document") {
        ensureGap();
        replace(cursor, { kind: "symbol", text: ")" });
      } else {
        if (isPending(cursor) && edit.created.has(cursor) && edit.optional(cursor)) edit.remove(cursor);
        cursor = edit.after(container);
      }
    } else {
      ensureGap();
      const parent = edit.parents.get(cursor).parent;
      const isDot = token.raw === "." && parent?.kind === "list" &&
        tokens[index + 1] && ["space", "close"].includes(tokens[index + 1].type);
      if (isDot) {
        replace(cursor, { kind: "dotted-tail", entries: [], trailing: "" });
        cursor = edit.pending(cursor, 0);
      } else replace(cursor, { kind: tokenKind(token.raw), text: token.raw });
    }
    if (selectedAtCaret === undefined && caret <= token.end) {
      selectedAtCaret = cursor;
      caretInToken = token.type === "atom" && cursor.text === token.raw
        ? Math.max(0, caret - token.start) : 0;
    }
  });
  const selected = edit.parents.has(selectedAtCaret) ? selectedAtCaret : cursor;
  return result(selected, edit, selected.text || "", selected === selectedAtCaret ? caretInToken : (selected.text || "").length);
}

export function finishSourceInput(tree, state) {
  const edit = session(tree, state);
  let selected = edit.ids.get(state.nodeId) || tree;
  // Empty insertion positions are optional; deliberately cleared existing
  // values and missing reader-prefix operands remain visible draft slots.
  for (const value of edit.created) {
    if (!isPending(value) || !edit.optional(value)) continue;
    const fallback = edit.remove(value);
    if (selected === value) selected = fallback;
  }
  return { selected, created: null, text: "", caret: 0 };
}
