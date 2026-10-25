import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { inspectLispSelection, structuredLispStatus } from "../structuredLisp";
import { lispKindCssVariables } from "../structuredLispAppearance";
import "./StructuredJsonPanel.css";

const VALUE_KINDS = [
  "symbol",
  "string",
  "number",
  "boolean",
  "character",
  "list",
  "vector",
  "bytevector",
  "comment",
  "block-comment",
];
const WRAPPER_KINDS = [
  "list",
  "vector",
  "quote",
  "quasiquote",
  "unquote",
  "unquote-splicing",
  "datum-comment",
];
const title = (kind) =>
  ({
    comment: "Line comment",
    "block-comment": "Block comment",
    "datum-comment": "Datum comment",
    "dotted-tail": "Dotted tail",
    "unquote-splicing": "Unquote splicing",
  }[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1));

function inspect(root, selectedNode) {
  try {
    return { selection: inspectLispSelection(root, selectedNode) };
  } catch (error) {
    return { error: error.message };
  }
}

export default function StructuredLispPanel({
  root,
  selectedNode,
  onCommand,
  onSelect,
  onSaveDraft,
  onExportLisp,
  recoveryMessage,
  onEditValue,
  onTypeSource,
  onFinishEditing,
}) {
  const inspection = useMemo(
    () => inspect(root, selectedNode),
    [root, selectedNode]
  );
  const selection = inspection.selection;
  const status = useMemo(() => {
    try {
      return structuredLispStatus(root);
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
    (pending = editRef.current) => {
      if (!pending.nodeId || !pending.dirty) return true;
      try {
        if (
          onCommand({ type: "setText", text: pending.text }, pending.nodeId) ===
          false
        )
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

  // Retain failed input and commit to its original node when selection changes.
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
    // A failed edit may belong to a node selected earlier. Do not save or
    // mutate the document while that source text exists only in this panel.
    for (const pending of [...drafts.current.values()]) {
      if (!commit(pending)) return false;
    }
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
  const command = (action) => run(() => onCommand(action));
  const changeText = (event) => {
    const next = { nodeId, text: event.target.value, dirty: true };
    drafts.current.set(nodeId, next);
    updateEdit(next);
    // Partial source tokens belong in recovery and undo even before blur.
    commit(next);
  };
  const finishTextEdit = (element) => {
    if (!commit()) return;
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
      {VALUE_KINDS.filter(
        (kind) =>
          !selection?.allowedKinds || selection.allowedKinds.includes(kind)
      ).map((kind) => (
        <button
          key={kind}
          type="button"
          className="structured-json-type"
          style={lispKindCssVariables(kind)}
          onClick={() => command({ type: "replace", kind })}
        >
          {title(kind)}
        </button>
      ))}
    </div>
  );

  return (
    <aside
      className="structured-json-panel structured-lisp-panel"
      aria-label="Lisp/Scheme editor"
      onKeyDown={(event) => {
        if (
          event.target.matches("input, textarea, select") &&
          !event.metaKey &&
          !event.ctrlKey
        )
          event.stopPropagation();
      }}
    >
      <div className="structured-json-document-heading">
        <span>Lisp/Scheme document</span>
        <span
          className={
            status.complete
              ? "structured-json-ready"
              : "structured-json-unfinished"
          }
        >
          {status.complete ? "Ready" : "Draft"}
        </span>
      </div>
      <div className="structured-json-body">
        {selection && (
          <section
            className="structured-json-selection"
            aria-label="Selected structure"
          >
            <div className="structured-json-selection-heading">
              <strong
                className="structured-json-type-badge"
                style={lispKindCssVariables(
                  selection.isSlot ? "slot" : selection.kind
                )}
              >
                {title(selection.kind)}
              </strong>
              {selection.isSlot && (
                <span
                  className="structured-json-slot-badge"
                  style={lispKindCssVariables("slot")}
                >
                  Slot
                </span>
              )}
            </div>
            {selection.path && (
              <code className="structured-json-path">{selection.path}</code>
            )}
            {selection.entryCount !== null &&
              selection.entryCount !== undefined && (
                <p className="structured-json-hint">
                  {selection.entryCount}{" "}
                  {selection.entryCount === 1 ? "form" : "forms"}
                  {selection.kind === "bytevector"
                    ? " · Exact integers from 0 to 255"
                    : ""}
                </p>
              )}
            {selection.kind === "slot" && (
              <div className="structured-json-slot">
                <p>Choose a form for this slot.</p>
                {valueButtons}
              </div>
            )}
            {selection.canEdit && (
              <form
                className="structured-json-field"
                onSubmit={(event) => {
                  event.preventDefault();
                  finishTextEdit(
                    event.currentTarget.querySelector("input, textarea")
                  );
                }}
              >
                <label htmlFor="structured-lisp-text">
                  {title(selection.kind)}
                </label>
                <textarea
                  id="structured-lisp-text"
                  value={edit.text}
                  onChange={changeText}
                  onKeyDown={handleTextKeyDown}
                  onBlur={() => commit()}
                  rows={
                    ["string", "block-comment"].includes(selection.kind) ? 3 : 1
                  }
                  spellCheck={false}
                  autoComplete="off"
                />
                <small>
                  Write the source token, including string quotes or comment
                  markers. Unfinished tokens stay in the draft.
                </small>
                <small>Enter finishes editing. Shift+Enter adds a line.</small>
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
            {selection.canAdd && (
              <button
                className="structured-json-add"
                type="button"
                onClick={() => command({ type: "add" })}
              >
                {selection.kind === "document" ? "Add form" : "Add item"}
              </button>
            )}
            <div className="structured-json-actions">
              {onTypeSource && (
                <button type="button" onClick={() => run(onTypeSource)}>
                  Type source (i)
                </button>
              )}
              {selection.canInsertSibling && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      command({ type: "insertSibling", offset: -1 })
                    }
                  >
                    Insert before
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      command({ type: "insertSibling", offset: 1 })
                    }
                  >
                    Insert after
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      command({ type: "insertSibling", newline: true })
                    }
                  >
                    Insert on new line
                  </button>
                </>
              )}
              {selection.canBreakLine && (
                <button
                  type="button"
                  disabled={selection.startsLine && !selection.canJoinLine}
                  onClick={() =>
                    command({
                      type: "setLineBreak",
                      enabled: !selection.startsLine,
                    })
                  }
                >
                  {selection.startsLine
                    ? "Join previous line"
                    : "Start new line"}
                </button>
              )}
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
                  {selection.kind === "document"
                    ? "Clear document"
                    : "Clear to slot"}
                </button>
              )}
              {selection.canAddTail && (
                <button
                  type="button"
                  onClick={() => command({ type: "addTail" })}
                >
                  Add dotted tail
                </button>
              )}
              {selection.canRemoveTail && (
                <button
                  type="button"
                  onClick={() => command({ type: "removeTail" })}
                >
                  Remove dotted tail
                </button>
              )}
            </div>
            {selection.canWrap && (
              <details className="structured-json-section">
                <summary>Wrap form</summary>
                <div className="structured-json-types">
                  {WRAPPER_KINDS.filter(
                    (kind) =>
                      !selection.wrapKinds || selection.wrapKinds.includes(kind)
                  ).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="structured-json-type"
                      style={lispKindCssVariables(kind)}
                      onClick={() => command({ type: "wrap", kind })}
                    >
                      {title(kind)}
                    </button>
                  ))}
                </div>
              </details>
            )}
            {selection.canReplace && selection.kind !== "slot" && (
              <details className="structured-json-section">
                <summary>Replace form</summary>
                <p className="structured-json-hint">
                  Replaces this form and its contents. Undo can restore them.
                </p>
                {valueButtons}
              </details>
            )}
            {selection.canPaste && (
              <details className="structured-json-section">
                <summary>Paste Lisp/Scheme source</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (command({ type: "paste", text: pasteText }))
                      setPasteText("");
                  }}
                >
                  <label htmlFor="structured-lisp-paste">
                    Source to place here
                  </label>
                  <textarea
                    id="structured-lisp-paste"
                    rows={4}
                    value={pasteText}
                    onChange={(event) => setPasteText(event.target.value)}
                    spellCheck={false}
                  />
                  <button type="submit" disabled={!pasteText.trim()}>
                    Replace with pasted source
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
        <section
          className="structured-json-document-actions"
          aria-label="Document actions"
        >
          <p className="structured-json-hint">
            Save a draft to keep unfinished slots. Export Lisp/Scheme when every
            form is complete.
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
              disabled={
                !status.complete || edit.dirty || drafts.current.size > 0
              }
              onClick={() => run(onExportLisp)}
            >
              Export Lisp/Scheme
            </button>
          </div>
        </section>
        <details className="structured-json-section structured-json-keyboard">
          <summary>Keyboard controls</summary>
          <dl>
            <dt>
              <kbd>Space</kbd>
            </dt>
            <dd>Insert a form after this entry on the same line.</dd>
            <dt>
              <kbd>Shift+Enter</kbd>
            </dt>
            <dd>Insert a form on the next line.</dd>
            <dt>
              <kbd>(</kbd> / <kbd>)</kbd>
            </dt>
            <dd>Start or wrap a list / go to its containing form.</dd>
            <dt>
              <kbd>i</kbd> / <kbd>Escape</kbd>
            </dt>
            <dd>Type source / return to graph navigation.</dd>
            <dt>
              <kbd>c</kbd>
            </dt>
            <dd>Replace the selected token and start inserting.</dd>
            <dt>
              <kbd>o</kbd> / <kbd>O</kbd>
            </dt>
            <dd>Open a source line below / above and start inserting.</dd>
            <dt>
              <kbd>e</kbd>
            </dt>
            <dd>Enter a container; create its first entry if empty.</dd>
            <dt>
              <kbd>q</kbd> / <kbd>)</kbd>
            </dt>
            <dd>Return to the containing form.</dd>
            <dt>
              <kbd>h j k l</kbd>
              <br />
              <kbd>w a s d</kbd>
            </dt>
            <dd>Move between neighboring forms and source lines.</dd>
            <dt>
              <kbd>Enter</kbd>
            </dt>
            <dd>Edit a source token, or finish editing.</dd>
            <dt>
              <kbd>x</kbd> / <kbd>Backspace</kbd>
            </dt>
            <dd>Remove the entry or clear a required form to a slot.</dd>
            <dt>
              <kbd>u</kbd> / <kbd>z</kbd>
              <br />
              <kbd>y</kbd> / <kbd>R</kbd>
            </dt>
            <dd>Undo / redo. Each source insert session is one step.</dd>
          </dl>
          <p className="structured-json-hint">
            <kbd>'</kbd>, <kbd>`</kbd>, <kbd>,</kbd>, and <kbd>@</kbd> begin
            quote, quasiquote, unquote, and unquote splicing. They fill a slot
            or wrap the selected form. Comma is a Lisp prefix, not insertion.
          </p>
          <p className="structured-json-hint">
            In insert mode, type spaces, newlines, and parentheses to build the
            graph. Raw token fields keep punctuation as text. In View mode, select a
            node to navigate; Escape returns to panning.
          </p>
        </details>
      </div>
    </aside>
  );
}
