import { Alignment, Direction, DirectionNode, Fit } from "parsegraph";
import { documentState, graphNodes } from "./graphDocument";

// The graph stores content and order; metadata supplies its language roles.
// The temporary tree used by commands is decoded afresh, never saved separately.
const DOCUMENT_STATE = Symbol.for("parsegraph.freeform.document");
const KINDS = [
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "null",
  "slot",
];
const DIRECTIONS = Object.values(Direction).filter(
  (value) => typeof value === "number"
);
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const copy = (value) => JSON.parse(JSON.stringify(value));
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const metadataOf = (root) =>
  documentState(root)?.metadata?.freeform?.structuredJson;

export function isStructuredJson(root) {
  return metadataOf(root) !== undefined;
}

function invalid(node, path, message) {
  const issue = {
    nodeId: typeof node?.id === "function" ? node.id() : node?.id ?? null,
    path,
    message,
  };
  const error = new Error(`JSON: ${path}: ${message}`);
  error.issues = [issue];
  throw error;
}

function child(node, direction) {
  return node.neighbors().hasChild(direction)
    ? node.neighbors().nodeAt(direction)
    : null;
}

function decode(root) {
  const metadata = metadataOf(root);
  if (!record(metadata) || metadata.version !== 1 || !record(metadata.nodes)) {
    invalid(
      root,
      "$",
      "Unsupported or missing structured JSON draft metadata."
    );
  }
  const seen = new Set();
  const contexts = new Map();
  const physical = new Map();
  const visit = (node, allowed, path, expectedKind) => {
    if (!node) invalid(root, path, "The graph is missing a required node.");
    const id = node.id();
    if (typeof id !== "string" || seen.has(id) || !own(metadata.nodes, id)) {
      invalid(
        node,
        path,
        "Every JSON graph node needs a unique, declared role."
      );
    }
    const role = metadata.nodes[id];
    if (
      !record(role) ||
      typeof role.kind !== "string" ||
      (expectedKind && role.kind !== expectedKind)
    ) {
      invalid(node, path, `Expected ${expectedKind || "a JSON"} node role.`);
    }
    seen.add(id);
    physical.set(id, node);
    for (const direction of DIRECTIONS) {
      if (child(node, direction) && !allowed.includes(direction)) {
        invalid(
          node,
          path,
          "Unexpected connection; the graph no longer follows its JSON structure."
        );
      }
    }
    return role;
  };
  const readString = (node, path) => {
    try {
      const value = JSON.parse(node.value());
      if (typeof value !== "string") throw new Error();
      return value;
    } catch (error) {
      invalid(node, path, "String content must be a quoted JSON string.");
    }
  };
  const value = (node, path, parent, entry, index, depth = 0) => {
    if (depth > 1000)
      invalid(node, path, "This draft exceeds the supported nesting depth.");
    const declared = node && metadata.nodes[node.id()];
    const container = declared?.kind === "object" || declared?.kind === "array";
    const role = visit(node, container ? [Direction.INWARD] : [], path);
    if (!KINDS.includes(role.kind))
      invalid(node, path, `Unknown value kind ${role.kind}.`);
    const result = { id: node.id(), kind: role.kind };
    contexts.set(result.id, {
      type: "value",
      value: result,
      parent,
      entry,
      index,
      path,
    });
    if (container) {
      const label = role.kind === "object" ? "{}" : "[]";
      if (node.value() !== label)
        invalid(node, path, `The ${role.kind} label must be ${label}.`);
      result.entries = [];
      let bud = child(node, Direction.INWARD);
      while (bud) {
        const nextIndex = result.entries.length;
        const entryPath = `${path}[${nextIndex}]`;
        visit(bud, [Direction.DOWNWARD, Direction.FORWARD], entryPath, "entry");
        if (bud.value() !== undefined && bud.value() !== "")
          invalid(bud, entryPath, "List buds must be empty.");
        const nextEntry = { budId: bud.id() };
        const prong = child(bud, Direction.FORWARD);
        if (role.kind === "object") {
          const keyRole = visit(prong, [Direction.DOWNWARD], entryPath, "key");
          if (
            keyRole.missing !== undefined &&
            typeof keyRole.missing !== "boolean"
          ) {
            invalid(prong, entryPath, "Invalid key-slot metadata.");
          }
          if (keyRole.missing && prong.value() !== "[key]")
            invalid(
              prong,
              entryPath,
              "A key slot must retain its placeholder."
            );
          nextEntry.key = {
            id: prong.id(),
            kind: "key",
            missing: Boolean(keyRole.missing),
            text: keyRole.missing ? "" : readString(prong, entryPath),
          };
          const keyPath = keyRole.missing
            ? `${path}[member ${nextIndex + 1}]`
            : `${path}[${JSON.stringify(nextEntry.key.text)}]`;
          contexts.set(prong.id(), {
            type: "key",
            value: nextEntry.key,
            parent: result,
            entry: nextEntry,
            index: nextIndex,
            path: `${keyPath}.key`,
          });
          nextEntry.value = value(
            child(prong, Direction.DOWNWARD),
            keyPath,
            result,
            nextEntry,
            nextIndex,
            depth + 1
          );
        } else {
          nextEntry.value = value(
            prong,
            entryPath,
            result,
            nextEntry,
            nextIndex,
            depth + 1
          );
        }
        contexts.set(
          bud.id(),
          contexts.get(nextEntry.key?.id ?? nextEntry.value.id)
        );
        result.entries.push(nextEntry);
        bud = child(bud, Direction.DOWNWARD);
      }
    } else if (role.kind === "string") {
      result.text = readString(node, path);
    } else if (role.kind === "slot") {
      if (role.expected !== undefined && role.expected !== "value")
        invalid(node, path, "Unsupported slot type.");
      if (node.value() !== "[value]")
        invalid(node, path, "A value slot must retain its placeholder.");
      result.expected = "value";
    } else {
      if (typeof node.value() !== "string")
        invalid(node, path, "Scalar content must be text.");
      result.text = node.value();
    }
    return result;
  };
  const tree = value(root, "$", null, null, -1);
  for (const node of graphNodes(root)) {
    if (!seen.has(node.id()))
      invalid(
        node,
        "$",
        "The graph contains content outside the JSON structure."
      );
  }
  for (const id of Object.keys(metadata.nodes)) {
    if (!seen.has(id))
      invalid(
        { id },
        "$",
        "The draft contains a role for a missing graph node."
      );
  }
  return { tree, contexts, physical };
}

