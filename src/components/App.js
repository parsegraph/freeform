import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

import { 
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

  save(newGraph) {
    const newGraphData = serializeParsegraph(newGraph);
    console.log("Save action", newGraphData);
    if (this._actionIndex < this._actions.length - 1) {
      console.log(this._actions);
      this._actions.splice(this._actionIndex + 1);
      console.log(this._actions);
    }
    this._actions.push(newGraphData);
    this._actionIndex = this._actions.length - 1;
  }

  undo() {
    if (this._actionIndex > 0) {
      --this._actionIndex;
      console.log("Undo action", this._actions[this._actionIndex]);
    }
  }

  redo() {
    if (this._actionIndex < this._actions.length - 1) {
      ++this._actionIndex;
      console.log("Redo action", this._actions[this._actionIndex]);
    }
  }
}

function App() {
  const canvasRef = useRef();
  const editorContainerRef = useRef();
  const logRef = useRef();

  const [viewport] = useState(new Viewport());
  const [graphs] = useState(new GraphStack());

  const [hasWidget, setHasWidget] = useState(false);

  const refresh = useCallback(() => {
    setHasWidget(graphs.hasWidget());
    if (graphs.hasWidget()) {
      viewport.show(graphs.widget());
      viewport.showInCamera();
    }
  }, [viewport, graphs]);

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
    viewport.setSaveGraph(graph=>graphs.save(graph));
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

  return (
    <div className="App">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: "100%", height: "100%"}} ref={canvasRef}/>
      <div style={{position: 'absolute', top: '3px', left: '3px', right: '3px', display: 'flex', gap: '2px', flexDirection: 'column'}}>
        <div style={{flexGrow: '1', display: 'flex', gap: '5px'}}>
        {hasWidget && <button onClick={openImportModal}>Open</button>}
        {hasWidget && <div style={{flexGrow: '1', display: 'flex', flexDirection: 'column'}}>
          <div className="buttons" style={{paddingTop: '0'}}>
            <button onClick={()=>viewport.showInCamera()}>Re-center</button>
            {(!showNodeActions && hasWidget) && <button onClick={()=>viewport.toggleEditor()}>Edit</button>}
            {showNodeActions && <>
              <button onClick={()=>viewport.toggleAlignment()}>Align</button>
              <button onClick={()=>viewport.togglePreferredAxis()}>Preferred Axis</button>
              <button onClick={()=>viewport.toggleNodeScale()}>Scale</button>
              <button onClick={()=>viewport.toggleNodeFit()}>Fit</button>
              <button onClick={()=>viewport.pullNode()}>Pull</button>
              <button onClick={()=>viewport.removeNode()}>Remove</button>
            </>}
            <button onClick={()=>{graphs.undo();viewport.show(graphs.widget());}}>Undo</button>
            <button onClick={()=>{graphs.redo();viewport.show(graphs.widget());}}>Redo</button>
          </div>
          <div ref={editorContainerRef}>
          </div>
        </div>}
        {hasWidget && <button onClick={openExportModal}>Export</button>}
        </div>
        <div id="log" ref={logRef}/>
      </div>
      {(!hasWidget || importModalOpen) && <div className="modal">
        <ImportModal onClose={hasWidget ? () => setImportModalOpen(false) : null} openGraph={graph=>{
          graphs.save(graph);
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
