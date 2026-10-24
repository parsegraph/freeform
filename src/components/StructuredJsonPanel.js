import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { inspectJsonSelection, structuredJsonStatus } from "../structuredJson";
import { jsonKindCssVariables } from "../structuredJsonAppearance";
import "./StructuredJsonPanel.css";

const VALUE_KINDS = ["string", "number", "boolean", "null", "object", "array"];
const title = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function inspect(root, selectedNode) {
  try {
    return { selection: inspectJsonSelection(root, selectedNode) };
  } catch (error) {
    return { error: error.message };
  }
}

/** A format-aware editor; the graph remains the document and commands own mutations. */
export default function StructuredJsonPanel({
  root,
  selectedNode,
  onCommand,
  onSelect,
  onSaveDraft,
  onExportJson,
  recoveryMessage,
  onEditValue,
  onFinishEditing,
}) {
  const inspection = useMemo(
    () => inspect(root, selectedNode),
    [root, selectedNode]
  );
  const selection = inspection.selection;
  const status = useMemo(() => {
    try {
      return structuredJsonStatus(root);
    } catch (error) {
      return {
        complete: false,
        slotCount: 0,
        issues: [{ message: error.message }],
      };
    }
  }, [root]);
  const [error, setError] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const nodeId = selection?.nodeId;
  const sourceText = selection?.text ?? "";
  const drafts = useRef(new Map());
  const [edit, setEdit] = useState(() => ({
    nodeId,
    text: sourceText,
    dirty: false,
  }));
  const editRef = useRef(edit);

  const updateEdit = useCallback((next) => {
    editRef.current = next;
    setEdit(next);
  }, []);

  const commit = useCallback(
    (pending = editRef.current, force = false) => {
      if (!pending.nodeId || (!pending.dirty && !force)) return true;
      try {
        const result = onCommand(
          { type: "setText", text: pending.text },
          pending.nodeId
        );
        if (result === false)
          throw new Error(
            "The edit could not be applied. Your text is still here."
          );
        pending.dirty = false;
        drafts.current.delete(pending.nodeId);
        if (editRef.current.nodeId === pending.nodeId)
          updateEdit({ ...pending });
        setError(null);
        return true;
      } catch (failure) {
        drafts.current.set(pending.nodeId, { ...pending });
        setError(failure.message);
        return false;
      }
    },
    [onCommand, updateEdit]
  );

  // A graph click can change selection before an input's blur event arrives.
  // Commit against the original node ID, never against the new selection.
  useLayoutEffect(() => {
    const previous = editRef.current;
    if (previous.nodeId !== nodeId) {
      commit(previous);
      updateEdit(
        drafts.current.get(nodeId) ?? { nodeId, text: sourceText, dirty: false }
      );
    } else if (!previous.dirty && previous.text !== sourceText) {
      updateEdit({ nodeId, text: sourceText, dirty: false });
    }
  }, [nodeId, sourceText, commit, updateEdit]);

  const run = (action) => {
    if (!commit()) return false;
    try {
      if (action() === false) return false;
      setError(null);
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    }
  };
  const command = (value) => run(() => onCommand(value));
  const changeText = (event) => {
    const next = { nodeId, text: event.target.value, dirty: true };
    drafts.current.set(nodeId, next);
    updateEdit(next);
    // Unfinished tokens are document content, including while this field has
    // focus. Recovery and Undo must capture them without waiting for blur.
    commit(next);
  };
  const finishTextEdit = (element) => {
    if (!commit(editRef.current, selection?.kind === "key" && selection.isSlot))
      return;
    element?.blur();
    onFinishEditing?.();
  };
  const handleTextKeyDown = (event) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent?.isComposing ||
      event.keyCode === 229
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    finishTextEdit(event.currentTarget);
  };
  const valueButtons = (
    <div className="structured-json-types">
      {VALUE_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className="structured-json-type"
          style={jsonKindCssVariables(kind)}
          onClick={() => command({ type: "replace", kind })}
        >
          {title(kind)}
        </button>
      ))}
    </div>
  );

  return (
    <aside
      className="structured-json-panel"
      aria-label="JSON editor"
      onKeyDown={(event) => {
        if (
          event.target.matches("input, textarea, select") &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          event.stopPropagation();
        }
      }}
    >
      <details open>
        <summary>
          JSON document
          <span
            className={
              status.complete
                ? "structured-json-ready"
                : "structured-json-unfinished"
            }
          >
            {status.complete ? "Ready" : "Draft"}
          </span>
        </summary>
        <div className="structured-json-body">
          <p className="structured-json-hint">
            Slots keep unfinished work. Save draft preserves them; JSON export
            requires complete values.
          </p>
          {recoveryMessage && (
            <p role="status" className="structured-json-recovery">
              {recoveryMessage}
            </p>
          )}
          <div className="structured-json-actions">
            <button type="button" onClick={() => run(onSaveDraft)}>
              Save draft
            </button>
            <button
              type="button"
              disabled={!status.complete || edit.dirty}
              onClick={() => run(onExportJson)}
            >
              Export JSON
            </button>
          </div>

          <details className="structured-json-section structured-json-keyboard">
            <summary>Keyboard controls</summary>
            <dl>
              <dt><kbd>,</kbd></dt>
              <dd>Add a member/item after this entry.</dd>
              <dt><kbd>i</kbd> / <kbd>e</kbd></dt>
              <dd>Enter a container; create its first entry if empty.</dd>
              <dt><kbd>:</kbd></dt>
              <dd>Go from a key to its value (also <kbd>i</kbd> / <kbd>e</kbd>).</dd>
              <dt><kbd>]</kbd> / <kbd>{"}"}</kbd></dt>
              <dd>Go to the containing object/array (also <kbd>o</kbd> / <kbd>q</kbd>).</dd>
              <dt><kbd>h j k l</kbd><br /><kbd>w a s d</kbd></dt>
              <dd>Follow connections. At a dead end, down/up follows the next/previous entry.</dd>
              <dt><kbd>Enter</kbd></dt>
              <dd>Edit a key/value, or finish editing.</dd>
              <dt><kbd>x</kbd> / <kbd>Backspace</kbd></dt>
              <dd>Remove the entry or clear a required value to a slot.</dd>
              <dt><kbd>u</kbd> / <kbd>z</kbd><br /><kbd>y</kbd> / <kbd>R</kbd></dt>
              <dd>Undo / redo.</dd>
            </dl>
            <p className="structured-json-hint">
              At an empty value slot: <kbd>{'"'}</kbd> starts a string;
              {" "}<kbd>[</kbd> an array; <kbd>{"{"}</kbd> an object;
              {" "}<kbd>0–9</kbd> / <kbd>-</kbd> a number;
              {" "}<kbd>t</kbd> / <kbd>f</kbd> / <kbd>n</kbd> true / false / null.
            </p>
            <p className="structured-json-hint">
              Comma on the root object/array appends inside it. Textboxes keep
              punctuation as text; Ctrl/⌘/Alt shortcuts keep their usual behavior.
              In View mode, select a node first; arrows also follow connections.
              Escape returns to panning.
            </p>
          </details>

          {selection && (
            <section
              className="structured-json-selection"
              aria-label="Selected structure"
            >
              <div className="structured-json-selection-heading">
                <strong
                  className="structured-json-type-badge"
                  style={jsonKindCssVariables(
                    selection.isSlot ? "slot" : selection.kind
                  )}
                >
                  {selection.kind === "key"
                    ? "Member key"
                    : title(selection.kind)}
                </strong>
                {selection.isSlot && (
                  <span
                    className="structured-json-slot-badge"
                    style={jsonKindCssVariables("slot")}
                  >
                    Slot
                  </span>
                )}
              </div>
              {selection.path && (
                <code className="structured-json-path">{selection.path}</code>
              )}
              {selection.kind === "slot" && (
                <div className="structured-json-slot">
                  <p>Choose a value for this slot.</p>
                  {valueButtons}
                </div>
              )}
              {selection.canEdit && selection.kind !== "boolean" && (
                <form
                  className="structured-json-field"
                  onSubmit={(event) => {
                    event.preventDefault();
                    finishTextEdit(
                      event.currentTarget.querySelector("input, textarea")
                    );
                  }}
                >
                  <label htmlFor="structured-json-text">
                    {selection.kind === "key" ? "Key" : title(selection.kind)}
                  </label>
                  {selection.kind === "string" ? (
                    <textarea
                      id="structured-json-text"
                      value={edit.text}
                      onChange={changeText}
                      onKeyDown={handleTextKeyDown}
                      onBlur={() => commit()}
                      rows={3}
                      spellCheck={false}
                    />
                  ) : (
                    <input
                      id="structured-json-text"
                      type="text"
                      inputMode={
                        selection.kind === "number" ? "decimal" : "text"
                      }
                      value={edit.text}
                      onChange={changeText}
                      onKeyDown={handleTextKeyDown}
                      onBlur={() => commit()}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  )}
                  {selection.kind === "number" && (
                    <small>Unfinished numbers are kept as slots.</small>
                  )}
                  {selection.kind === "key" && selection.isSlot && (
                    <small>
                      Apply an empty key to use the valid JSON key "".
                    </small>
                  )}
                  <small>
                    Enter finishes editing. Shift+Enter adds a line in strings.
                  </small>
                  <button type="submit">Apply</button>
                  {onEditValue && (
                    <button
                      type="button"
                      onClick={() => run(() => onEditValue(nodeId))}
                    >
                      Edit in graph
                    </button>
                  )}
                </form>
              )}
              {selection.kind === "boolean" && (
                <div
                  className="structured-json-actions"
                  aria-label="Boolean value"
                >
                  {["true", "false"].map((text) => (
                    <button
                      key={text}
                      type="button"
                      className="structured-json-type"
                      style={jsonKindCssVariables("boolean")}
                      aria-pressed={sourceText === text}
                      onClick={() => command({ type: "setText", text })}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              )}
              {selection.canAdd && (
                <button
                  className="structured-json-add"
                  type="button"
                  onClick={() => command({ type: "add" })}
                >
                  {selection.kind === "object" ? "Add member" : "Add item"}
                </button>
              )}
              <div className="structured-json-actions">
                {selection.canMoveEarlier && (
                  <button
                    type="button"
                    onClick={() => command({ type: "move", offset: -1 })}
                  >
                    Move earlier
                  </button>
                )}
                {selection.canMoveLater && (
                  <button
                    type="button"
                    onClick={() => command({ type: "move", offset: 1 })}
                  >
                    Move later
                  </button>
                )}
                {selection.canRemove && (
                  <button
                    type="button"
                    onClick={() => command({ type: "remove" })}
                  >
                    Remove entry
                  </button>
                )}
                {selection.canClear && (
                  <button
                    type="button"
                    onClick={() => command({ type: "clear" })}
                  >
                    Clear to slot
                  </button>
                )}
              </div>
              {selection.canWrap && (
                <div className="structured-json-actions">
                  <button
                    type="button"
                    onClick={() => command({ type: "wrap", kind: "array" })}
                  >
                    Wrap in array
                  </button>
                  <button
                    type="button"
                    onClick={() => command({ type: "wrap", kind: "object" })}
                  >
                    Wrap in object
                  </button>
                </div>
              )}
              {selection.canReplace && selection.kind !== "slot" && (
                <details className="structured-json-section">
                  <summary>Replace value</summary>
                  <p className="structured-json-hint">
                    Replaces this value and its contents. Undo can restore them.
                  </p>
                  {valueButtons}
                </details>
              )}
              {selection.canPaste && (
                <details className="structured-json-section">
                  <summary>Paste JSON value</summary>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (command({ type: "paste", text: pasteText }))
                        setPasteText("");
                    }}
                  >
                    <label htmlFor="structured-json-paste">
                      JSON to place here
                    </label>
                    <textarea
                      id="structured-json-paste"
                      rows={4}
                      value={pasteText}
                      onChange={(event) => setPasteText(event.target.value)}
                      spellCheck={false}
                    />
                    <button type="submit" disabled={!pasteText.trim()}>
                      Replace with pasted value
                    </button>
                  </form>
                </details>
              )}
            </section>
          )}
          {(error || inspection.error) && (
            <p role="alert" className="structured-json-error">
              {error || inspection.error}
            </p>
          )}
          {status.issues.length > 0 && (
            <section
              className="structured-json-diagnostics"
              aria-label="Unfinished content"
            >
              <strong>
                {status.slotCount > 0
                  ? `${status.slotCount} unfinished ${
                      status.slotCount === 1 ? "slot" : "slots"
                    }`
                  : "Needs attention"}
              </strong>
              <ul>
                {status.issues.slice(0, 8).map((issue, index) => (
                  <li key={`${issue.nodeId ?? "document"}-${index}`}>
                    {issue.nodeId ? (
                      <button
                        type="button"
                        onClick={() => run(() => onSelect(issue.nodeId))}
                      >
                        {issue.path && <code>{issue.path}: </code>}
                        {issue.message}
                      </button>
                    ) : (
                      issue.message
                    )}
                  </li>
                ))}
              </ul>
              {status.issues.length > 8 && (
                <small>And {status.issues.length - 8} more.</small>
              )}
            </section>
          )}
        </div>
      </details>
    </aside>
  );
}