function numeric(text) {
  return NUMBER.test(text) && Number.isFinite(Number(text));
}

/** Per-node paint hint with no graph walk; full validation belongs to commands. */
export function isJsonSlotNode(root, node) {
  const metadata = metadataOf(root);
  if (!node || metadata?.version !== 1 || !record(metadata.nodes)) return false;
  const role = own(metadata.nodes, node.id())
    ? metadata.nodes[node.id()]
    : null;
  if (!record(role)) return false;
  switch (role.kind) {
    case "slot":
      return true;
    case "key":
      return role.missing === true;
    case "number":
      return typeof node.value() !== "string" || !numeric(node.value());
    case "boolean":
      return !["true", "false"].includes(node.value());
    default:
      return false;
  }
}

function collectIssues(tree) {
  const issues = [];
  let slotCount = 0;
  const issue = (value, path, message, slot = false) => {
    issues.push({ nodeId: value.id, path, message });
    if (slot) slotCount++;
  };
  const visit = (value, path) => {
    if (value.kind === "slot")
      issue(value, path, "Choose a value for this slot.", true);
    if (value.kind === "number" && !numeric(value.text))
      issue(value, path, "Finish entering a finite JSON number.", true);
    if (value.kind === "boolean" && !["true", "false"].includes(value.text))
      issue(value, path, "Choose true or false.", true);
    if (value.kind === "null" && value.text !== "null")
      issue(value, path, "A null value must contain null.");
    if (value.kind === "object") {
      const keys = new Set();
      value.entries.forEach((entry, index) => {
        const key = entry.key;
        const entryPath = key.missing
          ? `${path}[member ${index + 1}]`
          : `${path}[${JSON.stringify(key.text)}]`;
        if (key.missing)
          issue(key, `${entryPath}.key`, "Name this member's key slot.", true);
        else if (keys.has(key.text))
          issue(
            key,
            `${entryPath}.key`,
            `Duplicate key ${JSON.stringify(
              key.text
            )} would lose a member during export.`
          );
        else keys.add(key.text);
        visit(entry.value, entryPath);
      });
    } else if (value.kind === "array") {
      value.entries.forEach((entry, index) =>
        visit(entry.value, `${path}[${index}]`)
      );
    }
  };
  visit(tree, "$");
  return {
    validStructure: true,
    complete: issues.length === 0,
    issues,
    slotCount,
  };
}

export function structuredJsonStatus(root) {
  try {
    return collectIssues(decode(root).tree);
  } catch (error) {
    return {
      validStructure: false,
      complete: false,
      issues: error.issues ?? [
        { nodeId: root?.id?.(), path: "$", message: error.message },
      ],
      slotCount: 0,
    };
  }
}

