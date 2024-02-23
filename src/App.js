import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

import { 
  DirectionNode, deserializeParsegraph, serializeParsegraph,
} from "parsegraph";
import Viewport from './Viewport';
import ImportModal from './ImportModal';
import ExportModal from './ExportModal';

const loadGraph = () => {
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

  widget() {
    console.log(this._actionIndex);
    return deserializeParsegraph(this._actions[this._actionIndex]);
  }

  save(newGraph) {
    const newGraphData = serializeParsegraph(newGraph);
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

function App() {
  const canvasRef = useRef();

  const [viewport] = useState(new Viewport());
  const [graphs] = useState(new GraphStack());

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
      return;
    }
    if (!graphs || graphs._actionIndex < 0) {
      return;
    }
    viewport.setSaveGraph(graph=>graphs.save(graph));
    viewport.setUndo(()=>{
      graphs.undo();
      viewport.show(graphs.widget());
    });
    viewport.setRedo(()=>{
      graphs.redo();
      viewport.show(graphs.widget());
    });
    viewport.mount(canvasRef.current);
    viewport.show(graphs.widget());
  }, [graphs, canvasRef, viewport])

  const [importModalOpen, setImportModalOpen] = useState(graphs._actionIndex < 0);
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
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: "100%", height: "100%", overflow: "hidden"}} ref={canvasRef}/>
      <div style={{position: 'absolute', top: '3px', left: '3px'}}>
        <button onClick={openImportModal}>Open...</button>
      </div>
      <div style={{position: 'absolute', top: '3px', left: '50%', transform: 'translate(-50%, 0)'}}>
        <button onClick={()=>viewport.showInCamera()}>Re-center</button>
        <button onClick={()=>viewport.toggleEditor()}>Edit</button>
        <button onClick={()=>viewport.toggleAlignment()}>Align</button>
        <button onClick={()=>viewport.togglePreferredAxis()}>Preferred Axis</button>
        <button onClick={()=>viewport.toggleNodeScale()}>Scale</button>
        <button onClick={()=>viewport.toggleNodeFit()}>Fit</button>
        <button onClick={()=>viewport.pullNode()}>Pull</button>
        <button onClick={()=>viewport.removeNode()}>Remove</button>
        <button onClick={()=>{graphs.undo();viewport.show(graphs.widget());}}>Undo</button>
        <button onClick={()=>{graphs.redo();viewport.show(graphs.widget());}}>Redo</button>
      </div>
      <div style={{position: 'absolute', top: '3px', right: '3px'}}>
        <button onClick={openExportModal}>☰</button>
      </div>
      {importModalOpen && <div className="modal">
        <ImportModal onClose={() => setImportModalOpen(false)} openGraph={graph=>graphs.save(graph)}/>
      </div>}
      {exportModalOpen && <div className="modal">
        <ExportModal graph={graphs.widget()} onClose={() => setExportModalOpen(false)}/>
      </div>}
    </div>
  );
}

export default App;
