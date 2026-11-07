import { Alignment, Direction, DirectionCaret, DirectionNode, Fit, SHRINK_SCALE } from "parsegraph";
import { CURRENT_DOCUMENT_VERSION, documentState, graphNodes, normalizeGraph } from "./graphDocument";
import {
  readLisp, LISP_CONTAINERS, LISP_PREFIXES, LISP_SCALARS,
  isLispComment, isSchemeByte, lispScalarProblem, MAX_LISP_DEPTH,
} from "./lispReader";
import { beginSourceInput, editSourceInput, finishSourceInput } from "./lispSourceInput";

const DOCUMENT_STATE = Symbol.for("parsegraph.freeform.document");
const WRAPPERS = Object.keys(LISP_PREFIXES);
const KINDS = [...LISP_CONTAINERS, ...WRAPPERS, ...LISP_SCALARS, "slot"];
const REPLACE_KINDS = KINDS.filter((kind) => !["document", "dotted-tail"].includes(kind));
const WRAP_KINDS = ["list", "vector", "quote", "quasiquote", "unquote", "unquote-splicing", "datum-comment"];
const PLANAR = [Direction.DOWNWARD, Direction.UPWARD, Direction.FORWARD, Direction.BACKWARD];
const DIRECTIONS = [...PLANAR, Direction.INWARD, Direction.OUTWARD];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const metadataOf = (root) => documentState(root)?.metadata?.freeform?.structuredLisp;
const SOURCE_LINES = "source-lines";
const DIRECT_SOURCE_LINES = "direct-source-lines";
const hasNewline = (text) => /[\r\n]/.test(text);
const whitespace = (text) => typeof text === "string" && /^\s*$/u.test(text);
const slotHints = new WeakMap();
const hasEntries = (kind) => LISP_CONTAINERS.includes(kind) || WRAPPERS.includes(kind);
const slot = () => ({ kind: "slot" });
const entry = (value = slot(), leading) => ({ value, ...(leading !== undefined ? { leading } : {}) });
const child = (node, direction) => node.neighbors().hasChild(direction)
  ? node.neighbors().nodeAt(direction) : null;
const label = (item) => ({
  document: "Scheme", list: "()", vector: "#()", bytevector: `${item.prefix || "#u8("})`,
  slot: "[value]", ...LISP_PREFIXES,
}[item.kind] ?? item.text);

export const isStructuredLisp = (root) => metadataOf(root) !== undefined;

function endsInLineComment(item) {
  if (item.kind === "comment") return true;
  return WRAPPERS.includes(item.kind) && !hasNewline(item.trailing || "") &&
    Boolean(item.entries?.length && endsInLineComment(item.entries.at(-1).value));
}

function needsDelimiter(item) {
  if (WRAPPERS.includes(item.kind)) return !item.trailing &&
    Boolean(item.entries?.length && needsDelimiter(item.entries.at(-1).value));
  return ["number", "boolean", "character", "slot"].includes(item.kind) ||
    (item.kind === "symbol" && !item.text.startsWith("|"));
}

