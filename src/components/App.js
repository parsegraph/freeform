import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";

import { createRoot } from "react-dom/client";

import {
  Direction,
  deserializeParsegraph,
  serializeParsegraph,
} from "parsegraph";
import Viewport from "./Viewport/Viewport";
import ImportModal from "./ImportModal";
import ExportModal from "./ExportModal";
import { PUBLIC_SERVERS, USE_LOCAL_STORAGE } from "../settings";
import NodeStylingModal from "./NodeStylingModal";
import Color from "parsegraph-color";

const sessionId = crypto.randomUUID();

const loadGraph = () => {
  if (!USE_LOCAL_STORAGE) {
    return null;
  }
  try {
    return JSON.parse(localStorage.getItem("parsegraph-graph"));
  } catch (ex) {
    console.log(ex);
    return null;
  }
};

class GraphStack {
  constructor() {
    const loaded = loadGraph();
    if (loaded) {
      this._actions = [loaded];
    } else {
      this._actions = [];
    }
    this._actionIndex = this._actions.length - 1;
  }

  undoCount() {
    return this._actionIndex;
  }

  redoCount() {
    return this._actions.length - (this._actionIndex + 1);
  }

  hasWidget() {
    return this._actionIndex >= 0 && this._actionIndex < this._actions.length;
  }

  widget() {
    if (this.hasWidget()) {
      return deserializeParsegraph(this._actions[this._actionIndex]);
    }
    return null;
  }

  viewportData() {
    if (this.hasWidget()) {
      return this._actions[this._actionIndex].viewport;
    }
    return null;
  }

  selectedNode() {
    if (this.hasWidget()) {
      return this._actions[this._actionIndex].selectedNode;
    }
    return null;
  }

  replace(...saveArgs) {
    this.save(...saveArgs);
    if (this._actionIndex < 1) {
      return;
    }
    this._actions[this._actionIndex - 1] = this._actions[this._actionIndex];
    this._actions.splice(this._actionIndex, 1);
    this._actionIndex--;
  }

  save(newGraph, selectedNode, viewport) {
    const newGraphData = serializeParsegraph(newGraph);
    if (selectedNode) {
      newGraphData.selectedNode =
        typeof selectedNode === "object" ? selectedNode.id() : selectedNode;
    }
    newGraphData.viewport =
      viewport instanceof Viewport ? viewport.toJSON() : viewport;
    if (
      this.hasWidget() &&
      JSON.stringify(this._actions[this._actionIndex]) ===
        JSON.stringify(newGraphData)
    ) {
      return;
    }
    if (this._actionIndex < this._actions.length - 1) {
      this._actions.splice(this._actionIndex + 1);
    }
    this._actions.push(newGraphData);
    this._actionIndex = this._actions.length - 1;
  }

  undo() {
    if (this._actionIndex > 0) {
      --this._actionIndex;
    }
  }

  redo() {
    if (this._actionIndex < this._actions.length - 1) {
      ++this._actionIndex;
    }
  }

  clear() {
    this._actions = [];
    this._actionIndex = -1;
  }
}

const loadRoom = (openGraph, roomName) => {
  return fetch("/public/" + roomName)
    .then((resp) => resp.json())
    .then((roomData) => {
      openGraph(deserializeParsegraph(roomData));
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
      openGraph(deserializeParsegraph(roomData));
    }
  });
};

