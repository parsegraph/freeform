import { useEffect, useRef } from "react";

export function EditorDialog({ children, onClose, label }) {
  const ref = useRef();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const surface = ref.current;
    const previous = document.activeElement;
    const background = [
      ...document.querySelectorAll(
        ".editor-header, .editor-workspace, .editor-statusbar"
      ),
    ];
    background.forEach((element) => element.setAttribute("inert", ""));
    const focusable = () =>
      [
        ...surface.querySelectorAll(
          'button:not(:disabled), input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
        ),
      ].filter((element) => !element.closest("[hidden]"));
    const first = () => (focusable()[0] || surface).focus();
    first();
    const keydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
      }
      if (event.key === "Tab") {
        const elements = focusable();
        const index = elements.indexOf(document.activeElement);
        if (
          !elements.length ||
          (event.shiftKey
            ? index <= 0
            : index === elements.length - 1 || index === -1)
        ) {
          event.preventDefault();
          (
            elements[event.shiftKey ? elements.length - 1 : 0] || surface
          ).focus();
        }
      }
    };
    const focusin = (event) => {
      if (!surface.contains(event.target)) first();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      background.forEach((element) => element.removeAttribute("inert"));
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else document.getElementById("parsegraph")?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        ref={ref}
        tabIndex={-1}
        role={label ? "dialog" : undefined}
        aria-modal={label ? true : undefined}
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

// Small, shared line icons keep the editor controls visually consistent.
export function EditorIcon({ name, ...props }) {
  const paths = {
    open: "M3 7h6l2 2h10l-3 11H3V7Zm0 0V4h7l2 3h7v2",
    save: "M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-8h8v8",
    undo: "m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3",
    redo: "m16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v3",
    fit: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 8h8v8H8Z",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    close: "m6 6 12 12M6 18 18 6",
    sliders: "M4 7h5m5 0h6M4 17h10m5 0h1M9 4v6m5 4v6",
    chevron: "m9 5 7 7-7 7",
  };
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.fit} />
    </svg>
  );
}

export function EditorHeader({
  hasDocument,
  name,
  modified,
  structured,
  language = "JSON",
  editing,
  onMode,
  onOpen,
  onSave,
  onUndo,
  onRedo,
  undoCount,
  redoCount,
}) {
  return (
    <header className="editor-header">
      <a className="editor-brand" href="/" aria-label="Parsegraph home">
        <svg
          viewBox="0 0 32 32"
          width="30"
          height="30"
          fill="none"
          aria-hidden="true"
        >
          <path d="M10 9v15m0-8h13" stroke="currentColor" strokeWidth="1.5" />
          <rect x="4" y="3" width="12" height="9" rx="3" fill="currentColor" />
          <rect
            x="20"
            y="12"
            width="8"
            height="8"
            rx="2.5"
            fill="currentColor"
            opacity=".5"
          />
          <circle cx="10" cy="25" r="4" fill="currentColor" opacity=".5" />
        </svg>
        <span>
          freeform<span className="editor-brand-byline">PARSEGRAPH</span>
        </span>
      </a>
      <div className="document-identity">
        <span className="document-kind">
          {hasDocument
            ? structured
              ? `${language} DOCUMENT`
              : "GRAPH DOCUMENT"
            : "GRAPH EDITOR"}
        </span>
        <h1 title={hasDocument ? name : undefined}>
          {hasDocument ? name : "A little space to think."}
        </h1>
        {hasDocument && (
          <span
            className={`document-save-state ${modified ? "is-modified" : ""}`}
          >
            <span aria-hidden="true" />
            {modified ? "Unsaved changes" : "No unsaved changes"}
          </span>
        )}
      </div>
      {hasDocument && (
        <nav className="document-toolbar" aria-label="Document actions">
          <div className="history-actions">
            <button
              type="button"
              className="icon-button"
              aria-label="Undo"
              title={`Undo (${undoCount})`}
              disabled={!undoCount}
              onClick={onUndo}
            >
              <EditorIcon name="undo" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Redo"
              title={`Redo (${redoCount})`}
              disabled={!redoCount}
              onClick={onRedo}
            >
              <EditorIcon name="redo" />
            </button>
          </div>
          <div className="editor-mode" aria-label="Editor mode">
            <button
              type="button"
              aria-pressed={!editing}
              onClick={() => onMode(false)}
            >
              View
            </button>
            <button
              type="button"
              aria-pressed={editing}
              onClick={() => onMode(true)}
            >
              Edit
            </button>
          </div>
          <button
            type="button"
            className="toolbar-open"
            aria-label="Open"
            title="Open document"
            onClick={onOpen}
          >
            <EditorIcon name="open" />
            <span>Open</span>
          </button>
          <button
            type="button"
            className="primary-button toolbar-save"
            aria-label="Save"
            title="Save a copy"
            onClick={onSave}
          >
            <EditorIcon name="save" />
            <span>Save</span>
          </button>
        </nav>
      )}
    </header>
  );
}
