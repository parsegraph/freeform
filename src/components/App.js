import { useCallback, useEffect, useRef, useState } from "react";

import { readGraph, writeGraph, documentState } from "../graphDocument";
import GraphStack from "../GraphStack";
import "./App.css";
import Viewport from "./Viewport/Viewport";
import ImportModal from "./ImportModal";
import ExportModal from "./ExportModal";
import { PRINT_PAINT_STATS, PUBLIC_SERVERS, SHOW_WORLD_LABELS } from "../settings";
import NodeStylingModal from "./NodeStylingModal";
import OffscreenModal from "./Viewport/OffscreenModal";
import MousePanControls from "./MousePanControls";
import CameraTravelControls from "./CameraTravelControls";
import { attachBenchmark, benchmarkFor, measureBenchmark } from "../benchmark";
import BenchmarkPanel from "./BenchmarkPanel";
import { clearExampleSession, initialExampleSession, watchExampleSession } from "../exampleSession";

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
  const [initialSession, setInitialSession] = useState(() => initialExampleSession(window.location.search));
  const [exampleSource, setExampleSource] = useState(null);

  const [needsSave, setNeedsSave] = useState(false);

  const [hasWidget, setHasWidget] = useState(false);
  const [documentInfo, setDocumentInfo] = useState(null);

  const [autopublish, setAutopublish] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [nodeStylingModalOpen, setNodeStylingModalOpen] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const [roomName, setRoomName] = useState(urlParams.get("public"));

  const refresh = useCallback(
    (dontTouchCamera, benchmark) => {
      setHasWidget(graphs.hasWidget());
      if (graphs.hasWidget()) {
        const root = attachBenchmark(
          measureBenchmark(benchmark, "Display reconstruction", () =>
            graphs.widget()
          ),
          benchmark
        );
        measureBenchmark(benchmark, "Viewport setup", () => {
          viewport.show(root, graphs.viewportData());
          setDocumentInfo(documentState(root));
          viewport.moveToId(graphs.selectedNode());
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
      body: JSON.stringify(writeGraph(viewport.widget(), viewport.node(), viewport.toJSON())),
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
    setExportModalOpen(false);
    setImportModalOpen((old) => !old);
  };

  const openExportModal = () => {
    setImportModalOpen(false);
    setExportModalOpen((old) => !old);
  };

  const [showNodeActions, setShowNodeActions] = useState(false);

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

  const openGraph = useCallback((graph, selectedNode, roomName, viewportData, example = null, showingUI) => {
    const benchmark = benchmarkFor(graph);
    setInitialSession(null);
    setRoomName(roomName);
    setImportModalOpen(false);
    setNeedsSave(false);
    viewport.container()?.focus();
    graphs.clear();
    measureBenchmark(benchmark, "History serialization", () =>
      graphs.save(graph, selectedNode, viewportData)
    );
    setUndoSize(0);
    setRedoSize(0);
    refresh(!!viewportData?.cam, benchmark);
    if (showingUI === false) viewport.rendering().hideUI();
    if (showingUI === true) viewport.rendering().showUI();
    // Imported files must not reopen an unrelated example or inherit its camera.
    clearExampleSession();
    setExampleSource(example);
    // Consume launch links so refresh follows the source opened most recently.
    const url = new URL(window.location.href);
    url.searchParams.delete("sample");
    if (!roomName) url.searchParams.delete("public");
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [graphs, viewport, refresh]);

  useEffect(() => {
    if (!exampleSource) return;
    return watchExampleSession(viewport, exampleSource);
  }, [viewport, exampleSource]);

  const undo = useCallback(() => {
    graphs.undo();
    refreshUndoCounts();
    if (autopublish && PUBLIC_SERVERS) {
      publish();
    }
    refresh(true);
  }, [autopublish, publish, graphs, refresh, refreshUndoCounts]);

  const redo = useCallback(() => {
    graphs.redo();
    refreshUndoCounts();
    if (autopublish && PUBLIC_SERVERS) {
      publish();
    }
    refresh(true);
  }, [autopublish, publish, graphs, refresh, refreshUndoCounts]);

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
    viewport.setUndo(undo);
    viewport.setRedo(redo);
    viewport.setToggleNodeActions(() => {
      setShowNodeActions((orig) => !orig);
    });
    if (graphs._actionIndex < 0) {
      return;
    }
    const root = graphs.widget();
    viewport.show(root, graphs.viewportData());
    setDocumentInfo(documentState(root));
  }, [graphs, viewport, refresh, autopublish, publish, undo, redo, refreshUndoCounts]);

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
  }, [viewport, setNodeStylingModalOpen, setNodeStyling, graphs, refreshUndoCounts]);

  const updateNodeStyling = (newStyling) => {
    viewport.updateNodeStyle(newStyling);
    graphs.replace(viewport.widget(), viewport.node().id(), viewport);
  };

  const modalRef = useRef();
  useEffect(() => {
    if (!modalRef.current || !nodeStylingModalOpen) {
      return;
    }

    const modal = modalRef.current;
    const mouseUp = () => {
      window.removeEventListener("mousemove", mouseMove, true);
    };
    window.addEventListener("mouseup", mouseUp, false);

    const setPos = (x, y) => {
      modal.style.left = x + "px";
      modal.style.top = y + "px";
    };

    const mouseMove = (e) => {
      setPos(e.clientX, e.clientY);
    };

    modal.addEventListener(
      "mousedown",
      (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") {
          return;
        }
        window.addEventListener("mousemove", mouseMove, true);
      },
      false
    );

    const touchMove = (e) => {
      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        setPos(touch.clientX, touch.clientY);
      }
    };

    const touchEnd = () => {
      window.removeEventListener("touchmove", touchMove, true);
    };
    window.addEventListener("touchend", touchEnd, false);

    modal.addEventListener(
      "touchstart",
      (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") {
          return;
        }
        e.preventDefault();
        window.addEventListener("touchmove", touchMove, true);
      },
      false
    );

    return () => {
      window.removeEventListener("mouseup", mouseUp);
    };
  }, [modalRef, nodeStylingModalOpen]);

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
      console.log(shown);
      setShowingUI(shown);
    });
  }, [viewport, setShowingUI]);

  const goBack = useCallback(() => {
    if (showingUI) {
      window.location.href = "/";
    } else {
      viewport.rendering().showUI();
    }
  }, [showingUI]);

  return (
    <>
      <div className="App">
        <BenchmarkPanel />
        <div
          id="parsegraph"
          style={{ position: "fixed", inset: "0" }}
          ref={canvasRef}
          tabIndex={0}
        />
        {hasWidget && offscreen && (
          <div className="modal">
            <OffscreenModal
              onRecenter={() => {
                viewport.showInCamera();
              }}
            />
          </div>
        )}
        {(!hasWidget || importModalOpen) && (
          <div className="modal">
            <ImportModal
              initialSession={initialSession}
              onClose={hasWidget ? () => setImportModalOpen(false) : null}
              openGraph={openGraph}
            />
          </div>
        )}
        {exportModalOpen && hasWidget && (
          <div className="modal">
            <ExportModal
              viewport={viewport}
              onExport={() => {
                setNeedsSave(false);
              }}
              graph={viewport.widget()}
              onClose={() => setExportModalOpen(false)}
            />
          </div>
        )}
        {nodeStylingModalOpen && hasWidget && (
          <div className="modal" ref={modalRef}>
            <NodeStylingModal
              viewport={viewport}
              style={nodeStyling}
              updateStyle={updateNodeStyling}
              onClose={() => {
                setNodeStylingModalOpen(false);
                viewport.toggleNodeStyling();
              }}
            />
          </div>
        )}
        <div className="AppMenu">
          <div style={{ flexGrow: "1", display: "flex", gap: "5px" }}>
            <button onClick={goBack}>
              &lt;&lt;
            </button>
            {(hasWidget && showingUI) && !showNodeActions && (
              <button tabIndex={0} onClick={openImportModal}>
                Open
              </button>
            )}
            {(hasWidget && showingUI) && (
              <div
                style={{
                  flexGrow: "1",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div className="buttons" style={{ paddingTop: "0" }}>
                  {hasWidget && <>
                    <button onClick={() => viewport.toggleNodeStyling()}>
                      Style
                    </button>
                    <button onClick={() => {
                      viewport.rendering().toggleUI();
                      viewport.refresh();
                    }}>
                      {viewport.rendering().showingUI() ? "View": "Edit" }
                    </button>
                    <button onClick={() => viewport.rendering().toggleSpotlights()}>
                      Spotlights
                    </button>
                    {SHOW_WORLD_LABELS && <button onClick={() => {
                      viewport.rendering().toggleWorldLabels();
                      viewport.refresh();
                    }}>
                      Labels
                    </button>}
                    {PRINT_PAINT_STATS && <button onClick={() => {
                      viewport.rendering().toggleStats();
                      viewport.refresh();
                    }}>
                      Metrics 
                    </button>}
                  </>}
                  {!showNodeActions && hasWidget && (
                    <>
                      <button onClick={() => viewport.showInCamera()}>
                        Re-center
                      </button>
                      <button onClick={() => viewport.moveOutward()}>
                        Outward
                      </button>
                      <button onClick={() => viewport.toggleEditor()}>
                        Node
                      </button>
                    </>
                  )}
                  {showNodeActions && <NodeActions viewport={viewport} />}
                  {!showNodeActions && (
                    <button
                      className="edit"
                      style={{ background: "red", color: "white" }}
                      onClick={() => viewport.removeNode()}
                    >
                      Remove
                    </button>
                  )}
                  {!showNodeActions && (
                    <UndoRedoActions
                      undo={undo}
                      redo={redo}
                      undoSize={undoSize}
                      redoSize={redoSize}
                    />
                  )}
                  {PUBLIC_SERVERS && roomName && (
                    <button
                      onClick={() => {
                        setAutopublish((orig) => {
                          return !orig;
                        });
                      }}
                    >
                      Auto-publish {autopublish ? "ON" : "OFF"}
                    </button>
                  )}
                </div>
                <ParsegraphEditor viewport={viewport} />
              </div>
            )}
            {(hasWidget && showingUI) && !showNodeActions && (
              <button onClick={openExportModal}>Save</button>
            )}
            {(hasWidget && showingUI) && PUBLIC_SERVERS && roomName && (
              <button onClick={() => publish()}>Publish to {roomName}</button>
            )}
          </div>
          {showingUI && <>
          <ParsegraphLog viewport={viewport} />
          <ParsegraphStatus viewport={viewport} />
          </>}
        </div>
        {hasWidget && <div className="navigation-controls">
          <MousePanControls />
          <CameraTravelControls />
          {documentInfo?.version === 1 && <details className="mouse-pan-controls">
            <summary>Document capabilities</summary>
            <div className="mouse-pan-controls-body">
              <p>V1 document. {documentInfo.presentation ? "Presentation applied. " : "Local sizing. "}
                {documentInfo.appearance ? "Appearance applied." : "Local colors."}</p>
              {documentInfo.hasUnsupportedContent && <p>Non-text JSON values are preserved without text labels.</p>}
              {documentInfo.ignoredCapabilities.length > 0 && <p>
                Preserved without interpretation: {documentInfo.ignoredCapabilities.join(", ")}.
                Generation recipes never replace edited nodes automatically.
              </p>}
            </div>
          </details>}
        </div>}
        {!showingUI && <div>
          <button style={{position: 'fixed', bottom: '3px', right: '3px'}} onClick={() => viewport.rendering().toggleUI()}>Edit</button>
        </div>}
      </div>
    </>
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
    viewport.mountLog(logRef.current);
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
    viewport.mountEditor(editorContainerRef.current);
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
    viewport.mountStatus(ref.current);
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

function UndoRedoActions({ undo, redo, undoSize, redoSize }) {
  return (
    <>
      <button onClick={() => undo()}>Undo ({undoSize})</button>
      <button onClick={() => redo()}>Redo ({redoSize})</button>
    </>
  );
}

export default App;