function build(tree, previousRoot, selected) {
  const previous = documentState(previousRoot);
  const reserved = new Set(Object.keys(metadataOf(previousRoot)?.nodes ?? {}));
  const nodes = {};
  const physical = new Map();
  let nextId = 0;
  const create = (item, role, label) => {
    if (!item.id) {
      do {
        item.id = `json-${++nextId}`;
      } while (reserved.has(item.id));
      reserved.add(item.id);
    }
    if (own(nodes, item.id))
      throw new Error("JSON: duplicate node identity in transaction.");
    const node = new DirectionNode(label);
    node.setId(item.id);
    Object.defineProperty(nodes, item.id, {
      value: role,
      enumerable: true,
      writable: true,
      configurable: true,
    });
    physical.set(item.id, node);
    return node;
  };
  const value = (item) => {
    const container = item.kind === "object" || item.kind === "array";
    const label =
      item.kind === "object"
        ? "{}"
        : item.kind === "array"
        ? "[]"
        : item.kind === "slot"
        ? "[value]"
        : item.kind === "string"
        ? JSON.stringify(item.text)
        : item.text;
    const node = create(
      item,
      {
        kind: item.kind,
        ...(item.kind === "slot" ? { expected: "value" } : {}),
      },
      label
    );
    if (container) {
      let previousBud;
      const buds = [];
      for (const entry of item.entries) {
        const budIdentity = { id: entry.budId };
        const bud = create(budIdentity, { kind: "entry" });
        entry.budId = budIdentity.id;
        if (previousBud) previousBud.connect(Direction.DOWNWARD, bud);
        else {
          node.connect(Direction.INWARD, bud);
          bud.paintGroups().crease();
        }
        let prong;
        if (item.kind === "object") {
          prong = create(
            entry.key,
            { kind: "key", ...(entry.key.missing ? { missing: true } : {}) },
            entry.key.missing ? "[key]" : JSON.stringify(entry.key.text)
          );
          prong.connect(Direction.DOWNWARD, value(entry.value));
          prong.siblings().pull(Direction.DOWNWARD);
        } else prong = value(entry.value);
        bud.connect(Direction.FORWARD, prong);
        bud.neighbors().align(Direction.FORWARD, Alignment.CENTER);
        bud.setNodeFit(Fit.EXACT);
        buds.push(bud);
        previousBud = bud;
      }
      // Set pulls after the complete spine exists, so siblings do not override it.
      buds.forEach((bud) => bud.siblings().pull(Direction.FORWARD));
    }
    return node;
  };
  const root = value(tree);
  // Semantic edits must not undo the user's independent visual adjustments.
  // Preserve edge settings only when the same parent/child pair still occupies
  // that direction; new and reordered connections use the grammar's defaults.
  if (previousRoot) {
    for (const before of graphNodes(previousRoot)) {
      const after = physical.get(before.id());
      if (!after) continue;
      after.setScale(before.scale());
      after.setNodeFit(before.nodeFit());
      after.setRightToLeft(before.rightToLeft());
      after
        .siblings()
        .setLayoutPreference(before.siblings().getLayoutPreference());
      for (const direction of DIRECTIONS) {
        const oldChild = child(before, direction);
        const newChild = child(after, direction);
        if (oldChild && newChild && oldChild.id() === newChild.id()) {
          after
            .neighbors()
            .align(direction, before.neighbors().getAlignment(direction));
          after
            .neighbors()
            .setAxisOverlap(
              direction,
              before.neighbors().axisOverlap(direction)
            );
        }
      }
      if (!after.neighbors().isRoot()) {
        if (!before.neighbors().isRoot() && before.paintGroups().isPaintGroup())
          after.paintGroups().crease();
        else after.paintGroups().uncrease();
      }
    }
  }
  const metadata = copy(previous?.metadata ?? {});
  metadata.freeform = {
    ...(record(metadata.freeform) ? metadata.freeform : {}),
    structuredJson: { version: 1, nodes },
  };
  Object.defineProperty(root, DOCUMENT_STATE, {
    configurable: true,
    value: {
      ignoredCapabilities: [],
      hasUnsupportedContent: false,
      ...previous,
      version: 1,
      root,
      capabilities: copy(previous?.capabilities ?? {}),
      metadata,
    },
  });
  return { root, selectedNode: physical.get(selected?.id) ?? root };
}

