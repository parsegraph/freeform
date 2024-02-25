import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

import { 
  Direction,
  DirectionNode, deserializeParsegraph, serializeParsegraph,
} from "parsegraph";
import Viewport from './Viewport';
import ImportModal from './ImportModal';
import ExportModal from './ExportModal';
import { USE_LOCAL_STORAGE } from './settings';

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

function App() {
  const canvasRef = useRef();
  const editorContainerRef = useRef();
  const logRef = useRef();

  const [viewport] = useState(new Viewport());
  const [graphs] = useState(new GraphStack());

  const refresh = useCallback(() => {
    setHasWidget(graphs.hasWidget());
    if (graphs.hasWidget()) {
      viewport.show(graphs.widget());
      viewport.moveToId(graphs.selectedNode());
      viewport.showInCamera();
    }
  }, [viewport, graphs]);

  const [hasWidget, setHasWidget] = useState(false);


  useEffect(() => {
    if (!graphs) {
      return;
    }
    loadInitialRoom((graph, selectedNode) => {
      graphs.save(graph, selectedNode);
      refresh();
    });
  }, [graphs, refresh]);

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

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
      return;
    }
    viewport.mount(canvasRef.current);
    if (!graphs) {
      return;
    }
    viewport.setSaveGraph((graph, selectedNode)=>graphs.save(graph, selectedNode));
    viewport.setUndo(()=>{
      graphs.undo();
      refresh();
    });
    viewport.setRedo(()=>{
      graphs.redo();
      refresh();
    });
    viewport.setToggleNodeActions(() => {
      setShowNodeActions(orig=>!orig);
    });
    if (graphs._actionIndex < 0) {
      return;
    }
    viewport.show(graphs.widget());
  }, [graphs, canvasRef, viewport, refresh])

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const openImportModal = () => {
    setExportModalOpen(false);
    setImportModalOpen(old=>!old);
  }

  const openExportModal = () => {
    setImportModalOpen(false);
    setExportModalOpen(old=>!old);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const roomName = urlParams.get("public");

  return (
    <div className="App">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: "100%", height: "100%"}} ref={canvasRef}/>
      <div style={{position: 'absolute', top: '3px', left: '3px', right: '3px', display: 'flex', gap: '2px', flexDirection: 'column'}}>
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
            </>}
            <button onClick={()=>{graphs.undo();refresh()}}>Undo</button>
            <button onClick={()=>{graphs.redo();refresh();}}>Redo</button>
          </div>
          <div ref={editorContainerRef}>
          </div>
        </div>}
        {hasWidget && <button onClick={openExportModal}>Export</button>}
        {roomName && <button onClick={() => {
                 fetch('/public/' + roomName, {
          body: JSON.stringify(serializeParsegraph(graphs.widget())),
          headers: {
            "Content-Type": "application/json"
          },
          method: 'POST'
        }).then(resp=>{
          viewport.logMessage("Saved to " + roomName);
        }).catch(ex => {
          console.log(ex);
          viewport.logMessage("Failed to save");
        }); 
        }}>Publish to {roomName}</button>}
        </div>
        <div id="log" ref={logRef}/>
      </div>
      {(!hasWidget || importModalOpen) && <div className="modal">
        <ImportModal onClose={hasWidget ? () => setImportModalOpen(false) : null} openGraph={(graph, selectedNode)=>{
          graphs.save(graph, selectedNode);
          refresh();
        }}/>
      </div>}
      {(exportModalOpen && hasWidget) && <div className="modal">
        <ExportModal graph={graphs.widget()} onClose={() => setExportModalOpen(false)}/>
      </div>}
    </div>
  );
}

export default App;
