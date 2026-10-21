import { useState } from "react";

import * as exporters from "../exporters";
import { writeGraph, documentState } from "../graphDocument";

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

function ExportForm({ viewport, graph, onExport, onClose }) {
  const [exportType, setExportType] = useState("parsegraph");
  const [name, setName] = useState(typeof graph.value() === "string" || typeof graph.value() === "number"
    ? graph.value() === "#document" ? "document" : String(graph.value()) : "graph");
  const [exportError, setExportError] = useState(null);

  const exportParsegraph = (version = 1) =>
    writeGraph(graph, viewport.node(), viewport.toJSON(), version);

  const performExport = () => {
    setExportError(null);
    try {
      switch (exportType) {
        case "lisp":
          const tokens = [];
          exporters.exportGraphToLisp(graph, tokens);
          download(addExtension(name, ".lisp"), tokens.join(""));
          break;
        case "json":
          download(
            addExtension(name, ".json"),
            JSON.stringify(exporters.exportGraphToJson(graph))
          );
          break;
        case "xml":
          download(addExtension(name, ".xml"), exporters.exportGraphToXml(graph), "application/xml");
          break;
        case "svg":
          download(addExtension(name, ".svg"), exporters.exportGraphToSvg(graph), "image/svg+xml");
          break;
        case "parsegraph":
          download(
            addExtension(name, ".parsegraph"),
            JSON.stringify(exportParsegraph())
          );
          break;
        case "parsegraph-v0":
          download(addExtension(name, ".parsegraph"), JSON.stringify(exportParsegraph(0)));
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
      style={{ display: "flex", flexDirection: "column", gap: "3px" }}
    >
      <label style={{ display: "flex", gap: "5px" }}>
        Name:&nbsp;
        <input
          style={{ flexGrow: "1" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label style={{ display: "flex", gap: "5px" }}>
        Format:{" "}
        <select
          style={{ flexGrow: "1" }}
          value={exportType}
          onChange={(e) => setExportType(e.target.value)}
        >
          <option value="parsegraph">Parsegraph v1</option>
          <option value="parsegraph-v0">Parsegraph v0 (legacy; loses capabilities)</option>
          <option value="words">Words</option>
          <option value="lines">Lines</option>
          <option value="lisp">Lisp</option>
          <option value="json">JSON</option>
          <option value="xml">XML</option>
          <option value="svg">SVG (from XML graph)</option>
          {PUBLIC_SERVERS && <option value="public">Public</option>}
        </select>
      </label>
      {(exportType === "xml" || exportType === "svg") && <p>
        Exports the XML tree and its edits as UTF-8, preserving content whitespace.
        SVG requires an svg root in the SVG namespace.
      </p>}
      {exportError && <p role="alert">Could not export: {exportError}</p>}
      {exportType === "parsegraph-v0" && documentState(graph)?.version === 1 &&
        <p role="status">Legacy export discards presentation, appearance, generation recipes, and other v1 capabilities.</p>}
      <div className="buttons">
        <input type="submit" value="Save" />
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export default function ExportModal({ onExport, onClose, graph, viewport }) {
  const [activeTab] = useState("export");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "stretch",
        flexDirection: "column",
        alignItems: "stretch",
        gap: "3px",
        padding: "12px",
        boxSizing: "border-box",
      }}
    >
      <h3 style={{ margin: "0", marginBottom: ".5em" }}>Save Parsegraph</h3>
      {activeTab === "export" && (
        <ExportForm
          viewport={viewport}
          graph={graph}
          onExport={onExport}
          onClose={onClose}
        />
      )}
    </div>
  );
}