function App() {
  const [viewport] = useState(new Viewport());
  const [graphs] = useState(new GraphStack());

  const [needsSave, setNeedsSave] = useState(false);

  const [hasWidget, setHasWidget] = useState(false);

  const [autopublish, setAutopublish] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [nodeStylingModalOpen, setNodeStylingModalOpen] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const [roomName, setRoomName] = useState(urlParams.get("public"));
  const [sampleName, setSampleName] = useState(urlParams.get("sample"));

  const refresh = useCallback(
    (dontTouchCamera) => {
      setHasWidget(graphs.hasWidget());
      if (graphs.hasWidget()) {
        viewport.show(graphs.widget(), graphs.viewportData());
        viewport.moveToId(graphs.selectedNode());
        if (!dontTouchCamera) {
          viewport.showInCamera();
        }
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
    // TODO this won't serialize colors
    fetch("/public/" + roomName + "?sid=" + sessionId, {
      body: JSON.stringify(serializeParsegraph(graphs.widget())),
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
      graphs.save(deserializeParsegraph(JSON.parse(e.data)));
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

  const refreshUndoCounts = () => {
    setUndoSize(graphs.undoCount());
    setRedoSize(graphs.redoCount());
  };

  const resetUndoCounts = () => {
    setUndoSize(0);
    setRedoSize(0);
  };

  const undo = useCallback(() => {
    graphs.undo();
    refreshUndoCounts();
    if (autopublish && PUBLIC_SERVERS) {
      publish();
    }
    refresh(true);
  }, [autopublish, publish, graphs, refresh]);

  const redo = useCallback(() => {
    graphs.redo();
    refreshUndoCounts();
    if (autopublish && PUBLIC_SERVERS) {
      publish();
    }
    refresh(true);
  }, [autopublish, publish, graphs, refresh]);

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
    viewport.show(graphs.widget(), graphs.viewportData());
  }, [graphs, viewport, refresh, autopublish, publish, undo, redo]);

  useEffect(() => {
    if (autopublish) {
      return;
    }
    if (!needsSave) {
      window.onbeforeunload = null;
      return;
    }

    window.onbeforeunload = () => {
      return "Are you sure you want to lose your unexported changes?";
    };
  }, [needsSave, autopublish]);

  const [nodeStyling, setNodeStyling] = useState(null);

  useEffect(() => {
    if (!viewport) {
      return;
    }
    viewport.setToggleNodeStyling((showingStyling) => {
      if (showingStyling) {
        graphs.save(graphs.widget(), viewport.node().id(), viewport);
        refreshUndoCounts();
        setNodeStyling({
          ...viewport.getNodeStyle(),
          pageBackgroundColor: viewport
            .rendering()
            .pageBackgroundColor()
            .asHex(),
        });
      }
      setNodeStylingModalOpen(showingStyling);
    });
  }, [viewport, setNodeStylingModalOpen, setNodeStyling]);

  const updateNodeStyling = (newStyling) => {
    if (newStyling.pageBackgroundColor) {
      viewport
        .rendering()
        .setPageBackgroundColor(Color.fromHex(newStyling.pageBackgroundColor));
      delete newStyling.pageBackgroundColor;
      viewport.refresh();
    }
    viewport.updateNodeStyle(newStyling);
    graphs.replace(graphs.widget(), viewport.node().id(), viewport);
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
  }, [canvasRef, viewport]);

  return (
    <>
      <div className="App">
        <div
          id="parsegraph"
          style={{ position: "fixed", inset: "0" }}
          ref={canvasRef}
          tabIndex={0}
        />
        {(!hasWidget || importModalOpen) && (
          <div className="modal">
            <ImportModal
              sampleName={sampleName}
              onClose={hasWidget ? () => setImportModalOpen(false) : null}
              openGraph={(graph, selectedNode, roomName, viewportData) => {
                setSampleName(null);
                setRoomName(roomName);
                if (canvasRef.current) {
                  canvasRef.current.focus();
                }
                graphs.clear();
                graphs.save(graph, selectedNode, viewportData);
                resetUndoCounts();
                refresh(!!viewportData?.cam);
              }}
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
              graph={graphs.widget()}
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
            <button onClick={(e) => (window.location.href = "/")}>
              &lt;&lt;
            </button>
            {hasWidget && !showNodeActions && (
              <button tabIndex={0} onClick={openImportModal}>
                Open
              </button>
            )}
            {hasWidget && (
              <div
                style={{
                  flexGrow: "1",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div className="buttons" style={{ paddingTop: "0" }}>
                  {hasWidget && (
                    <button onClick={() => viewport.toggleNodeStyling()}>
                      Style
                    </button>
                  )}
                  {!showNodeActions && hasWidget && (
                    <>
                      <button onClick={() => viewport.showInCamera()}>
                        Re-center
                      </button>
                      <button onClick={() => viewport.moveOutward()}>
                        Outward
                      </button>
                      <button onClick={() => viewport.toggleEditor()}>
                        Edit
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
            {hasWidget && !showNodeActions && (
              <button onClick={openExportModal}>Save</button>
            )}
            {PUBLIC_SERVERS && roomName && (
              <button onClick={() => publish()}>Publish to {roomName}</button>
            )}
          </div>
          <ParsegraphLog viewport={viewport} />
          <ParsegraphStatus viewport={viewport} />
        </div>
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
