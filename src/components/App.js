import { useCallback, useEffect, useRef, useState } from "react";

import {
  adoptGraph,
  isNormalizedGraph,
  readGraph,
  writeGraph,
  CURRENT_DOCUMENT_VERSION,
  documentState,
  graphSelection,
  graphViewport,
  nodeLabel,
} from "../graphDocument";
import { isStructuredJson } from "../structuredJson";
import { isStructuredLisp, upgradeLispLayout } from "../structuredLisp";
import { isStructuredDocument } from "../structuredDocument";
import {
  readStructuredRecovery,
  writeStructuredRecovery,
} from "../structuredRecovery";
import StructuredJsonPanel from "./StructuredJsonPanel";
import StructuredLispPanel from "./StructuredLispPanel";
import GraphStack from "../GraphStack";
import "./App.css";
import Viewport from "./Viewport/Viewport";
import ImportModal from "./ImportModal";
import ExportModal from "./ExportModal";
import {
  PRINT_PAINT_STATS,
  PUBLIC_SERVERS,
  SHOW_WORLD_LABELS,
  SHOW_NODE_SPOTLIGHTS,
} from "../settings";
import NodeStylingModal from "./NodeStylingModal";
import NodeDirectionControls from "./NodeDirectionControls";
import { EditorIcon, EditorHeader, EditorDialog } from "./EditorShell";
import MousePanControls from "./MousePanControls";
import CameraTravelControls from "./CameraTravelControls";
import {
  attachBenchmark,
  benchmarkFor,
  benchmarkEnabled,
  measureBenchmark,
} from "../benchmark";
import BenchmarkPanel from "./BenchmarkPanel";
import {
  clearExampleSession,
  initialExampleSession,
  watchExampleSession,
} from "../exampleSession";

const sessionId = crypto.randomUUID();

const loadRoom = (openGraph, roomName) => {
  return fetch("/public/" + roomName)
    .then((resp) => resp.json())
    .then((roomData) => {
      openGraph(readGraph(roomData));
    });
};

let initialRoom;
const loadInitialRoom = (openGraph) => {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("document")) return;
  const roomName = urlParams.get("public");
  if (!roomName) {
    return;
  }
  if (!initialRoom) {
    initialRoom = loadRoom(openGraph, roomName);
  }
  return initialRoom.then((roomData) => {
    if (roomData) {
      openGraph(readGraph(roomData));
    }
  });
};

