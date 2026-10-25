import { useCallback, useEffect, useRef, useState } from "react";

import { readGraph, graphViewport, graphSelection } from "../graphDocument";
import { createJsonDraft, createStructuredJson } from "../structuredJson";

import * as importers from "../importers";

import "./modal.css";
import { createExample, loadExample } from "../examples";
import DocumentImport from "./DocumentImport";
import TemplateGallery from "./TemplateGallery";
import { templateName } from "../templateCatalog";
import { readXmlFile } from "../xmlGraph";
import {
  attachBenchmark,
  beginBenchmark,
  cancelBenchmark,
  failBenchmark,
  measureBenchmark,
  measureBenchmarkAsync,
} from "../benchmark";
import {
  HIDE_PUBLIC_SERVERS_TAB,
  MAX_ROUNDS,
  PUBLIC_SERVERS,
} from "../settings";

function ImportFromFile({ openGraph, onClose }) {
  const [importData, setImportData] = useState(null);
  const [importType, setImportType] = useState("words");
  const [importName, setImportName] = useState(null);

  const [importError, setImportError] = useState(null);
  const pendingBenchmark = useRef();
  useEffect(() => () => cancelBenchmark(pendingBenchmark.current), []);
  const performImport = useCallback(async () => {
    setImportError(null);
    let benchmark;
    try {
      if (!importData) throw new Error("Choose a file first.");
      benchmark = beginBenchmark({
        kind: "file",
        type: importType,
        name: importData.name,
        bytes: importData.size,
      });
      pendingBenchmark.current = benchmark;
      const read = (fn) =>
        measureBenchmarkAsync(benchmark, "File read and decode", fn);
      const build = (fn) =>
        attachBenchmark(
          measureBenchmark(benchmark, "Graph construction", fn),
          benchmark
        );
      const openFile = (...args) => {
        args[7] = importData.name;
        openGraph(...args);
      };
      if (importType === "png") {
        const bytes = await read(() => importData.arrayBuffer());
        openFile(build(() => importers.graphPng(new Uint8Array(bytes))));
      } else if (importType === "jpeg") {
        const bytes = await read(() => importData.arrayBuffer());
        openFile(build(() => importers.graphJpeg(bytes)));
      } else {
        const text = await read(() =>
          importType === "xml" ? readXmlFile(importData) : importData.text()
        );
        switch (importType) {
          case "words":
            openFile(build(() => importers.graphWords(text)));
            break;
          case "lisp":
            openFile(build(() => importers.graphLisp(text)));
            break;
          case "json": {
            const data = measureBenchmark(benchmark, "JSON parsing", () =>
              JSON.parse(text)
            );
            openFile(
              build(() => createStructuredJson(data)),
              null,
              null,
              undefined,
              null,
              true
            );
            break;
          }
          case "xml":
            openFile(build(() => importers.graphXml(text, benchmark)));
            break;
          case "parsegraph": {
            const data = measureBenchmark(benchmark, "JSON parsing", () =>
              JSON.parse(text)
            );
            openFile(
              build(() => readGraph(data)),
              graphSelection(data),
              null,
              graphViewport(data)
            );
            break;
          }
          case "lines":
            openFile(build(() => importers.graphLines(text)));
            break;
          default:
            throw new Error("Unsupported import type: " + importType);
        }
      }
      pendingBenchmark.current = undefined;
      onClose?.();
    } catch (ex) {
      failBenchmark(benchmark, ex);
      pendingBenchmark.current = undefined;
      setImportError(ex.message);
    }
  }, [onClose, importType, importData, openGraph]);

  const loadFiles = useCallback((e) => {
    for (const file of e.target.files) {
      setImportName(file.name);
      setImportData(file);
      switch (file.name.split(".").pop().toLowerCase()) {
        case "xml":
        case "svg":
          setImportType("xml");
          break;
        case "png":
          setImportType("png");
          break;
        case "jpg":
        case "jpeg":
          setImportType("jpeg");
          break;
        case "lisp":
          setImportType("lisp");
          break;
        case "parsegraph":
        case "graph":
          setImportType("parsegraph");
          break;
        case "json":
          if (file.name.endsWith("parsegraph.json")) {
            setImportType("parsegraph");
            break;
          }
          setImportType("json");
          break;
        case "txt":
          if (file.name.endsWith("parsegraph.txt")) {
            setImportType("parsegraph");
            break;
          }
          setImportType("lines");
          break;
        case "ini":
          setImportType("lines");
          break;
        default:
          setImportType("words");
          break;
      }
    }
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        performImport();
      }}
      className="document-form"
    >
      <p className="document-description">
        Bring a document into the canvas. Choose its format before opening it.
      </p>
      <label htmlFor="fileUpload" className="document-file-picker">
        <span className="document-file-icon" aria-hidden="true">
          ↑
        </span>
        <strong>
          {importData ? importName ?? "File selected" : "Choose file"}
        </strong>
        <span className="document-file-hint">
          Parsegraph, JSON, XML, SVG, text, or image metadata
        </span>
      </label>
      <input
        className="document-file-input"
        id="fileUpload"
        type="file"
        aria-label="Choose file"
        onChange={loadFiles}
      />
      <label className="document-field">
        Type:{" "}
        <select
          value={importType}
          onChange={(e) => setImportType(e.target.value)}
        >
          <option value="words">Words</option>
          <option value="parsegraph">Parsegraph</option>
          <option value="lines">Lines</option>
          <option value="lisp">Lisp</option>
          <option value="json">JSON</option>
          <option value="xml">XML / SVG</option>
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </select>
      </label>
      {importType === "xml" && (
        <p className="document-note">
          Preserves text and whitespace. External DOCTYPEs are kept as data;
          custom DTDs and entity declarations are unsupported.
        </p>
      )}
      {importError && <p role="alert">Could not open file: {importError}</p>}
      <div className="buttons">
        <input
          type="submit"
          className="document-primary"
          value="Import"
          disabled={!importData}
        />
        {onClose && (
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const loadRoom = (openGraph, roomName) => {
  return fetch("/public/" + roomName)
    .then((resp) => resp.json())
    .then((roomData) => {
      openGraph(
        readGraph(roomData),
        null,
        roomName,
        graphViewport(roomData),
        null,
        undefined,
        null,
        roomName
      );
    });
};

function JoinPublic({ openGraph, onClose }) {
  const [importType, setImportType] = useState("");

  const joinRoom = () => {
    loadRoom(openGraph, importType);
    if (onClose) {
      onClose();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        joinRoom();
      }}
    >
      <span
        style={{ display: "block", paddingBottom: "0.5em", fontSize: "18px" }}
      >
        {PUBLIC_SERVERS
          ? "Load a public Parsegraph."
          : "Public servers not accessible"}
      </span>
      <label style={{ display: "flex", gap: "5px" }}>
        Name:{" "}
        <input
          disabled={!PUBLIC_SERVERS}
          style={{ flexGrow: "1" }}
          value={importType}
          onChange={(e) => setImportType(e.target.value)}
        />
      </label>
      <div className="buttons">
        <input
          disabled={!PUBLIC_SERVERS || !importType}
          type="submit"
          style={{ flexGrow: "1" }}
          onClick={joinRoom}
          value="Load"
        />
        {onClose && (
          <button style={{ flexGrow: "1" }} onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ImportFromTemplate({ openGraph, onClose }) {
  const [importType, setImportType] = useState("grid");
  const [numRounds, setNumRounds] = useState(5);
  const [vertical, setVertical] = useState(false);
  const [columns, setColumns] = useState("3");
  const columnCount = Number(columns);
  const validColumns =
    columns.trim() !== "" &&
    Number.isInteger(columnCount) &&
    columnCount >= 1 &&
    columnCount <= 200;

  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [error, setError] = useState(null);
  const active = useRef(true);
  const pendingBenchmark = useRef();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      cancelBenchmark(pendingBenchmark.current);
    };
  }, []);

  const createFromTemplate = async (type = importType) => {
    if (loadingRef.current) return;
    if (type === "proportion_v1" && !validColumns) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    const example = createExample(type, {
      rounds: numRounds,
      vertical,
      ...(type === "proportion_v1" ? { columns: columnCount } : {}),
    });
    const benchmark = beginBenchmark({
      kind: "example",
      ...example,
    });
    pendingBenchmark.current = benchmark;
    try {
      const loaded = await (benchmark
        ? loadExample(example, benchmark)
        : loadExample(example));
      if (!active.current) return;
      attachBenchmark(loaded.graph, benchmark);
      pendingBenchmark.current = undefined;
      openGraph(
        loaded.graph,
        loaded.selectedNode,
        null,
        loaded.viewportData,
        loaded.example,
        undefined,
        null,
        templateName(type)
      );
      onClose?.();
    } catch (err) {
      failBenchmark(benchmark, err);
      if (active.current)
        setError("Could not load this example. Please try again.");
    } finally {
      loadingRef.current = false;
      if (active.current) setLoading(false);
    }
  };

  const selectTemplate = (type) => {
    setImportType(type);
    if (type === "march" || type === "cross") {
      const max = type === "cross" ? MAX_ROUNDS - 3 : MAX_ROUNDS;
      setNumRounds((rounds) => Math.max(1, Math.min(max, rounds)));
    }
    setError(null);
  };

  return (
    <>
      <div className="document-start-options" aria-label="New document">
        <button
          className="document-start"
          type="button"
          disabled={loading}
          aria-label="Blank graph"
          onClick={() => createFromTemplate("blank")}
        >
          <span className="document-start-icon" aria-hidden="true">
            ＋
          </span>
          <strong>Blank graph</strong>
          <span>Start with a node. Build in any direction.</span>
        </button>
        <button
          className="document-start"
          type="button"
          disabled={loading}
          aria-label="New JSON document"
          onClick={() =>
            openGraph(
              createJsonDraft(),
              null,
              null,
              undefined,
              null,
              true,
              null,
              "Untitled.json"
            )
          }
        >
          <span
            className="document-start-icon document-start-json"
            aria-hidden="true"
          >
            {"{ }"}
          </span>
          <strong>New JSON document</strong>
          <span>Build structured content with editable slots.</span>
        </button>
      </div>
      <form
        className="document-form document-examples"
        onSubmit={(e) => {
          e.preventDefault();
          createFromTemplate();
        }}
      >
        <TemplateGallery
          selected={importType}
          onSelect={selectTemplate}
          disabled={loading}
        />
        <div className="template-selection" aria-label="Selected template">
          <div className="template-selection-copy">
            <span className="template-selection-eyebrow">
              SELECTED TEMPLATE
            </span>
            <strong id="selected-template-title">
              {templateName(importType)}
            </strong>
            <p className="document-note">
              {importType === "grid"
                ? "Preview shows a smaller grid. Create opens the full example."
                : importType === "march" ||
                  importType === "cross" ||
                  importType === "proportion_v1"
                ? "Preview shows the default settings."
                : importType.startsWith("daily_planner_")
                ? "Preview shows the start of the day."
                : ["random", "alt_columns", "rainbow_random"].includes(
                    importType
                  )
                ? "Preview shows one seeded example. Each new graph can vary."
                : "Refresh restores this example and your view. Save to keep edits."}
            </p>
          </div>
          {(importType === "march" || importType === "cross") && (
            <div className="template-options">
              <label htmlFor="template-rounds">Rounds:</label>
              <input
                id="template-rounds"
                value={numRounds}
                onChange={(event) =>
                  setNumRounds(Number.parseInt(event.target.value))
                }
                type="range"
                min="1"
                max={importType === "cross" ? MAX_ROUNDS - 3 : MAX_ROUNDS}
                disabled={loading}
              />
              <output htmlFor="template-rounds">{numRounds}</output>
              {importType === "march" && (
                <label className="template-orientation">
                  <input
                    type="checkbox"
                    checked={vertical}
                    disabled={loading}
                    onChange={(event) => setVertical(event.target.checked)}
                  />
                  Vertical bracket
                </label>
              )}
            </div>
          )}
          {importType === "proportion_v1" && (
            <div className="template-column-options">
              <label id="template-columns-label" htmlFor="template-columns-slider">
                Columns
              </label>
              <input
                id="template-columns-slider"
                type="range"
                min="1"
                max="200"
                step="1"
                value={Math.max(1, Math.min(200, columnCount || 3))}
                disabled={loading}
                aria-describedby="template-columns-note"
                onChange={(event) => setColumns(event.target.value)}
              />
              <input
                id="template-columns"
                type="number"
                min="1"
                max="200"
                step="1"
                value={columns}
                disabled={loading}
                aria-labelledby="template-columns-label"
                aria-invalid={!validColumns}
                aria-describedby={`template-columns-note${
                  validColumns ? "" : " template-columns-error"
                }`}
                onChange={(event) => setColumns(event.target.value)}
              />
              <small id="template-columns-note">Columns per side</small>
              {!validColumns && (
                <p id="template-columns-error" role="alert">
                  Enter a whole number from 1 to 200.
                </p>
              )}
            </div>
          )}
          <div className="buttons template-create-actions">
            <input
              type="submit"
              className="document-primary"
              value={loading ? "Loading…" : "Create"}
              aria-describedby="selected-template-title"
              disabled={
                loading || (importType === "proportion_v1" && !validColumns)
              }
            />
            {onClose && (
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </>
  );
}

export default function ImportModal({
  onClose,
  openGraph,
  initialSession,
  initialDocument,
  onCancelDocument,
  recovery,
  recoveryError,
  onRestoreRecovery,
}) {
  const [activeTab, setActiveTab] = useState("template");
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (initialDocument != null || !initialSession) return;
    let cancelled = false;
    let handedOff = false;
    const benchmark = beginBenchmark({
      kind: "restored example",
      ...initialSession.example,
    });
    (benchmark
      ? loadExample(initialSession.example, benchmark)
      : loadExample(initialSession.example)
    )
      .then((loaded) => {
        if (cancelled) return;
        attachBenchmark(loaded.graph, benchmark);
        handedOff = true;
        const viewportData = initialSession.cam
          ? { ...loaded.viewportData, cam: initialSession.cam }
          : loaded.viewportData;
        openGraph(
          loaded.graph,
          loaded.selectedNode,
          null,
          viewportData,
          loaded.example,
          initialSession.showingUI,
          null,
          templateName(initialSession.example.type)
        );
      })
      .catch((err) => {
        failBenchmark(benchmark, err);
        if (!cancelled)
          setLoadError(
            "Could not restore the example. Choose a template or open a file."
          );
      });
    return () => {
      cancelled = true;
      if (!handedOff) cancelBenchmark(benchmark);
    };
  }, [initialSession, initialDocument, openGraph]);

  if (initialDocument != null) {
    return (
      <DocumentImport
        documentURL={initialDocument}
        openGraph={openGraph}
        onCancel={onCancelDocument}
      />
    );
  }

  if (initialSession && !loadError) {
    return (
      <div className="document-dialog document-loading" role="status">
        Loading Parsegraph…
      </div>
    );
  }

  return (
    <div
      className={`document-dialog document-chooser${
        activeTab === "template" ? " document-chooser-gallery" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-chooser-title"
    >
      <div className="document-dialog-heading">
        <div>
          <p className="document-eyebrow">PARSEGRAPH FREEFORM</p>
          <h2 id="document-chooser-title">
            {activeTab === "template"
              ? "New document"
              : activeTab === "public"
              ? "Open a shared graph"
              : "Open a document"}
          </h2>
        </div>
        {onClose && (
          <button
            className="document-close"
            type="button"
            aria-label="Close document chooser"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      {loadError && <p role="alert">{loadError}</p>}
      {recoveryError && <p role="alert">{recoveryError}</p>}
      {recovery && (
        <div className="document-recovery">
          <span>Your last JSON draft is available.</span>
          <button type="button" onClick={onRestoreRecovery}>
            Recover JSON draft
          </button>
        </div>
      )}
      <div className="tabs document-tabs" aria-label="Document source">
        <button
          className={activeTab === "template" ? "active" : null}
          aria-pressed={activeTab === "template"}
          onClick={() => {
            setActiveTab("template");
          }}
        >
          New
        </button>
        <button
          className={activeTab === "import" ? "active" : null}
          aria-pressed={activeTab === "import"}
          onClick={() => {
            setActiveTab("import");
          }}
        >
          Open
        </button>
        {(PUBLIC_SERVERS || !HIDE_PUBLIC_SERVERS_TAB) && (
          <button
            className={activeTab === "public" ? "active" : null}
            aria-pressed={activeTab === "public"}
            onClick={() => {
              setActiveTab("public");
            }}
          >
            Public
          </button>
        )}
      </div>
      {activeTab === "template" && (
        <ImportFromTemplate openGraph={openGraph} onClose={onClose} />
      )}
      {activeTab === "import" && (
        <ImportFromFile openGraph={openGraph} onClose={onClose} />
      )}
      {activeTab === "public" && (
        <JoinPublic openGraph={openGraph} onClose={onClose} />
      )}
    </div>
  );
}
