import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

import { 
  DirectionNode,
} from "parsegraph";
import Viewport from './Viewport';
import ImportModal from './ImportModal';
import ExportModal from './ExportModal';

const buildGraph = () => {
  return new DirectionNode();
};

function App() {
  const canvasRef = useRef();

  const [widget, setWidget] = useState(buildGraph());
  const [viewport] = useState(new Viewport());

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
      return;
    }
    if (!widget) {
      return;
    }
    viewport.mount(canvasRef.current);
    viewport.show(widget);
  }, [widget, canvasRef, viewport])

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const openImportModal = () => {
    setImportModalOpen(true);
  }

  const openExportModal = () => {
    setExportModalOpen(true);
  }

  return (
    <div className="App">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: "100%", height: "100%", overflow: "hidden"}} ref={canvasRef}/>
      <div style={{position: 'absolute', top: '3px', left: '3px', display: 'flex', gap: '3px'}}>
        <button onClick={openImportModal}>Import</button>
      </div>
      <div style={{position: 'absolute', top: '3px', right: '3px'}}>
        <button onClick={openExportModal}>Export</button>
      </div>
      {importModalOpen && <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'lightblue', padding: '24px', borderRadius: '6px'}}>
        <ImportModal onClose={() => setImportModalOpen(false)} openGraph={setWidget}/>
      </div>}
      {exportModalOpen && <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'lightyellow', padding: '24px', borderRadius: '6px'}}>
        <ExportModal graph={widget} onClose={() => setExportModalOpen(false)}/>
      </div>}
    </div>
  );
}

export default App;
