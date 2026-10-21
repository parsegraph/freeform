import { useCallback, useEffect, useRef, useState } from "react";

import { readGraph, graphViewport, graphSelection } from "../graphDocument";

import * as importers from "../importers";

import "./modal.css";
import { createExample, loadExample } from "../examples";
import { readXmlFile } from "../xmlGraph";
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
  const performImport = useCallback(async () => {
    setImportError(null);
    try {
      if (!importData) throw new Error("Choose a file first.");
      if (importType === "png") {
        openGraph(importers.graphPng(new Uint8Array(await importData.arrayBuffer())));
      } else if (importType === "jpeg") {
        openGraph(importers.graphJpeg(await importData.arrayBuffer()));
      } else {
        const text = importType === "xml" ? await readXmlFile(importData) : await importData.text();
        switch (importType) {
          case "words": openGraph(importers.graphWords(text)); break;
          case "lisp": openGraph(importers.graphLisp(text)); break;
          case "json": openGraph(importers.graphJson(JSON.parse(text))); break;
          case "xml": openGraph(importers.graphXml(text)); break;
          case "parsegraph": {
            const data = JSON.parse(text);
            openGraph(readGraph(data), graphSelection(data), null, graphViewport(data));
            break;
          }
          case "lines": openGraph(importers.graphLines(text)); break;
          default: throw new Error("Unsupported import type: " + importType);
        }
      }
      onClose?.();
    } catch (ex) {
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
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "stretch",
      }}
    >
      <span
        style={{ display: "block", paddingBottom: "0.5em", fontSize: "18px" }}
      >
        Load a Parsegraph from a file.
      </span>
      <label
        htmlFor="fileUpload"
        style={{
          display: "block",
          background: importData ? "#0a8a0a" : "#5f5fff",
          color: "white",
          padding: "5px",
          borderRadius: "3px",
          marginBottom: "5px",
          flexGrow: "1",
        }}
      >
        {importData ? importName ?? "File selected" : "Choose file"}
      </label>
      <input
        style={{ display: "none" }}
        id="fileUpload"
        type="file"
        onChange={loadFiles}
      />
      <label style={{ display: "flex", gap: "5px" }}>
        Type:{" "}
        <select
          style={{ flexGrow: "1" }}
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
      {importType === "xml" && <p>
        Preserves text and whitespace. External DOCTYPEs are kept as data;
        custom DTDs and entity declarations are unsupported.
      </p>}
      {importError && <p role="alert">Could not open file: {importError}</p>}
      <div className="buttons">
        <input
          type="submit"
          style={{ flexGrow: "1" }}
          value="Import"
        />
        {onClose && (
          <button type="button" style={{ flexGrow: "1" }} onClick={onClose}>
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
        graphViewport(roomData)
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
  const [importType, setImportType] = useState("blank");
  const [numRounds, setNumRounds] = useState(5);
  const [vertical, setVertical] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const createFromTemplate = async () => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadExample(createExample(importType, { rounds: numRounds, vertical }));
      if (!active.current) return;
      openGraph(loaded.graph, loaded.selectedNode, null, loaded.viewportData, loaded.example);
      onClose?.();
    } catch (err) {
      if (active.current) setError("Could not load this example. Please try again.");
    } finally {
      if (active.current) setLoading(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        createFromTemplate();
      }}
    >
      <span
        style={{ display: "block", paddingBottom: "0.5em", fontSize: "18px" }}
      >
        Create a new Parsegraph.
      </span>
      <label style={{ display: "flex", gap: "5px" }}>
        Template:{" "}
        <select
          style={{ flexGrow: "1" }}
          value={importType}
          onChange={(e) => setImportType(e.target.value)}
        >
          <option value="blank">Blank</option>
          <option value="json">Sample JSON</option>
          <option value="lisp">Sample Lisp</option>
          <option value="svg">SVG source (XML)</option>
          <option value="grid">Grid</option>
          <option value="daily_planner_5">Daily planner (5m)</option>
          <option value="daily_planner_10">Daily planner (10m)</option>
          <option value="daily_planner_15">Daily planner (15m)</option>
          <option value="daily_planner_30">Daily planner (30m)</option>
          <option value="daily_planner_60">Daily planner (hourly)</option>
          <option value="alt_columns">Alternating columns</option>
          <option value="random">Random graph</option>
          <option value="march_madness">March Madness</option>
          <option value="march_madness_vert">March Madness (vertical)</option>
          <option value="playoffs">Playoffs</option>
          <option value="playoffs_vert">Playoffs (vertical)</option>
          <option value="march">Tournament</option>
          <option value="rainbow">Rainbow</option>
          <option value="rainbow_vert">Rainbow (vertical)</option>
          <option value="rainbow_random">Random Colors</option>
          <option value="cross">Recursive cross</option>
          <option value="proportion_v1">Proportion (v1)</option>
          <option value="proportion_standard_v1">Proportion, standard (v1)</option>
          <option value="proportion_math_v1">Proportion, math (v1)</option>
          <option value="appearance_v1">Appearance colors (v1)</option>
          <option value="memory_piers_v1">Memory Piers (v1, seed 42)</option>
        </select>
      </label>
      {(importType === "march" || importType === "cross") && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: "8px",
            margin: "8px 0",
          }}
        >
          <label style={{ display: "flex" }}>
            Rounds:&nbsp;
            <input
              value={numRounds}
              onChange={(e) => setNumRounds(Number.parseInt(e.target.value))}
              type="range"
              min="1"
              max={importType === "cross" ? MAX_ROUNDS - 3 : MAX_ROUNDS}
            ></input>
            <span style={{ display: "inline-block", minWidth: "2em" }}>
              {numRounds}
            </span>
          </label>
          {importType === "march" && (
            <label style={{ display: "flex", justifyContent: "space-between" }}>
              Vertical?
              <input
                style={{ minWidth: "2em" }}
                type="checkbox"
                checked={vertical}
                onChange={(e) => setVertical(e.target.checked)}
              />
            </label>
          )}
        </div>
      )}
      <p style={{ fontSize: "13px", maxWidth: "320px" }}>
        Refresh restores the original example and your view. Save to keep edits.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="buttons">
        <input
          type="submit"
          style={{ flexGrow: "1" }}
          value={loading ? "Loading…" : "Create"}
          disabled={loading}
          autoFocus
        />
        {onClose && (
          <button type="button" style={{ flexGrow: "1" }} onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default function ImportModal({ onClose, openGraph, initialSession }) {
  const [activeTab, setActiveTab] = useState("template");
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!initialSession) return;
    let cancelled = false;
    loadExample(initialSession.example).then((loaded) => {
      if (cancelled) return;
      const viewportData = initialSession.cam
        ? { ...loaded.viewportData, cam: initialSession.cam }
        : loaded.viewportData;
      openGraph(loaded.graph, loaded.selectedNode, null, viewportData,
        loaded.example, initialSession.showingUI);
    }).catch(() => {
      if (!cancelled) setLoadError("Could not restore the example. Choose a template or open a file.");
    });
    return () => { cancelled = true; };
  }, [initialSession, openGraph]);

  if (initialSession && !loadError) {
    return <div style={{ padding: "12px" }}>Loading Parsegraph…</div>;
  }

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
      <h3 style={{ margin: "0", marginBottom: ".5em" }}>
        {activeTab === "template"
          ? "New"
          : activeTab === "public"
          ? "Load"
          : "Open"}{" "}
        Parsegraph
      </h3>
      {loadError && <p role="alert">{loadError}</p>}
      <div className="tabs" style={{ display: "flex", gap: "5px" }}>
        <button
          className={activeTab === "template" ? "active" : null}
          onClick={() => {
            setActiveTab("template");
          }}
        >
          New
        </button>
        <button
          className={activeTab === "import" ? "active" : null}
          onClick={() => {
            setActiveTab("import");
          }}
        >
          Open
        </button>
        {(PUBLIC_SERVERS || !HIDE_PUBLIC_SERVERS_TAB) && (
          <button
            className={activeTab === "public" ? "active" : null}
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
