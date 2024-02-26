import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

import { 
  Direction, deserializeParsegraph, serializeParsegraph,
} from "parsegraph";
import Viewport from './Viewport';
import ImportModal from './ImportModal';
import ExportModal from './ExportModal';
import { USE_LOCAL_STORAGE } from './settings';

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

  hasWidget() {
    return this._actionIndex >= 0 && this._actionIndex < this._actions.length;
  }

  widget() {
    if (this.hasWidget()) {
      return deserializeParsegraph(this._actions[this._actionIndex]);
    }
    return null;
  }

  selectedNode() {
    if (this.hasWidget()) {
      return this._actions[this._actionIndex].selectedNode;
    }
    return null;
  }

  save(newGraph, selectedNode) {
    const newGraphData = serializeParsegraph(newGraph);
    if (selectedNode) {
      newGraphData.selectedNode = typeof selectedNode === "object" ? selectedNode.id() : selectedNode;
    }
    if (this.hasWidget() && JSON.stringify(this._actions[this._actionIndex]) === JSON.stringify(newGraphData)) {
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
}

const loadRoom = (openGraph, roomName) => {
  return fetch("/public/" + roomName).then(resp=>resp.json()).then(roomData =>{
    openGraph(deserializeParsegraph(roomData));
  });
}

let initialRoom
const loadInitialRoom = (openGraph) => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomName = urlParams.get("public");
  if (!roomName) {
    return;
  }
  if (!initialRoom) {
    initialRoom = loadRoom(openGraph, roomName);
  }
  return initialRoom.then(roomData => {
    if (roomData) {
      openGraph(deserializeParsegraph(roomData));
    }
  });
}

function AppMenu({hasWidget, openImportModal, viewport, showNodeActions, undo, redo, setAutopublish, autopublish, editorContainerRef, openExportModal, roomName, publish, logRef}) {
  return <div className="AppMenu">
      <div style={{flexGrow: '1', display: 'flex', gap: '5px'}}>
      {hasWidget && <button tabIndex={0} onClick={openImportModal}>Open</button>}
      {hasWidget && <div style={{flexGrow: '1', display: 'flex', flexDirection: 'column'}}>
        <div className="buttons" style={{paddingTop: '0'}}>
          <button onClick={()=>viewport.showInCamera()}>Re-center</button>
          {(!showNodeActions && hasWidget) && <button onClick={()=>viewport.toggleEditor()}>Edit</button>}
          {showNodeActions && <>
            <button className="edit" onClick={()=>viewport.toggleAlignment()}>Align</button>
            <button className="edit" onClick={()=>viewport.togglePreferredAxis()}>Preferred Axis</button>
            <button className="edit" onClick={()=>viewport.toggleNodeScale()}>Scale</button>
            <button className="edit" onClick={()=>viewport.toggleNodeFit()}>Fit</button>
            <button className="edit" onClick={()=>viewport.pullNode()}>Pull</button>
            <button className="edit" onClick={()=>viewport.removeNode()}>Remove</button>
          </>}
          {(!showNodeActions && hasWidget) && <>
            <button className="dir" onClick={()=>viewport.spawnMove(Direction.INWARD)}>Inward</button>
            <button className="dir" onClick={()=>viewport.spawnMove(Direction.DOWNWARD)}>Downward</button>
            <button className="dir" onClick={()=>viewport.spawnMove(Direction.FORWARD)}>Forward</button>
            <button className="dir" onClick={()=>viewport.spawnMove(Direction.BACKWARD)}>Backward</button>
            <button className="dir" onClick={()=>viewport.spawnMove(Direction.UPWARD)}>Upward</button>
            <button className="dir" onClick={()=>viewport.moveOutward()}>Outward</button>
          </>}
          <button onClick={()=>undo()}>Undo</button>
          <button onClick={()=>redo()}>Redo</button>
          {roomName && <button onClick={()=>{setAutopublish(orig=>{
            return !orig
          })}}>Auto-publish {autopublish ? "ON" : "OFF"}</button>}
        </div>
        <div ref={editorContainerRef}>
        </div>
      </div>}
      {hasWidget && <button onClick={openExportModal}>Save</button>}
      {roomName && <button onClick={() => publish()}>Publish to {roomName}</button>}
      </div>
      <div id="log" ref={logRef}/>
    </div>
}