function needsLeadingSpace(container, current, index) {
  const first = label(current.value)?.[0] || "[";
  const delimiter = /[\s()";|]/u.test(first);
  if (!index) return (container.kind === "dotted-tail" && !delimiter) ||
    (container.kind === "unquote" && first === "@");
  return needsDelimiter(container.entries[index - 1].value) && !delimiter;
}

// Keep imported whitespace verbatim. Only newly generated or unsafe boundaries
// need repair: edited atoms must not fuse, and comments must not swallow forms.
function prepareSpacing(item) {
  if (!item.entries) return;
  item.trailing ??= "";
  item.entries.forEach((current, index) => {
    prepareSpacing(current.value);
    current.leading ??= index ? " " : item.kind === "dotted-tail" ? " " : "";
    const previous = item.entries[index - 1]?.value;
    if (previous && endsInLineComment(previous) && !hasNewline(current.leading)) {
      current.leading = "\n" + current.leading;
    } else if (!current.leading && needsLeadingSpace(item, current, index)) {
      current.leading = " ";
    }
  });
  if (["list", "vector", "bytevector"].includes(item.kind) && item.entries.length &&
      endsInLineComment(item.entries.at(-1).value) && !hasNewline(item.trailing)) {
    item.trailing = "\n" + item.trailing;
  }
}

function sourceRows(entries) {
  const rows = [];
  entries.forEach((itemEntry, index) => {
    if (!index || hasNewline(itemEntry.leading)) rows.push([]);
    rows.at(-1).push(itemEntry);
  });
  return rows;
}

const newlineFor = (container) => [...container.entries.map((item) => item.leading), container.trailing]
  .find((text) => hasNewline(text || ""))?.match(/\r\n|\r|\n/)[0] || "\n";

function removeEntry(container, index) {
  const [removed] = container.entries.splice(index, 1);
  const next = container.entries[index];
  if (next) {
    // Deleting an entire row keeps the next row's existing boundary. If the
    // next form shared the deleted form's row, it inherits that row's indent.
    if (hasNewline(removed.leading) && !hasNewline(next.leading)) next.leading = removed.leading;
    else if (!index && !hasNewline(next.leading)) next.leading = removed.leading;
  }
}

function invalid(node, path, message) {
  const issue = { nodeId: typeof node?.id === "function" ? node.id() : node?.id ?? null, path, message };
  const error = new Error(`Scheme: ${path}: ${message}`);
  error.issues = [issue];
  throw error;
}

function decode(root) {
  const metadata = metadataOf(root);
  if (!record(metadata) || metadata.version !== 1 || !record(metadata.nodes)) {
    invalid(root, "$", "Unsupported or missing structured Scheme draft metadata.");
  }
  if (metadata.layout !== undefined && ![SOURCE_LINES, DIRECT_SOURCE_LINES].includes(metadata.layout)) {
    invalid(root, "$", "Unsupported structured Scheme layout.");
  }
  const direct = metadata.layout === DIRECT_SOURCE_LINES;
  const sourceLines = direct || metadata.layout === SOURCE_LINES;
  if (metadata.innerScale !== undefined && (!Number.isFinite(metadata.innerScale) || metadata.innerScale <= 0)) {
    invalid(root, "$", "Invalid inner-content scale baseline.");
  }
  const seen = new Set();
  const physical = new Map();
  const contexts = new Map();
  const visit = (node, allowed, path, expected) => {
    if (!node) invalid(root, path, "The graph is missing a required node.");
    const id = node.id();
    if (typeof id !== "string" || seen.has(id) || !own(metadata.nodes, id)) {
      invalid(node, path, "Every Scheme graph node needs a unique declared role.");
    }
    const role = metadata.nodes[id];
    if (!record(role) || typeof role.kind !== "string" || (expected && role.kind !== expected)) {
      invalid(node, path, `Expected ${expected || "a Scheme"} node role.`);
    }
    seen.add(id); physical.set(id, node);
    for (const direction of DIRECTIONS) {
      if (child(node, direction) && !allowed.includes(direction)) invalid(node, path, "Unexpected connection outside the Scheme structure.");
    }
    return role;
  };
  const value = (node, parent, itemEntry, index, path, depth, rowStart = false) => {
    if (depth > MAX_LISP_DEPTH) invalid(node, path, "Supported nesting depth exceeded.");
    const allowed = [Direction.INWARD];
    if (direct && parent) {
      allowed.push(Direction.FORWARD);
      if (rowStart) allowed.push(Direction.DOWNWARD);
    }
    const role = visit(node, allowed, path);
    if (!KINDS.includes(role.kind) || (role.kind === "document" && parent)) invalid(node, path, "Unknown or misplaced Scheme role.");
    const item = { id: node.id(), kind: role.kind };
    const context = { value: item, parent, entry: itemEntry, index, path };
    contexts.set(item.id, context);
    if (direct && itemEntry) {
      if (!whitespace(role.leading)) invalid(node, path, "Invalid form leading whitespace.");
      itemEntry.leading = role.leading;
    }
    if (item.kind === "bytevector") {
      if (role.prefix !== undefined && !/^#u8\($/i.test(role.prefix)) invalid(node, path, "Invalid bytevector prefix.");
      item.prefix = role.prefix || "#u8(";
    }
    if (hasEntries(item.kind)) {
      if (node.value() !== label(item)) invalid(node, path, "A container must retain its structural label.");
      item.entries = [];
      if (sourceLines && !whitespace(role.trailing)) invalid(node, path, "Invalid container trailing whitespace.");
      item.trailing = sourceLines ? role.trailing : "";
      let row = child(node, Direction.INWARD);
      while (row) {
        if (direct) {
          let form = row;
          let column = 0;
          while (form) {
            const i = item.entries.length;
            const entryPath = `${path}[${i}]`;
            const next = {};
            next.value = value(form, item, next, i, entryPath, depth + 1, column === 0);
            if ((column > 0 && hasNewline(next.leading)) || (column === 0 && i > 0 && !hasNewline(next.leading))) {
              invalid(form, entryPath, "Source row grouping disagrees with its line separators.");
            }
            item.entries.push(next);
            column++;
            form = child(form, Direction.FORWARD);
          }
          row = child(row, Direction.DOWNWARD);
          continue;
        }
        if (sourceLines) {
          visit(row, [Direction.DOWNWARD, Direction.FORWARD], path, "line");
          if (row.value() !== undefined && row.value() !== null) invalid(row, path, "A line bud must be empty.");
          if (!child(row, Direction.FORWARD)) invalid(row, path, "A source row must contain a form.");
        }
        let bud = sourceLines ? child(row, Direction.FORWARD) : row;
        let column = 0;
        while (bud) {
          const i = item.entries.length;
          const entryPath = `${path}[${i}]`;
          const entryRole = visit(bud, [Direction.DOWNWARD, Direction.FORWARD], entryPath, "entry");
          if (bud.value() !== undefined && bud.value() !== null) invalid(bud, entryPath, "An organizing bud must be empty.");
          const leading = sourceLines ? entryRole.leading : i ? "\n" : item.kind === "dotted-tail" ? " " : "";
          if (!whitespace(leading)) invalid(bud, entryPath, "Invalid form leading whitespace.");
          if (sourceLines && ((column > 0 && hasNewline(leading)) || (column === 0 && i > 0 && !hasNewline(leading)))) {
            invalid(bud, entryPath, "Source row grouping disagrees with its line separators.");
          }
          const next = { budId: bud.id(), leading, ...(sourceLines ? { lineId: row.id() } : {}) };
          next.value = value(child(bud, sourceLines ? Direction.DOWNWARD : Direction.FORWARD), item, next, i, entryPath, depth + 1);
          item.entries.push(next);
          contexts.set(bud.id(), contexts.get(next.value.id));
          if (sourceLines && !column) contexts.set(row.id(), contexts.get(next.value.id));
          column++;
          bud = sourceLines ? child(bud, Direction.FORWARD) : null;
        }
        row = child(row, Direction.DOWNWARD);
      }
      if (!sourceLines && item.entries.length && endsInLineComment(item.entries.at(-1).value)) item.trailing = "\n";
    } else {
      if (child(node, Direction.INWARD)) invalid(node, path, "A scalar cannot contain child forms.");
      if (item.kind === "slot") {
        if (node.value() !== "[value]") invalid(node, path, "A value slot must retain its placeholder.");
      } else {
        if (typeof node.value() !== "string") invalid(node, path, "A literal must contain source text.");
        item.text = node.value();
      }
    }
    return item;
  };
  const tree = value(root, null, null, -1, "$", 0);
  if (tree.kind !== "document") invalid(root, "$", "The root must be a Scheme document.");
  for (const node of graphNodes(root)) {
    if (!seen.has(node.id())) invalid(node, "$", "The graph contains undeclared Scheme content.");
  }
  for (const id of Object.keys(metadata.nodes)) {
    if (!seen.has(id)) invalid({ id }, "$", "The draft contains a role for a missing graph node.");
  }
  return { tree, contexts, physical };
}

function collectIssues(tree) {
  const issues = [];
  let slotCount = 0;
  const issue = (item, path, message, unfinished = false) => {
    issues.push({ nodeId: item.id, path, message });
    if (unfinished) slotCount++;
  };
  const visit = (item, parent, index, path) => {
    if (item.kind === "slot") issue(item, path, "Choose a datum for this slot.", true);
    if (LISP_SCALARS.includes(item.kind)) {
      const problem = lispScalarProblem(item.kind, item.text);
      if (problem) issue(item, path, problem, true);
    }
    if (parent?.kind === "bytevector" && !isLispComment(item) && item.kind !== "slot" &&
        (item.kind !== "number" || !isSchemeByte(item.text))) {
      issue(item, path, "A bytevector requires exact integers from 0 to 255.");
    }
    if (WRAPPERS.includes(item.kind)) {
      if (item.entries.filter(({ value }) => !isLispComment(value)).length !== 1) {
        issue(item, path, "This prefix requires exactly one datum.");
      }
      if (item.kind === "dotted-tail" && (parent?.kind !== "list" || index !== parent.entries.length - 1 ||
          !parent.entries.slice(0, index).some(({ value }) => !isLispComment(value)))) {
        issue(item, path, "A dotted tail must end a list after at least one datum.");
      }
    }
    item.entries?.forEach((current, i) => {
      const previous = item.entries[i - 1]?.value;
      if (previous && endsInLineComment(previous) && !hasNewline(current.leading)) {
        issue(current.value, `${path}[${i}]`, "A line comment requires a newline before the following form.");
      } else if (!current.leading && needsLeadingSpace(item, current, i)) {
        issue(current.value, `${path}[${i}]`, "These source tokens require a separating space.");
      }
    });
    if (["list", "vector", "bytevector"].includes(item.kind) && item.entries.length &&
        endsInLineComment(item.entries.at(-1).value) && !hasNewline(item.trailing)) {
      issue(item, path, "A final line comment requires a newline before the closing parenthesis.");
    }
    item.entries?.forEach(({ value }, i) => visit(value, item, i, `${path}[${i}]`));
  };
  visit(tree, null, -1, "$");
  return { validStructure: true, complete: issues.length === 0, issues, slotCount };
}

export function structuredLispStatus(root) {
  try { return collectIssues(decode(root).tree); }
  catch (error) { return { validStructure: false, complete: false, slotCount: 0,
    issues: error.issues || [{ nodeId: root?.id?.(), path: "$", message: error.message }] }; }
}

export function isLispSlotNode(root, node) {
  const metadata = metadataOf(root);
  const role = node && metadata?.version === 1 && record(metadata.nodes) && own(metadata.nodes, node.id())
    ? metadata.nodes[node.id()] : null;
  if (!record(role)) return false;
  if (role.kind === "slot") return true;
  if (!LISP_SCALARS.includes(role.kind)) return false;
  const text = node.value();
  const cached = slotHints.get(node);
  if (cached?.kind === role.kind && cached.text === text) return cached.unfinished;
  const unfinished = typeof text !== "string" || Boolean(lispScalarProblem(role.kind, text));
  slotHints.set(node, { kind: role.kind, text, unfinished });
  return unfinished;
}

function build(tree, previousRoot, selected, repairSpacing = true) {
  if (repairSpacing) prepareSpacing(tree);
  const previous = documentState(previousRoot);
  const previousMetadata = metadataOf(previousRoot);
  const previousNodes = previousRoot ? graphNodes(previousRoot) : [];
  const relativeScales = new Map();
  if (previousRoot) {
    // A form's physical parent may be a sibling. Measure size relative to its
    // semantic container so splitting, joining, or moving rows cannot shrink
    // the following forms accidentally. Each ancestor is visited only once.
    const absoluteScales = new Map();
    const absoluteScale = (node) => {
      const path = [];
      let cursor = node;
      while (cursor && !absoluteScales.has(cursor)) {
        path.push(cursor);
        cursor = cursor.neighbors().isRoot() ? null : cursor.neighbors().parentNode();
      }
      let scale = cursor ? absoluteScales.get(cursor) : 1;
      while (path.length) {
        const current = path.pop();
        scale *= current.scale();
        absoluteScales.set(current, scale);
      }
      return absoluteScales.get(node);
    };
    const decoded = decode(previousRoot);
    for (const [id, context] of decoded.contexts) {
      if (context.value.id !== id) continue;
      relativeScales.set(id, absoluteScale(decoded.physical.get(id)) /
        (context.parent ? absoluteScale(decoded.physical.get(context.parent.id)) : 1));
    }
  }
  const reserved = new Set(Object.keys(previousMetadata?.nodes || {}));
  const nodes = {};
  const physical = new Map();
  const absoluteScales = new Map();
  let nextId = 0;
  const create = (item, role, text) => {
    if (!item.id) {
      do { item.id = `scheme-${++nextId}`; } while (reserved.has(item.id));
      reserved.add(item.id);
    }
    if (own(nodes, item.id)) throw new Error("Scheme: duplicate node identity.");
    const node = new DirectionNode(text);
    node.setId(item.id);
    Object.defineProperty(nodes, item.id, { value: role, enumerable: true, configurable: true, writable: true });
    physical.set(item.id, node);
    return node;
  };
  const value = (item, depth = 0, parentScale = 1, leading) => {
    if (depth > MAX_LISP_DEPTH) throw new Error("Scheme: supported nesting depth exceeded.");
    const node = create(item, { kind: item.kind, ...(item.prefix ? { prefix: item.prefix } : {}),
      ...(leading !== undefined ? { leading } : {}),
      ...(item.entries ? { trailing: item.trailing } : {}) }, label(item));
    const absoluteScale = parentScale * (relativeScales.get(item.id) ?? (depth ? SHRINK_SCALE : 1));
    absoluteScales.set(node, absoluteScale);
    node.setNodeFit(Fit.EXACT);
    if (item.entries) {
      let previousLine;
      const forms = [];
      for (const row of sourceRows(item.entries)) {
        let firstForm;
        let previousForm;
        for (const itemEntry of row) {
          const form = value(itemEntry.value, depth + 1, absoluteScale, itemEntry.leading);
          let connectionParent;
          if (previousForm) {
            connectionParent = previousForm;
            previousForm.connect(Direction.FORWARD, form);
            previousForm.neighbors().align(Direction.FORWARD, Alignment.NONE);
          } else if (previousLine) {
            connectionParent = previousLine;
            previousLine.connect(Direction.DOWNWARD, form);
          } else {
            connectionParent = node;
            node.connect(Direction.INWARD, form);
            new DirectionCaret(node).shrink(Direction.INWARD);
            form.paintGroups().crease();
          }
          form.setScale(absoluteScales.get(form) / absoluteScales.get(connectionParent));
          firstForm ||= form;
          forms.push(form); previousForm = form;
        }
        previousLine = firstForm;
      }
      forms.forEach((form) => {
        const caret = new DirectionCaret(form);
        caret.pull(Direction.FORWARD); caret.loosen();
      });
    }
    return node;
  };
  const root = value(tree);
  root.setScale(absoluteScales.get(root));
  for (const before of previousNodes) {
    const after = physical.get(before.id());
    if (!after) continue;
    after.setNodeFit(before.nodeFit()); after.setBidi(before.bidi());
    // Old form nodes had no planar children: their unused planar defaults must
    // not override the row pull and clearance supplied by the removed buds.
    if (previousMetadata.layout === DIRECT_SOURCE_LINES) {
      if (before.neighbors().parentDirection() !== after.neighbors().parentDirection()) {
        after.siblings().pull(before.siblings().layoutOrder().find((direction) => PLANAR.includes(direction)));
      } else after.siblings().setLayoutPreference(before.siblings().getLayoutPreference());
      PLANAR.forEach((direction) => after.setSeparationFit(direction, before.separationFit(direction)));
    }
    const focus = before.focusDirections();
    if (focus !== undefined) after.setFocus(...focus.filter((direction) => direction !== after.neighbors().parentDirection()));
    for (const direction of DIRECTIONS) {
      const oldChild = child(before, direction);
      const newChild = child(after, direction);
      // Removing organizing buds retains the same semantic INWARD boundary.
      const migratedInward = previousMetadata.layout !== DIRECT_SOURCE_LINES && direction === Direction.INWARD;
      if (oldChild && newChild && (oldChild.id() === newChild.id() || migratedInward)) {
        after.neighbors().align(direction, before.neighbors().getAlignment(direction));
        after.neighbors().setAxisOverlap(direction, before.neighbors().axisOverlap(direction));
      }
    }
    if (!after.neighbors().isRoot()) {
      if (!before.neighbors().isRoot() && before.paintGroups().isPaintGroup()) after.paintGroups().crease();
      else if (after.paintGroups().isPaintGroup() &&
          before.neighbors().parentDirection() === after.neighbors().parentDirection()) after.paintGroups().uncrease();
    }
  }
  const metadata = clone(previous?.metadata || {});
  metadata.freeform = { ...(record(metadata.freeform) ? metadata.freeform : {}),
    structuredLisp: { version: 1, layout: DIRECT_SOURCE_LINES, innerScale: SHRINK_SCALE, nodes } };
  Object.defineProperty(root, DOCUMENT_STATE, { configurable: true, value: {
    ignoredCapabilities: [], hasUnsupportedContent: false, ...previous,
    version: CURRENT_DOCUMENT_VERSION,
    sourceVersion: previous?.sourceVersion ?? CURRENT_DOCUMENT_VERSION,
    root, capabilities: clone(previous?.capabilities || {}), metadata,
  } });
  normalizeGraph(root);
  return { root, selectedNode: physical.get(selected?.id) || root };
}

export function createStructuredLisp(source) { return build(readLisp(source)).root; }
export function createLispDraft() { return build({ kind: "document", entries: [entry()] }).root; }

function sourceInputResult(root, tree, changed, repairSpacing = false) {
  // While typing, a final comment may not have its terminating newline yet.
  // Repairing that boundary on every keystroke would persist an extra newline
  // before the user supplies their own. Finalization repairs boundaries once.
  const rebuilt = build(tree, root, changed.selected, repairSpacing);
  return {
    ...rebuilt,
    state: changed.created && {
      nodeId: rebuilt.selectedNode.id(),
      created: changed.created.map(({ value, ...pending }) => ({ id: value.id, ...pending })),
    },
    text: changed.text,
    caret: changed.caret,
  };
}

export function beginLispSourceInput(root, selectedNode, options) {
  const decoded = decode(root);
  return sourceInputResult(root, decoded.tree,
    beginSourceInput(decoded.tree, selection(decoded, selectedNode).value, options));
}

export function editLispSourceInput(root, state, text, caret) {
  const decoded = decode(root);
  return sourceInputResult(root, decoded.tree,
    editSourceInput(decoded.tree, state, text, caret));
}

export function finishLispSourceInput(root, state) {
  const decoded = decode(root);
  return sourceInputResult(root, decoded.tree,
    finishSourceInput(decoded.tree, state), true);
}

/** Upgrade older editor drafts without interpreting or rewriting their source. */
export function upgradeLispLayout(root, selectedNodeOrId) {
  if (!isStructuredLisp(root) || metadataOf(root)?.layout === DIRECT_SOURCE_LINES) {
    const selectedNode = typeof selectedNodeOrId?.id === "function" ? selectedNodeOrId
      : ["string", "number"].includes(typeof selectedNodeOrId)
        ? graphNodes(root).find((node) => String(node.id()) === String(selectedNodeOrId))
        : null;
    return { root, selectedNode: selectedNode || root };
  }
  const decoded = decode(root);
  const id = typeof selectedNodeOrId === "string" ? selectedNodeOrId : selectedNodeOrId?.id?.();
  return build(decoded.tree, root, decoded.contexts.get(id)?.value || decoded.tree, false);
}

function selection(decoded, node) {
  const id = typeof node === "string" ? node : node?.id?.();
  const context = decoded.contexts.get(id ?? decoded.tree.id);
  if (!context) throw new Error("Scheme: select a node in this document.");
  return context;
}
const allowedKinds = (parent) => parent?.kind === "bytevector"
  ? ["number", "comment", "block-comment", "datum-comment", "slot"] : REPLACE_KINDS;

export function lispKeyboardTarget(root, node, action) {
  const decoded = decode(root);
  const { value, parent, index } = selection(decoded, node);
  let target;
  if (action === "enter" || action === "value") target = value.entries?.find(({ value }) => !isLispComment(value))?.value || value.entries?.[0]?.value;
  else if (action === "container") target = parent;
  else if (action === "next" || action === "previous") target = parent?.entries[index + (action === "next" ? 1 : -1)]?.value;
  else if (action === "up" || action === "down") {
    const rows = sourceRows(parent?.entries || []);
    const rowIndex = rows.findIndex((row) => row.some((item) => item.value.id === value.id));
    const column = rows[rowIndex]?.findIndex((item) => item.value.id === value.id);
    const next = rows[rowIndex + (action === "down" ? 1 : -1)];
    target = next?.[Math.min(column, next.length - 1)]?.value;
  }
  else throw new Error(`Scheme: unknown navigation action ${action}.`);
  return target ? decoded.physical.get(target.id) : null;
}

export function inspectLispSelection(root, node) {
  const { value, parent, index, path } = selection(decode(root), node);
  const rootNode = value.kind === "document";
  const tail = value.kind === "dotted-tail";
  const list = value.kind === "list" ? value : parent?.kind === "list" ? parent : null;
  const tailIndex = list?.entries.findIndex(({ value }) => value.kind === "dotted-tail") ?? -1;
  const replacement = allowedKinds(parent);
  const wrapKinds = parent?.kind === "bytevector" ? ["datum-comment"] : WRAP_KINDS;
  const startsLine = Boolean(parent && index > 0 && hasNewline(parent.entries[index].leading));
  return {
    nodeId: value.id, kind: value.kind, label: value.kind === "slot" ? "Value slot" : value.kind.replaceAll("-", " "),
    text: value.text ?? "", expected: value.kind === "slot" ? (parent?.kind === "bytevector" ? "byte" : "datum") : value.kind,
    path, entryCount: value.entries?.length ?? null, parentId: parent?.id ?? null, parentKind: parent?.kind ?? null,
    keyNodeId: null, valueNodeId: value.entries?.find(({ value }) => !isLispComment(value))?.value.id ?? value.id,
    previousNodeId: parent?.entries[index - 1]?.value.id ?? null, nextNodeId: parent?.entries[index + 1]?.value.id ?? null,
    isSlot: value.kind === "slot" || (LISP_SCALARS.includes(value.kind) && Boolean(lispScalarProblem(value.kind, value.text))),
    canEdit: value.kind === "slot" || LISP_SCALARS.includes(value.kind),
    canAdd: LISP_CONTAINERS.includes(value.kind),
    canInsertSibling: Boolean(rootNode || (parent && LISP_CONTAINERS.includes(parent.kind))),
    canRemove: Boolean(parent), removeAction: !parent || (WRAPPERS.includes(parent.kind) && !isLispComment(value)) ? "clear" : "remove",
    canMoveEarlier: Boolean(parent && index > 0 && !tail),
    canMoveLater: Boolean(parent && index + 1 < parent.entries.length && !tail && parent.entries[index + 1].value.kind !== "dotted-tail"),
    canWrap: !rootNode && !tail && !isLispComment(value), canClear: value.kind !== "slot" && !tail,
    canReplace: !rootNode && !tail, canPaste: !tail,
    allowedKinds: replacement, wrapKinds,
    canAddTail: value.kind === "list" && tailIndex < 0,
    canRemoveTail: tail || (value.kind === "list" && tailIndex >= 0),
    canBreakLine: Boolean(parent && index > 0), startsLine,
    canJoinLine: Boolean(parent && index > 0 && !endsInLineComment(parent.entries[index - 1].value)),
  };
}

function replacement(kind, text) {
  if (!REPLACE_KINDS.includes(kind)) throw new Error("Scheme: unsupported replacement type.");
  if (text !== undefined && (typeof text !== "string" || !LISP_SCALARS.includes(kind))) throw new Error("Scheme: only literals accept source text.");
  if (LISP_CONTAINERS.includes(kind)) return { kind, entries: [] };
  if (WRAPPERS.includes(kind)) return { kind, entries: [entry()] };
  if (kind === "slot") return slot();
  return { kind, text: text ?? { symbol: "name", string: '""', number: "0", boolean: "#f", character: "#\\space", comment: ";", "block-comment": "#||#" }[kind] };
}

export function applyLispCommand(root, selectedNode, command) {
  const decoded = decode(root);
  const context = selection(decoded, selectedNode);
  const { value, parent, entry: selectedEntry, index } = context;
  const tree = decoded.tree;
  let selected = value;
  const replace = (next) => {
    if (!parent || value.kind === "dotted-tail") throw new Error("Scheme: this structural node cannot be replaced.");
    if (!allowedKinds(parent).includes(next.kind)) throw new Error("Scheme: this container does not accept that datum type.");
    next.id = value.id; selectedEntry.value = next; selected = next;
  };
  const insertionIndex = (container) => {
    const tail = container.entries.findIndex(({ value }) => value.kind === "dotted-tail");
    return tail < 0 ? container.entries.length : tail;
  };
  switch (command.type) {
    case "setText":
      if (typeof command.text !== "string") throw new Error("Scheme: literal text must be a string.");
      if (value.kind === "slot") replace(replacement(parent?.kind === "bytevector" ? "number" : "symbol", command.text));
      else if (LISP_SCALARS.includes(value.kind)) value.text = command.text;
      else throw new Error("Scheme: choose a literal to edit its source.");
      break;
    case "replace": replace(replacement(command.kind, command.text)); break;
    case "add": {
      if (!LISP_CONTAINERS.includes(value.kind)) throw new Error("Scheme: select a container to add a form.");
      const destination = insertionIndex(value);
      const added = entry(slot(), destination ? " " : "");
      value.entries.splice(destination, 0, added); selected = added.value;
      break;
    }
    case "insertSibling": {
      const offset = command.offset ?? 1;
      if (![-1, 1].includes(offset)) throw new Error("Scheme: insert before or after a form.");
      const container = parent || value;
      if (!LISP_CONTAINERS.includes(container.kind)) throw new Error("Scheme: a prefix has one operand; insert beside the prefix instead.");
      let destination = parent ? index + (offset === 1 ? 1 : 0) : offset === 1 ? insertionIndex(container) : 0;
      destination = Math.min(destination, insertionIndex(container));
      const added = entry(slot(), command.newline ? newlineFor(container) : destination ? " " : "");
      container.entries.splice(destination, 0, added); selected = added.value;
      break;
    }
    case "remove":
      if (!parent) throw new Error("Scheme: the document root cannot be removed.");
      if (WRAPPERS.includes(parent.kind) && !isLispComment(value)) replace(slot());
      else { removeEntry(parent, index); selected = parent.entries[index]?.value || parent; }
      break;
    case "move": {
      const destination = index + command.offset;
      if (!parent || ![-1, 1].includes(command.offset) || destination < 0 || destination >= parent.entries.length ||
          value.kind === "dotted-tail" || parent.entries[destination].value.kind === "dotted-tail") throw new Error("Scheme: this form cannot move in that direction.");
      const leading = parent.entries.map((item) => item.leading);
      parent.entries.splice(index, 1); parent.entries.splice(destination, 0, selectedEntry);
      parent.entries.forEach((item, i) => { item.leading = leading[i]; });
      break;
    }
    case "wrap": {
      const allowed = parent?.kind === "bytevector" ? ["datum-comment"] : WRAP_KINDS;
      if (!parent || value.kind === "dotted-tail" || isLispComment(value) || !allowed.includes(command.kind)) throw new Error("Scheme: choose a supported wrapper for this datum.");
      const wrapped = { kind: command.kind, entries: [entry(value)] };
      selectedEntry.value = wrapped; selected = wrapped;
      break;
    }
    case "clear":
      if (!parent) { value.entries = []; value.trailing = ""; }
      else replace(slot());
      break;
    case "paste": {
      const parsed = readLisp(command.text);
      if (!parent) { value.entries = parsed.entries; value.trailing = parsed.trailing; selected = value; }
      else {
        if (parsed.entries.length !== 1) throw new Error("Scheme: paste one form here, or select the document to replace all forms.");
        replace(parsed.entries[0].value);
      }
      break;
    }
    case "addTail": {
      if (value.kind !== "list" || value.entries.some(({ value }) => value.kind === "dotted-tail")) throw new Error("Scheme: select a list without a dotted tail.");
      const tail = { kind: "dotted-tail", entries: [entry()] };
      value.entries.push(entry(tail, value.entries.length ? " " : "")); selected = tail.entries[0].value;
      break;
    }
    case "removeTail": {
      const list = value.kind === "list" ? value : value.kind === "dotted-tail" ? parent : null;
      const tailIndex = list?.entries.findIndex(({ value }) => value.kind === "dotted-tail") ?? -1;
      if (tailIndex < 0) throw new Error("Scheme: select a list or its dotted tail.");
      removeEntry(list, tailIndex); selected = list;
      break;
    }
    case "setLineBreak": {
      if (!parent || index < 1 || typeof command.enabled !== "boolean") throw new Error("Scheme: choose a form with a preceding sibling.");
      if (!command.enabled && endsInLineComment(parent.entries[index - 1].value)) throw new Error("Scheme: a line comment requires the following form on a new line.");
      if (command.enabled && !hasNewline(selectedEntry.leading)) selectedEntry.leading = newlineFor(parent) + selectedEntry.leading;
      if (!command.enabled && hasNewline(selectedEntry.leading)) selectedEntry.leading = " ";
      break;
    }
    default: throw new Error(`Scheme: unknown editing command ${command.type}.`);
  }
  return build(tree, root, selected);
}

export function exportStructuredLisp(root) {
  const { tree } = decode(root);
  const status = collectIssues(tree);
  if (!status.complete) {
    const error = new Error(`Scheme: ${status.issues[0].path}: ${status.issues[0].message} Save a Parsegraph draft to retain unfinished slots.`);
    error.issues = status.issues; throw error;
  }
  const value = (item) => {
    if (!item.entries) return item.text;
    const contents = item.entries.map(({ value: child, leading }) => leading + value(child)).join("") + item.trailing;
    if (item.kind === "document") return contents;
    if (WRAPPERS.includes(item.kind)) return LISP_PREFIXES[item.kind] + contents;
    return (item.kind === "list" ? "(" : item.kind === "vector" ? "#(" : item.prefix || "#u8(") + contents + ")";
  };
  return value(tree);
}