function fromValue(value, depth = 0) {
  if (depth > 1000)
    throw new Error("JSON: this document exceeds the supported nesting depth.");
  if (value === null) return { kind: "null", text: "null" };
  if (Array.isArray(value))
    return {
      kind: "array",
      entries: value.map((entry) => ({ value: fromValue(entry, depth + 1) })),
    };
  switch (typeof value) {
    case "object":
      return {
        kind: "object",
        entries: Object.keys(value).map((key) => ({
          key: { kind: "key", text: key, missing: false },
          value: fromValue(value[key], depth + 1),
        })),
      };
    case "string":
      return { kind: "string", text: value };
    case "number":
      if (!Number.isFinite(value))
        throw new Error("JSON: numbers must be finite.");
      return { kind: "number", text: JSON.stringify(value) };
    case "boolean":
      return { kind: "boolean", text: String(value) };
    default:
      throw new Error(`JSON: unsupported value ${typeof value}.`);
  }
}

export function createStructuredJson(value) {
  return build(fromValue(value)).root;
}

const slot = () => ({ kind: "slot", expected: "value" });
const newEntry = (kind, value = slot()) => ({
  ...(kind === "object"
    ? { key: { kind: "key", text: "", missing: true } }
    : {}),
  value,
});

export function createJsonDraft() {
  return build({ kind: "object", entries: [newEntry("object")] }).root;
}

function selection(decoded, node) {
  const id = typeof node === "string" ? node : node?.id?.();
  const context = decoded.contexts.get(id ?? decoded.tree.id);
  if (!context) throw new Error("JSON: select a node in this document.");
  return context;
}

const entryTarget = (entry) => entry?.key ?? entry?.value ?? null;

/** Resolve document relationships without making callers walk layout buds. */
export function jsonKeyboardTarget(root, node, action) {
  const decoded = decode(root);
  const { value, parent, entry, index } = selection(decoded, node);
  const container = value.kind === "object" || value.kind === "array";
  let target;
  switch (action) {
    case "enter":
      target = container
        ? entryTarget(value.entries[0])
        : value.kind === "key"
        ? entry.value
        : null;
      break;
    case "value":
      target = entry?.value;
      break;
    case "container":
      target = parent ?? (container ? value : null);
      break;
    case "next":
    case "previous":
      target = entryTarget(
        parent?.entries[index + (action === "next" ? 1 : -1)]
      );
      break;
    default:
      throw new Error(`JSON: unknown navigation action ${action}.`);
  }
  return target ? decoded.physical.get(target.id) : null;
}

export function inspectJsonSelection(root, node) {
  const decoded = decode(root);
  const context = selection(decoded, node);
  const { value, parent, entry, index, path } = context;
  const key = value.kind === "key";
  const container = value.kind === "object" || value.kind === "array";
  return {
    nodeId: value.id,
    kind: value.kind,
    label: key
      ? "Member key"
      : value.kind === "slot"
      ? "Value slot"
      : `${value.kind[0].toUpperCase()}${value.kind.slice(1)}`,
    text: value.text ?? "",
    expected: key ? "key" : value.kind === "slot" ? "value" : value.kind,
    path,
    entryCount: container ? value.entries.length : null,
    parentId: parent?.id ?? null,
    parentKind: parent?.kind ?? null,
    keyNodeId: entry?.key?.id ?? null,
    valueNodeId: entry?.value?.id ?? null,
    previousNodeId: entryTarget(parent?.entries[index - 1])?.id ?? null,
    nextNodeId: entryTarget(parent?.entries[index + 1])?.id ?? null,
    isSlot: Boolean(
      value.missing ||
        value.kind === "slot" ||
        (value.kind === "number" && !numeric(value.text)) ||
        (value.kind === "boolean" && !["true", "false"].includes(value.text))
    ),
    canEdit: ["key", "string", "number", "boolean"].includes(value.kind),
    canAdd: container,
    canInsertSibling: Boolean(parent || container),
    canRemove: Boolean(parent),
    removeAction:
      !parent || (context.type === "value" && parent.kind === "object")
        ? "clear"
        : "remove",
    canMoveEarlier: Boolean(parent && index > 0),
    canMoveLater: Boolean(parent && index + 1 < parent.entries.length),
    canWrap: !key,
    canClear: !value.missing && value.kind !== "slot",
    canReplace: !key,
    canPaste: !key,
  };
}

function replaceValue(tree, context, replacement) {
  if (context.type !== "value")
    throw new Error("JSON: a member key must remain a string.");
  if (context.entry) context.entry.value = replacement;
  return context.parent ? tree : replacement;
}