function App() {
  const [viewport] = useState(() => new Viewport());
  const [graphs] = useState(() => new GraphStack());
  const [initialSession, setInitialSession] = useState(() =>
    initialExampleSession(window.location.search)
  );
  const [exampleSource, setExampleSource] = useState(null);
  const [initialDocument, setInitialDocument] = useState(() =>
    new URLSearchParams(window.location.search).get("document")
  );

  const [needsSave, setNeedsSave] = useState(false);
  const needsSaveRef = useRef(needsSave);
  needsSaveRef.current = needsSave;
  const editGroupDirty = useRef(false);
  const sidebarEditing = useRef(null);
  const sidebarHistoryGroup = useRef(null);
  const finishStructuredEditing = useCallback(() => {
    if (sidebarEditing.current?.() === false) return false;
    const finish = viewport.finishStructuredEditing ?? viewport.finishLispSourceInput;
    return finish?.call(viewport) !== false;
  }, [viewport]);
  const beginSidebarEditing = useCallback((finish) => {
    if (sidebarEditing.current && sidebarEditing.current !== finish &&
        sidebarEditing.current() === false) return false;
    const finishViewport = viewport.finishStructuredEditing ?? viewport.finishLispSourceInput;
    if (finishViewport?.call(viewport) === false) return false;
    sidebarEditing.current = finish;
    sidebarHistoryGroup.current = finish;
    viewport.beginHistoryGroup?.();
    return true;
  }, [viewport]);
  const endSidebarEditing = useCallback((finish, disposed = false) => {
    if (sidebarHistoryGroup.current === finish) {
      sidebarHistoryGroup.current = null;
      viewport.endHistoryGroup?.();
    }
    // A blurred field can still have rejected text. Keep its flush callback
    // until unmount so toolbar actions cannot export an older accepted value.
    if (disposed && sidebarEditing.current === finish) sidebarEditing.current = null;
  }, [viewport]);
  const [documentName, setDocumentName] = useState("Untitled graph");
  const [selection, setSelection] = useState(null);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [labelsVisible, setLabelsVisible] = useState(SHOW_WORLD_LABELS);
  const [spotlightsVisible, setSpotlightsVisible] =
    useState(SHOW_NODE_SPOTLIGHTS);
  const [benchmarkActive, setBenchmarkActive] = useState(benchmarkEnabled);

  const [hasWidget, setHasWidget] = useState(false);
  const [documentInfo, setDocumentInfo] = useState(null);
  const [structuredView, setStructuredView] = useState(null);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const [recoveryState, setRecoveryState] = useState(readStructuredRecovery);
  const [recoveryMessage, setRecoveryMessage] = useState("");

  const [autopublish, setAutopublish] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportModalFormat, setExportModalFormat] = useState("parsegraph");
  const [nodeStylingModalOpen, setNodeStylingModalOpen] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const [roomName, setRoomName] = useState(
    urlParams.has("document") ? null : urlParams.get("public")
  );

  // Displays the current history entry. An opened document passes its adopted
  // graph as `live` so it is shown directly instead of rebuilt from history.
  const refresh = useCallback(
    (dontTouchCamera, benchmark, live) => {
      setHasWidget(graphs.hasWidget());
      if (graphs.hasWidget()) {
        const displayed = live
          ? upgradeLispLayout(live, graphs.selectedNode())
          : measureBenchmark(benchmark, "Display reconstruction", () =>
              upgradeLispLayout(graphs.widget(), graphs.selectedNode())
            );
        const root = attachBenchmark(displayed.root, benchmark);
        measureBenchmark(benchmark, "Viewport setup", () => {
          viewport.show(root, graphs.viewportData());
          setDocumentInfo(documentState(root));
          viewport.moveToId(displayed.selectedNode?.id() ?? graphs.selectedNode());
          if (!dontTouchCamera) {
            viewport.showInCamera();
          }
        });
      }
    },
    [viewport, graphs]
  );

  const publish = useCallback(() => {
    if (!PUBLIC_SERVERS) {
      return;
    }
    if (!roomName) {
      return;
    }
    fetch("/public/" + roomName + "?sid=" + sessionId, {
      body: JSON.stringify(
        writeGraph(viewport.widget(), viewport.node(), viewport.toJSON())
      ),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    })
      .then((resp) => {
        viewport.logMessage("Saved to " + roomName);
        setNeedsSave(false);
      })
      .catch((ex) => {
        console.log(ex);
        viewport.logMessage("Failed to save");
      });
  }, [graphs, roomName, viewport]);

  const openImportModal = () => {
    if (!finishStructuredEditing()) return;
    setExportModalOpen(false);
    setImportModalOpen((old) => !old);
  };

  const openExportModal = () => {
    if (!finishStructuredEditing()) return;
    setExportModalFormat("parsegraph");
    setImportModalOpen(false);
    setExportModalOpen((old) => !old);
  };

  const [showNodeActions, setShowNodeActions] = useState(false);

  useEffect(() => {
    viewport.setOnDocumentChange?.((root, node) => {
      setStructuredView(isStructuredDocument(root) ? { root, node } : null);
      setSelection(node ? { label: nodeLabel(node), id: node.id() } : null);
    });
    return () => viewport.setOnDocumentChange?.(null);
  }, [viewport]);

  const persistStructuredDraft = useCallback(() => {
    const root = viewport.widget();
    if (!isStructuredDocument(root)) return;
    try {
      const document = writeGraph(
        root,
        viewport.node(),
        viewport.toJSON(),
        CURRENT_DOCUMENT_VERSION
      );
      const savedAt = writeStructuredRecovery(document);
      setRecoveryState({ recovery: { document, savedAt }, error: null });
      setRecoveryMessage("Draft recovery saved in this browser.");
    } catch (error) {
      setRecoveryMessage(
        `Recovery could not be saved: ${error.message} Download a draft to keep your work.`
      );
    }
  }, [viewport]);

  const structuredRoot = structuredView?.root;
  useEffect(() => {
    if (!structuredRoot) return;
    const timer = setTimeout(persistStructuredDraft, 300);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") persistStructuredDraft();
    };
    window.addEventListener("pagehide", persistStructuredDraft);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", persistStructuredDraft);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [structuredRoot, persistStructuredDraft, recoveryRevision]);

  const structuredCommand = useCallback(
    (command, nodeId) => {
      return viewport.applyStructuredCommand(command, nodeId);
    },
    [viewport]
  );

  const structuredExport = (format) => {
    if (!finishStructuredEditing()) return;
    setExportModalFormat(format);
    setExportModalOpen(true);
  };

  const changeNodeDirection = (direction) => {
    if (!finishStructuredEditing()) return false;
    // Finishing a source edit can replace the graph. Resolve the selection
    // through the viewport after that edit has been committed.
    return viewport.setNodeBidi(direction);
  };

  useEffect(() => {
    if (!viewport) {
      return;
    }
    const id = setInterval(() => {
      viewport.input().keystrokes()?.refreshKeystrokes();
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [viewport]);

  useEffect(() => {
    if (!autopublish) {
      return;
    }
    if (!roomName) {
      return;
    }
    if (!PUBLIC_SERVERS) {
      return;
    }
    const es = new EventSource("/public/" + roomName + "?sid=" + sessionId);
    es.onmessage = (e) => {
      const selectedNode = viewport._userCaret.node().id();
      graphs.save(readGraph(JSON.parse(e.data)));
      resetUndoCounts();
      refresh(true);
      viewport.moveToId(selectedNode);
    };
    es.onerror = () => {
      setAutopublish(false);
    };
    return () => {
      es.close();
    };
  }, [autopublish, graphs, refresh, roomName, viewport]);

  const [undoSize, setUndoSize] = useState(0);
  const [redoSize, setRedoSize] = useState(0);

  const refreshUndoCounts = useCallback(() => {
    setUndoSize(graphs.undoCount());
    setRedoSize(graphs.redoCount());
  }, [setUndoSize, setRedoSize, graphs]);

  const resetUndoCounts = () => {
    setUndoSize(0);
    setRedoSize(0);
  };

  const openGraph = useCallback(
    (
      graph,
      selectedNode,
      roomName,
      viewportData,
      example = null,
      showingUI,
      documentURL = null,
      name = null
    ) => {
      if (!finishStructuredEditing()) return;
      sidebarEditing.current = null;
      sidebarHistoryGroup.current = null;
      // Flush before switching even when the debounced recovery write has not run.
      persistStructuredDraft();
      const benchmark = benchmarkFor(graph);
      if (isStructuredLisp(graph)) {
        const opened = upgradeLispLayout(
          graph,
          selectedNode ?? documentState(graph)?.metadata?.freeform?.selectedNode
        );
        if (opened.root !== graph) {
          graph = attachBenchmark(opened.root, benchmark);
          if (selectedNode !== null) selectedNode = opened.selectedNode;
        }
      }
      setInitialSession(null);
      setInitialDocument(null);
      setRoomName(roomName);
      setImportModalOpen(false);
      setNeedsSave(false);
      setDocumentName(
        name ||
          (documentURL
            ? new URL(documentURL, window.location.href).pathname
                .split("/")
                .pop()
            : roomName ||
              (isStructuredJson(graph)
                ? "Untitled.json"
                : isStructuredLisp(graph)
                ? "Untitled.scm"
                : "Untitled graph"))
      );
      viewport.container()?.focus();
      // Normalized graphs are displayed as built; anything else is rebuilt from
      // its saved form here, so the benchmark shows when that fallback runs.
      graph = isNormalizedGraph(graph)
        ? graph
        : measureBenchmark(benchmark, "Display reconstruction", () =>
            adoptGraph(graph, selectedNode)
          );
      graphs.clear();
      measureBenchmark(benchmark, "History serialization", () =>
        graphs.save(graph, selectedNode, viewportData)
      );
      setUndoSize(0);
      setRedoSize(0);
      refresh(!!viewportData?.cam, benchmark, graph);
      if (showingUI === false) viewport.rendering().hideUI();
      if (showingUI === true) viewport.rendering().showUI();
      // Imported files must not reopen an unrelated example or inherit its camera.
      clearExampleSession();
      setExampleSource(example);
      // Linked documents reload their original source on refresh. Switching to a
      // file or example consumes that link so it cannot reopen the wrong graph.
      const url = new URL(window.location.href);
      if (documentURL) url.searchParams.set("document", documentURL);
      else url.searchParams.delete("document");
      if (url.searchParams.get("sample") === "primes") url.searchParams.delete("max");
      url.searchParams.delete("sample");
      if (!roomName) url.searchParams.delete("public");
      if (url.href !== window.location.href) {
        window.history.replaceState(window.history.state, "", url);
      }
    },
    [graphs, viewport, refresh, persistStructuredDraft, finishStructuredEditing]
  );

  useEffect(() => {
    if (!exampleSource) return;
    return watchExampleSession(viewport, exampleSource);
  }, [viewport, exampleSource]);

  const undo = useCallback(() => {
    if (!finishStructuredEditing()) return;
    if (graphs.undoCount() <= 0) return;
    graphs.undo();
    refreshUndoCounts();
    setNeedsSave(true);
    if (autopublish && PUBLIC_SERVERS) {
      publish();
    }
    refresh(true);
  }, [autopublish, publish, graphs, refresh, refreshUndoCounts, finishStructuredEditing]);

  const redo = useCallback(() => {
    if (!finishStructuredEditing()) return;
    if (graphs.redoCount() <= 0) return;
    graphs.redo();
    refreshUndoCounts();
    setNeedsSave(true);
    if (autopublish && PUBLIC_SERVERS) {
      publish();
    }
    refresh(true);
  }, [autopublish, publish, graphs, refresh, refreshUndoCounts, finishStructuredEditing]);

  useEffect(() => {
    if (!graphs) {
      return;
    }
    if (!PUBLIC_SERVERS) {
      return;
    }
    loadInitialRoom((graph, selectedNode) => {
      if (selectedNode || autopublish) {
        graphs.save(graph, selectedNode);
        resetUndoCounts();
        refresh(true);
      }
    });
  }, [autopublish, graphs, refresh]);

  const [offscreen, setOffscreen] = useState(false);

  useEffect(() => {
    if (!graphs) {
      return;
    }
    viewport.setSaveGraph((graph, selectedNode) => {
      if (isStructuredDocument(graph))
        setRecoveryRevision((revision) => revision + 1);
      if (!viewport.showingStyling()) {
        graphs.save(graph, selectedNode, viewport.toJSON());
        refreshUndoCounts();
      }
      if (autopublish && PUBLIC_SERVERS) {
        publish();
      } else {
        setNeedsSave(true);
      }
    });
    viewport.setHistoryGrouping?.({
      begin: (graph, node, data) => {
        editGroupDirty.current = needsSaveRef.current;
        graphs.beginGroup(graph, node, data);
      },
      end: () => {
        const changed = graphs.endGroup();
        if (changed !== undefined) setNeedsSave(editGroupDirty.current || changed);
        refreshUndoCounts();
      },
    });
    viewport.setUndo(undo);
    viewport.setRedo(redo);
    viewport.setToggleNodeActions((shown) => {
      setShowNodeActions(shown);
      if (shown) setDeveloperOpen(false);
    });
    if (graphs._actionIndex < 0) {
      return;
    }
    const root = graphs.liveWidget();
    viewport.show(root, graphs.viewportData());
    setDocumentInfo(documentState(root));
  }, [
    graphs,
    viewport,
    refresh,
    autopublish,
    publish,
    undo,
    redo,
    refreshUndoCounts,
  ]);

  useEffect(() => {
    if (autopublish) {
      return;
    }
    if (!needsSave) {
      window.onbeforeunload = null;
      return;
    }

    window.onbeforeunload = () => {
      setExportModalOpen(true);
      return "Are you sure you want to lose your unexported changes?";
    };
  }, [needsSave, autopublish, setExportModalOpen]);

  const [nodeStyling, setNodeStyling] = useState(null);

  useEffect(() => {
    if (!viewport) {
      return;
    }
    viewport.setToggleNodeStyling((showingStyling) => {
      if (showingStyling) {
        graphs.save(viewport.widget(), viewport.node().id(), viewport);
        refreshUndoCounts();
        setNodeStyling({
          ...viewport.getNodeStyle(),
          pageBackgroundColor: viewport
            .rendering()
            .pageBackgroundColor()
            .asHex(),
          pageBackgroundAlpha: viewport.rendering().pageBackgroundColor().a(),
        });
      }
      setNodeStylingModalOpen(showingStyling);
    });
  }, [
    viewport,
    setNodeStylingModalOpen,
    setNodeStyling,
    graphs,
    refreshUndoCounts,
  ]);

  const updateNodeStyling = (newStyling) => {
    viewport.updateNodeStyle(newStyling);
    graphs.replace(viewport.widget(), viewport.node().id(), viewport);
  };

  const canvasRef = useRef();

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
      return;
    }
    viewport.mount(canvasRef.current);
    viewport.rendering().setOffscreenHandler(setOffscreen);
  }, [canvasRef, viewport]);

  const [showingUI, setShowingUI] = useState(false);

  useEffect(() => {
    if (!viewport) {
      return;
    }
    viewport.rendering().setOnUI((shown) => {
      setShowingUI(shown);
    });
  }, [viewport, setShowingUI]);

  const toggleMode = (editing) => {
    if (!finishStructuredEditing()) return;
    viewport.hideEditor?.();
    if (editing) viewport.rendering().showUI();
    else viewport.rendering().hideUI();
    setDeveloperOpen(false);
    viewport.refresh();
    viewport.container()?.focus();
  };
  const focusCanvas = (action) => {
    action();
    viewport.container()?.focus();
  };
  const sidePanelOpen = hasWidget && (showingUI || developerOpen);
  const StructuredPanel = isStructuredLisp(structuredView?.root)
    ? StructuredLispPanel
    : StructuredJsonPanel;

  return (
    <div
      className={`App ${sidePanelOpen ? "has-inspector" : ""} ${
        developerOpen ? "has-developer" : ""
      }`}
    >
      <EditorHeader
        hasDocument={hasWidget}
        name={documentName}
        modified={needsSave}
        structured={!!structuredView}
        language={
          isStructuredLisp(structuredView?.root) ? "LISP / SCHEME" : "JSON"
        }
        editing={showingUI}
        onMode={toggleMode}
        onOpen={openImportModal}
        onSave={openExportModal}
        onUndo={() => focusCanvas(undo)}
        onRedo={() => focusCanvas(redo)}
        undoCount={undoSize}
        redoCount={redoSize}
      />
      <main className="editor-workspace">
        <section className="canvas-workspace" aria-label="Graph workspace">
          <div
            id="parsegraph"
            ref={canvasRef}
            tabIndex={0}
            aria-label="Graph canvas"
          />
          {hasWidget && offscreen && (
            <div className="canvas-notice" role="status">
              <span>Your graph is outside the view.</span>
              <button
                type="button"
                onClick={() => focusCanvas(() => viewport.fitGraph())}
              >
                Bring it back
              </button>
            </div>
          )}
          {hasWidget && (
            <div className="canvas-navigation" aria-label="Canvas controls">
              <button
                type="button"
                className="icon-button"
                aria-label="Zoom out"
                title="Zoom out (−)"
                onClick={() => focusCanvas(() => viewport.zoomCamera(1 / 1.2))}
              >
                <EditorIcon name="minus" />
              </button>
              <button
                type="button"
                onClick={() => focusCanvas(() => viewport.fitGraph())}
              >
                <EditorIcon name="fit" />
                Fit graph
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Zoom in"
                title="Zoom in (+)"
                onClick={() => focusCanvas(() => viewport.zoomCamera(1.2))}
              >
                <EditorIcon name="plus" />
              </button>
              {SHOW_WORLD_LABELS && (
                <button
                  type="button"
                  className="labels-toggle"
                  aria-pressed={labelsVisible}
                  onClick={() => {
                    viewport.rendering().toggleWorldLabels();
                    setLabelsVisible((previous) => !previous);
                    viewport.refresh();
                  }}
                >
                  Labels
                </button>
              )}
            </div>
          )}
        </section>
        {sidePanelOpen && (
          <section
            className="editor-inspector"
            aria-label={developerOpen ? "Developer tools" : "Inspector"}
          >
            <header className="inspector-header">
              <div>
                <span className="eyebrow">
                  {developerOpen ? "WORKBENCH" : "SELECTION"}
                </span>
                <h2>{developerOpen ? "Developer tools" : "Inspector"}</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={
                  developerOpen ? "Close developer tools" : "Hide inspector"
                }
                onClick={() =>
                  developerOpen ? setDeveloperOpen(false) : toggleMode(false)
                }
              >
                <EditorIcon name="close" />
              </button>
            </header>
            <div className="inspector-content">
              {developerOpen ? (
                <div className="developer-panel">
                  <p className="panel-intro">
                    Tune movement and inspect rendering performance.
                  </p>
                  <MousePanControls />
                  <CameraTravelControls />
                  <details className="inspector-section">
                    <summary>Rendering</summary>
                    <div className="inspector-actions">
                      <button
                        type="button"
                        aria-pressed={spotlightsVisible}
                        onClick={() => {
                          viewport.rendering().toggleSpotlights();
                          setSpotlightsVisible((previous) => !previous);
                        }}
                      >
                        Spotlights
                      </button>
                      {PRINT_PAINT_STATS && (
                        <button
                          type="button"
                          onClick={() => {
                            viewport.rendering().toggleStats();
                            viewport.refresh();
                          }}
                        >
                          Metrics
                        </button>
                      )}
                    </div>
                  </details>
                  {documentInfo && (
                    <details className="inspector-section">
                      <summary>Document capabilities</summary>
                      <p>
                        V{documentInfo.version} document.{" "}
                        {documentInfo.sourceVersion < documentInfo.version &&
                          `Imported from v${documentInfo.sourceVersion}. `}
                        {documentInfo.presentation
                          ? "Presentation applied. "
                          : "Local sizing. "}
                        {documentInfo.appearance
                          ? "Appearance applied."
                          : "Local colors."}
                      </p>
                      {documentInfo.hasUnsupportedContent && (
                        <p>
                          Non-text JSON values are preserved without text
                          labels.
                        </p>
                      )}
                      {documentInfo.ignoredCapabilities.length > 0 && (
                        <p>
                          Preserved without interpretation:{" "}
                          {documentInfo.ignoredCapabilities.join(", ")}.
                          Generation recipes never replace edited nodes
                          automatically.
                        </p>
                      )}
                    </details>
                  )}
                  {!benchmarkActive ? (
                    <section className="inspector-section">
                      <h3>Benchmarks</h3>
                      <p>
                        Record import, layout, and navigation timings for this
                        session.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set("benchmark", "1");
                          window.history.replaceState(
                            window.history.state,
                            "",
                            url
                          );
                          setBenchmarkActive(true);
                        }}
                      >
                        Enable benchmarks
                      </button>
                    </section>
                  ) : (
                    <BenchmarkPanel />
                  )}
                </div>
              ) : structuredView ? (
                <StructuredPanel
                  root={structuredView.root}
                  selectedNode={structuredView.node}
                  onEditValue={(nodeId) => {
                    viewport.moveToId(nodeId);
                    viewport.showEditor();
                  }}
                  onTypeSource={() => viewport.showLispSourceInput()}
                  onFinishEditing={() => {
                    viewport.hideEditor();
                    viewport.container()?.focus();
                  }}
                  onBeginEditing={beginSidebarEditing}
                  onEndEditing={endSidebarEditing}
                  onCommand={structuredCommand}
                  onSelect={(nodeId) => viewport.moveToId(nodeId)}
                  onSaveDraft={() => structuredExport("parsegraph")}
                  onExportJson={() => structuredExport("json")}
                  onExportLisp={() => structuredExport("lisp")}
                  recoveryMessage={recoveryMessage}
                />
              ) : (
                <div className="node-inspector">
                  <span className="node-kind">
                    {selection?.label ? "Text node" : "Bud"}
                  </span>
                  <h3 className="node-title">
                    {selection?.label || "Empty node"}
                  </h3>
                  <p className="panel-intro">
                    {selection?.label
                      ? "Edit this node, or use its handles to grow the graph."
                      : "An empty node connects and organizes your graph. Add a label or grow in any direction."}
                  </p>
                  <div className="inspector-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => viewport.toggleEditor()}
                    >
                      Edit text
                    </button>
                    <button
                      type="button"
                      onClick={() => viewport.toggleNodeStyling()}
                    >
                      Appearance
                    </button>
                  </div>
                  <ParsegraphEditor viewport={viewport} />
                  <NodeDirectionControls
                    node={viewport.node()}
                    onChange={changeNodeDirection}
                  />
                  <section className="inspector-section">
                    <h3>Navigate</h3>
                    <div className="inspector-actions">
                      <button
                        type="button"
                        onClick={() =>
                          focusCanvas(() => viewport.showInCamera())
                        }
                      >
                        Center selection
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          focusCanvas(() => viewport.moveOutward())
                        }
                      >
                        Go outward
                      </button>
                    </div>
                    <p>
                      WASD or HJKL follows connections. Enter edits the label.
                    </p>
                  </section>
                  <details className="inspector-section" open={showNodeActions}>
                    <summary>Layout & structure</summary>
                    <div className="inspector-actions">
                      <NodeActions viewport={viewport} />
                    </div>
                  </details>
                  <section className="inspector-section">
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => focusCanvas(() => viewport.removeNode())}
                    >
                      Remove node
                    </button>
                    <p>You can undo changes at any time.</p>
                  </section>
                  {PUBLIC_SERVERS && roomName && (
                    <section className="inspector-section">
                      <h3>Shared document</h3>
                      <button
                        type="button"
                        aria-pressed={autopublish}
                        onClick={() => setAutopublish((previous) => !previous)}
                      >
                        Auto-publish {autopublish ? "ON" : "OFF"}
                      </button>
                      <button type="button" onClick={publish}>
                        Publish to {roomName}
                      </button>
                    </section>
                  )}
                </div>
              )}
              {!developerOpen && structuredView && (
                <NodeDirectionControls
                  node={viewport.node()}
                  onChange={changeNodeDirection}
                />
              )}
            </div>
          </section>
        )}
      </main>
      <footer className="editor-statusbar">
        <div className="workspace-status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            {hasWidget
              ? showingUI
                ? "Editing"
                : "Viewing"
              : "Ready when you are"}
          </span>
          <span className="statusbar-divider" />
          {hasWidget && (
            <span className="navigation-hint">
              {showingUI
                ? "Select a node to make it yours"
                : "Drag to pan · Scroll to zoom"}
            </span>
          )}
        </div>
        {hasWidget && (
          <div className="renderer-status">
            <ParsegraphLog viewport={viewport} />
            <ParsegraphStatus viewport={viewport} />
          </div>
        )}
        {hasWidget && (
          <button
            type="button"
            className="developer-toggle"
            aria-expanded={developerOpen}
            onClick={() => setDeveloperOpen((previous) => !previous)}
          >
            <EditorIcon name="sliders" />
            Developer
          </button>
        )}
        {!hasWidget && (
          <span className="statusbar-credit">Made for connected ideas</span>
        )}
      </footer>
      {(!hasWidget || importModalOpen) && (
        <EditorDialog
          onClose={hasWidget ? () => setImportModalOpen(false) : undefined}
        >
          <ImportModal
            recovery={recoveryState.recovery}
            recoveryError={recoveryState.error}
            onRestoreRecovery={() => {
              try {
                const { document } = recoveryState.recovery;
                openGraph(
                  readGraph(document),
                  graphSelection(document),
                  null,
                  graphViewport(document),
                  null,
                  true
                );
                setNeedsSave(true);
              } catch (error) {
                setRecoveryState((state) => ({
                  ...state,
                  error: error.message,
                }));
              }
            }}
            initialSession={initialSession}
            initialDocument={initialDocument}
            onCancelDocument={() => {
              setInitialDocument(null);
              const url = new URL(window.location.href);
              url.searchParams.delete("document");
              if (url.searchParams.get("sample") === "primes") url.searchParams.delete("max");
              url.searchParams.delete("sample");
              url.searchParams.delete("public");
              window.history.replaceState(window.history.state, "", url);
            }}
            onClose={hasWidget ? () => setImportModalOpen(false) : null}
            openGraph={openGraph}
          />
        </EditorDialog>
      )}
      {exportModalOpen && hasWidget && (
        <EditorDialog onClose={() => setExportModalOpen(false)}>
          <ExportModal
            initialFormat={exportModalFormat}
            documentName={documentName}
            viewport={viewport}
            onExport={() => {
              setNeedsSave(false);
            }}
            graph={viewport.widget()}
            onClose={() => setExportModalOpen(false)}
          />
        </EditorDialog>
      )}
      {nodeStylingModalOpen && hasWidget && (
        <EditorDialog
          label="Node appearance"
          onClose={() => viewport.toggleNodeStyling()}
        >
          <NodeStylingModal
            viewport={viewport}
            style={nodeStyling}
            updateStyle={updateNodeStyling}
            onClose={() => {
              setNodeStylingModalOpen(false);
              viewport.toggleNodeStyling();
            }}
          />
        </EditorDialog>
      )}
    </div>
  );
}