function App() {
  const canvasRef = useRef();
  const editorContainerRef = useRef();
  const logRef = useRef();

  const [viewport] = useState(new Viewport());
  const [graphs] = useState(new GraphStack());

  const [needsSave, setNeedsSave] = useState(false);

  const [hasWidget, setHasWidget] = useState(false);


  const [autopublish, setAutopublish] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const urlParams = new URLSearchParams(window.location.search);
  const [roomName, setRoomName] = useState(urlParams.get("public"));
  const [sampleName, setSampleName] = useState(urlParams.get("sample"));

  const refresh = useCallback((dontTouchCamera) => {
    setHasWidget(graphs.hasWidget());
    if (graphs.hasWidget()) {
      viewport.show(graphs.widget());
      viewport.moveToId(graphs.selectedNode());
      if (!dontTouchCamera) {
        viewport.showInCamera();
      }
    }
  }, [viewport, graphs]);

  const publish = useCallback(() => {
    if (!roomName) {
      return;
    }
    fetch('/public/' + roomName + "?sid=" + sessionId, {
      body: JSON.stringify(serializeParsegraph(graphs.widget())),
      headers: {
        "Content-Type": "application/json"
      },
      method: 'POST'
    }).then(resp=>{
      viewport.logMessage("Saved to " + roomName);
      setNeedsSave(false);
    }).catch(ex => {
      console.log(ex);
      viewport.logMessage("Failed to save");
    }); 
  }, [graphs, roomName, viewport]);

  const openImportModal = () => {
    setExportModalOpen(false);
    setImportModalOpen(old=>!old);
  }

  const openExportModal = () => {
    setImportModalOpen(false);
    setExportModalOpen(old=>!old);
  }

  useEffect(() => {
    if (!autopublish) {
      return;
    }
    if (!roomName) {
      return;
    }
    const es = new EventSource("/public/" + roomName + "?sid=" + sessionId)
    es.onmessage = e => {
      const selectedNode = viewport._userCaret.node().id();
      graphs.save(deserializeParsegraph(JSON.parse(e.data)));
      refresh(true);
      viewport.moveToId(selectedNode);
    };
    es.onerror = () => {
      setAutopublish(false);
    }
    return () => {
      es.close();
    }
  }, [autopublish, graphs, refresh, roomName, viewport]);

  useEffect(() => {
    if (!graphs) {
      return;
    }
    loadInitialRoom((graph, selectedNode) => {
      if (selectedNode || autopublish) {
        graphs.save(graph, selectedNode);
        refresh(true);
      }
    });
  }, [autopublish, graphs, refresh]);

  const [showNodeActions, setShowNodeActions] = useState(false);

  useEffect(() => {
    if (!viewport) {
      return;
    }
    if (!logRef.current) {
      return;
    }
    viewport.mountLog(logRef.current);
  })

  useEffect(() => {
    if (!viewport) {
      return;
    }
    if (!editorContainerRef.current) {
      return;
    }
    viewport.mountEditor(editorContainerRef.current);
  }, [viewport, editorContainerRef, hasWidget]);

  const undo = useCallback(() => {
    graphs.undo();
    if (autopublish) {
      publish();
    }
    refresh();
  }, [autopublish, publish, graphs, refresh]);

  const redo = useCallback(() => {
    graphs.redo();
    if (autopublish) {
      publish();
    }
    refresh();
  }, [autopublish, publish, graphs, refresh]);

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
      return;
    }
    viewport.mount(canvasRef.current);
    if (!graphs) {
      return;
    }
    viewport.setSaveGraph((graph, selectedNode)=>{
      graphs.save(graph, selectedNode);
      if (autopublish) {
        publish();
      } else {
        setNeedsSave(true);
      }
    });
    viewport.setUndo(undo);
    viewport.setRedo(redo);
    viewport.setToggleNodeActions(() => {
      setShowNodeActions(orig=>!orig);
    });
    if (graphs._actionIndex < 0) {
      return;
    }
    viewport.show(graphs.widget());
  }, [graphs, canvasRef, viewport, refresh, autopublish, publish, undo, redo])
  
  useEffect(() => {
    if (autopublish) {
      return;
    }
    if (!needsSave) {
      window.onbeforeunload = null;
      return;
    }

    window.onbeforeunload = () => {
      return 'Are you sure you want to lose your unexported changes?';
    };
  }, [needsSave, autopublish]);

  return (<>
  <div className="App">
      <div style={{position: 'fixed', inset: '0'}} ref={canvasRef}/>
      {(!hasWidget || importModalOpen) && <div className="modal">
        <ImportModal sampleName={sampleName} onClose={hasWidget ? () => setImportModalOpen(false) : null} openGraph={(graph, selectedNode, roomName)=>{
          setSampleName(null);
          setRoomName(roomName);
          graphs.save(graph, selectedNode);
          refresh();
        }}/>
      </div>}
      {(exportModalOpen && hasWidget) && <div className="modal">
        <ExportModal onExport={() => {
          setNeedsSave(false);
        }} graph={graphs.widget()} onClose={() => setExportModalOpen(false)}/>
      </div>}
    </div>
    <AppMenu 
      publish={publish}
      editorContainerRef={editorContainerRef}
      logRef={logRef}
      hasWidget={hasWidget}
      openImportModal={openImportModal}
      openExportModal={openExportModal}
      viewport={viewport}
      undo={undo}
      redo={redo}
      showNodeActions={showNodeActions}
      roomName={roomName}
      autopublish={autopublish}
      setAutopublish={setAutopublish}
    />
    </>
  );
}

export default App;