export function applyJsonCommand(root, selectedNode, command) {
  const decoded = decode(root);
  const context = selection(decoded, selectedNode);
  const { value, parent, entry, index } = context;
  let tree = decoded.tree;
  let selected = value;
  switch (command.type) {
    case "setText":
      if (!["key", "string", "number", "boolean"].includes(value.kind))
        throw new Error("JSON: choose a value type before editing text.");
      if (typeof command.text !== "string")
        throw new Error("JSON: text must be a string.");
      value.text = command.text;
      if (value.kind === "key") value.missing = false;
      break;
    case "replace": {
      if (!KINDS.includes(command.kind))
        throw new Error("JSON: unsupported replacement type.");
      if (command.text !== undefined) {
        if (typeof command.text !== "string")
          throw new Error("JSON: text must be a string.");
        if (!["string", "number", "boolean"].includes(command.kind))
          throw new Error("JSON: only scalar text values accept initial text.");
      }
      const replacement =
        command.kind === "slot"
          ? slot()
          : fromValue(
              {
                string: "",
                number: 0,
                boolean: false,
                null: null,
                object: {},
                array: [],
              }[command.kind]
            );
      if (command.text !== undefined) replacement.text = command.text;
      replacement.id = value.id;
      tree = replaceValue(tree, context, replacement);
      selected = replacement;
      break;
    }
    case "add": {
      if (!["object", "array"].includes(value.kind))
        throw new Error("JSON: select a container to add an entry.");
      const added = newEntry(value.kind);
      value.entries.push(added);
      selected = added.key ?? added.value;
      break;
    }
    case "insertSibling": {
      const offset = command.offset ?? 1;
      if (![-1, 1].includes(offset))
        throw new Error("JSON: insert before or after the selected entry.");
      const container = parent ?? value;
      if (!["object", "array"].includes(container.kind))
        throw new Error(
          "JSON: select an entry or a container to insert a slot."
        );
      const destination = parent
        ? index + (offset === 1 ? 1 : 0)
        : offset === 1
        ? container.entries.length
        : 0;
      const added = newEntry(container.kind);
      container.entries.splice(destination, 0, added);
      selected = entryTarget(added);
      break;
    }
    case "remove":
      if (!parent)
        throw new Error(
          "JSON: the root cannot be removed; clear it to a slot instead."
        );
      parent.entries.splice(index, 1);
      selected =
        parent.entries[index]?.key ?? parent.entries[index]?.value ?? parent;
      break;
    case "move": {
      const destination = index + command.offset;
      if (
        !parent ||
        ![-1, 1].includes(command.offset) ||
        destination < 0 ||
        destination >= parent.entries.length
      )
        throw new Error("JSON: this entry cannot move in that direction.");
      parent.entries.splice(index, 1);
      parent.entries.splice(destination, 0, entry);
      break;
    }
    case "wrap": {
      if (!["object", "array"].includes(command.kind))
        throw new Error("JSON: wrap in an object or an array.");
      const wrapped = newEntry(command.kind, value);
      const replacement = { kind: command.kind, entries: [wrapped] };
      tree = replaceValue(tree, context, replacement);
      selected = wrapped.key ?? replacement;
      break;
    }
    case "clear":
      if (value.kind === "key") {
        value.text = "";
        value.missing = true;
      } else {
        const replacement = { ...slot(), id: value.id };
        tree = replaceValue(tree, context, replacement);
        selected = replacement;
      }
      break;
    case "paste": {
      if (typeof command.text !== "string")
        throw new Error("JSON: paste source text.");
      let parsed;
      try {
        parsed = JSON.parse(command.text);
      } catch (error) {
        throw new Error(
          `JSON: pasted text is incomplete or invalid (${error.message}).`
        );
      }
      const replacement = { ...fromValue(parsed), id: value.id };
      tree = replaceValue(tree, context, replacement);
      selected = replacement;
      break;
    }
    default:
      throw new Error(`JSON: unknown editing command ${command.type}.`);
  }
  return build(tree, root, selected);
}

export function exportStructuredJson(root) {
  const { tree } = decode(root);
  const status = collectIssues(tree);
  if (!status.complete) {
    const error = new Error(
      `JSON: ${status.issues[0].path}: ${status.issues[0].message} Save a Parsegraph draft to retain unfinished slots.`
    );
    error.issues = status.issues;
    throw error;
  }
  const value = (item) => {
    switch (item.kind) {
      case "array":
        return item.entries.map((entry) => value(entry.value));
      case "object": {
        const object = {};
        item.entries.forEach((entry) =>
          Object.defineProperty(object, entry.key.text, {
            value: value(entry.value),
            enumerable: true,
            writable: true,
            configurable: true,
          })
        );
        return object;
      }
      case "string":
        return item.text;
      default:
        return JSON.parse(item.text);
    }
  };
  return value(tree);
}