function ParsegraphLog({ viewport }) {
  const logRef = useRef();

  useEffect(() => {
    if (!viewport) {
      return;
    }
    if (!logRef.current) {
      return;
    }
    viewport.mountLog?.(logRef.current);
  });

  return <div id="log" ref={logRef} />;
}

function ParsegraphEditor({ viewport }) {
  const editorContainerRef = useRef();

  useEffect(() => {
    if (!viewport) {
      return;
    }
    if (!editorContainerRef.current) {
      return;
    }
    const container = editorContainerRef.current;
    viewport.mountEditor(container);
    return () => viewport.unmountEditor?.(container);
  }, [viewport, editorContainerRef]);

  return <div ref={editorContainerRef}></div>;
}

function ParsegraphStatus({ viewport }) {
  const ref = useRef();

  useEffect(() => {
    if (!viewport) {
      return;
    }
    if (!ref.current) {
      return;
    }
    viewport.mountStatus?.(ref.current);
  }, [viewport, ref]);

  return <div ref={ref}></div>;
}

function NodeActions({ viewport }) {
  return (
    <>
      <button className="edit" onClick={() => viewport.toggleAlignment()}>
        Align
      </button>
      <button className="edit" onClick={() => viewport.togglePreferredAxis()}>
        Preferred Axis
      </button>
      <button className="edit" onClick={() => viewport.toggleNodeScale()}>
        Scale
      </button>
      <button className="edit" onClick={() => viewport.toggleNodeFit()}>
        Fit
      </button>
      <button className="edit" onClick={() => viewport.toggleCrease()}>
        Crease
      </button>
    </>
  );
}

export default App;
