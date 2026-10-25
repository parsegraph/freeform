import { useState } from "react";

import * as exporters from "../exporters";
import { writeGraph, documentState } from "../graphDocument";
import { isStructuredJson } from "../structuredJson";
import { isStructuredLisp } from "../structuredLisp";

import "./modal.css";
import { PUBLIC_SERVERS } from "../settings";

function download(filename, text, mimeType = "text/plain") {
  var element = document.createElement("a");
  element.setAttribute(
    "href",
    `data:${mimeType};charset=utf-8,` + encodeURIComponent(text)
  );
  element.setAttribute("download", filename);

  element.style.display = "none";
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

const addExtension = (name, ext) => {
  if (name.endsWith(ext)) {
    return name;
  }
  if (name.endsWith(".")) {
    if (ext.startsWith(".")) {
      return name + ext.substring(1);
    }
    return name + ext;
  }
  if (ext.startsWith(".")) {
    return name + ext;
  }
  return name + "." + ext;
};

function ExportForm({
  viewport,
  graph,
  onExport,
  onClose,
  initialFormat,
  documentName,
}) {
  const json = isStructuredJson(graph);
  const lisp = isStructuredLisp(graph);
  const structured = json || lisp;
  const [exportType, setExportType] = useState(initialFormat || "parsegraph");
  const [name, setName] = useState(
    documentName ||
      (structured
        ? "document"
        : typeof graph.value() === "string" || typeof graph.value() === "number"
        ? graph.value() === "#document"
          ? "document"
          : String(graph.value())
        : "graph")
  );
  const [exportError, setExportError] = useState(null);

  const exportParsegraph = (version = 1) =>
    writeGraph(graph, viewport.node(), viewport.toJSON(), version);

  const performExport = () => {
    setExportError(null);
    try {
      if (
        structured &&
        ![
          "parsegraph",
          json ? "json" : "lisp",
          ...(PUBLIC_SERVERS ? ["public"] : []),
        ].includes(exportType)
      )
        throw new Error(
          "Save this structured document as a native draft or export its source format."
        );
      switch (exportType) {
        case "lisp":
          const tokens = [];
          exporters.exportGraphToLisp(graph, tokens);
          download(
            /\.(?:lisp|lsp|scm|ss|sld|scheme)$/i.test(name)
              ? name
              : addExtension(name, lisp ? ".scm" : ".lisp"),
            tokens.join("")
          );
          break;
        case "json":
          download(
            addExtension(name, ".json"),
            JSON.stringify(
              exporters.exportGraphToJson(graph),
              null,
              structured ? 2 : undefined
            ),
            "application/json"
          );
          break;
        case "xml":
          download(
            addExtension(name, ".xml"),
            exporters.exportGraphToXml(graph),
            "application/xml"
          );
          break;
        case "svg":
          download(
            addExtension(name, ".svg"),
            exporters.exportGraphToSvg(graph),
            "image/svg+xml"
          );
          break;
        case "parsegraph":
          download(
            addExtension(name, ".parsegraph"),
            JSON.stringify(exportParsegraph())
          );
          break;
        case "parsegraph-v0":
          download(
            addExtension(name, ".parsegraph"),
            JSON.stringify(exportParsegraph(0))
          );
          break;
        case "words":
          download(
            addExtension(name, ".txt"),
            exporters.exportGraphToWords(graph)
          );
          break;
        case "lines":
          download(
            addExtension(name, ".txt"),
            exporters.exportGraphToLines(graph)
          );
          break;
        case "public":
          if (!PUBLIC_SERVERS) {
            throw new Error("Public servers not accessible");
          }
          fetch("/public/" + name, {
            body: JSON.stringify(exportParsegraph()),
            headers: {
              "Content-Type": "application/json",
            },
            method: "POST",
          }).then((resp) => {
            console.log(resp);
          });
          break;
        default:
          throw new Error("Unsupported export type: " + exportType);
      }
      if (onExport) {
        onExport();
      }
    } catch (ex) {
      setExportError(ex.message);
      return;
    }
    if (onClose) {
      onClose();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        performExport();
      }}
      className="document-form"
    >
      <label className="document-field">
        Name:&nbsp;
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="document-field">
        Format:{" "}
        <select
          value={exportType}
          onChange={(e) => setExportType(e.target.value)}
        >
          <option value="parsegraph">
            {structured
              ? "Parsegraph v1 draft (preserves slots)"
              : "Parsegraph v1"}
          </option>
          {!structured && (
            <>
              <option value="parsegraph-v0">
                Parsegraph v0 (legacy; loses capabilities)
              </option>
              <option value="words">Words</option>
              <option value="lines">Lines</option>
              <option value="lisp">Lisp / Scheme</option>
              <option value="xml">XML</option>
              <option value="svg">SVG (from XML graph)</option>
            </>
          )}
          {lisp && <option value="lisp">Lisp / Scheme</option>}
          {!lisp && <option value="json">JSON</option>}
          {PUBLIC_SERVERS && <option value="public">Public</option>}
        </select>
      </label>
      {structured && (
        <p className="document-note">
          A Parsegraph draft preserves unfinished slots and editing state.{" "}
          {lisp ? "Lisp/Scheme" : "JSON"} export requires complete{" "}
          {lisp ? "forms" : "values"} and writes formatted source.
        </p>
      )}
      {(exportType === "xml" || exportType === "svg") && (
        <p className="document-note">
          Exports the XML tree and its edits as UTF-8, preserving content
          whitespace. SVG requires an svg root in the SVG namespace.
        </p>
      )}
      {exportError && <p role="alert">Could not export: {exportError}</p>}
      {exportType === "parsegraph-v0" &&
        documentState(graph)?.version === 1 && (
          <p className="document-note document-warning" role="status">
            Legacy export discards presentation, appearance, generation recipes,
            and other v1 capabilities.
          </p>
        )}
      <div className="buttons">
        <input className="document-primary" type="submit" value="Save" />
        {onClose && (
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function ExportModal({
  onExport,
  onClose,
  graph,
  viewport,
  initialFormat,
  documentName,
}) {
  return (
    <div
      className="document-dialog document-export"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-export-title"
    >
      <div className="document-dialog-heading">
        <div>
          <p className="document-eyebrow">YOUR DOCUMENT</p>
          <h2 id="document-export-title">Save a copy</h2>
        </div>
        {onClose && (
          <button
            className="document-close"
            type="button"
            aria-label="Close export"
            onClick={onClose}
          >
            ×
          </button>
        )}
      </div>
      <p className="document-description">
        Download your work in the format you need.
      </p>
      <ExportForm
        viewport={viewport}
        initialFormat={initialFormat}
        documentName={documentName}
        graph={graph}
        onExport={onExport}
        onClose={onClose}
      />
    </div>
  );
}
