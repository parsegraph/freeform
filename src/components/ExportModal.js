import { useState } from 'react';

import * as exporters from '../exporters';
import { serializeParsegraph } from 'parsegraph';

import SettingsForm from './SettingsForm';

import "./modal.css";
import { PUBLIC_SERVERS } from '../settings';

function download(filename, text) {
  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

function ExportForm({graph, onExport, onClose}) {
  const [exportType, setExportType] = useState("parsegraph");
  const [roomName, setRoomName] = useState(graph.value());

  const performExport = ()=> {
    switch(exportType) {
      case "lisp":
        const tokens = [];
        exporters.exportGraphToLisp(graph, tokens);
        download("parsegraph.lisp", tokens.join(''));
        break;
      case "json":
        download("parsegraph.json", JSON.stringify(exporters.exportGraphToJson(graph)));
        break;
      case "parsegraph":
        download("graph.parsegraph", JSON.stringify(serializeParsegraph(graph)));
        break;
      case "words":
        download("parsegraph-words.txt", exporters.exportGraphToWords(graph));
        break;
      case "lines":
        download("parsegraph-lines.txt", exporters.exportGraphToLines(graph));
        break;
      case "public":
        if (!PUBLIC_SERVERS) {
          throw new Error("Public servers not accessible");
        }
        fetch('/public/' + roomName, {
          body: JSON.stringify(serializeParsegraph(graph)),
          headers: {
            "Content-Type": "application/json"
          },
          method: 'POST'
        }).then(resp=>{
          console.log(resp);
        });
        break;
      default:
        throw new Error("Unsupported export type: " + exportType)
    }
    if (onExport) {
      onExport();
    }
    if (onClose) {
      onClose();
    }
  };

  return <><label style={{display: 'flex', gap:'5px'}}>Format: <select style={{flexGrow:'1'}} value={exportType} onChange={e=>setExportType(e.target.value)}>
    <option value="parsegraph">Parsegraph</option>
    <option value="words">Words</option>
    <option value="lines">Lines</option>
    <option value="lisp">Lisp</option>
    <option value="json">JSON</option>
    {PUBLIC_SERVERS && <option value="public">Public</option>}
  </select>
  </label>
  {exportType === "public" && <label style={{display: 'flex', gap: '5px'}}>Name:&nbsp;
    <input style={{flexGrow: '1'}} value={roomName} onChange={e => setRoomName(e.target.value)}/>
  </label>
  }
  <div className="buttons">
    <button onClick={performExport}>Save</button>
    <button onClick={onClose}>Cancel</button>
  </div></>;
}

export default function ExportModal({onExport, onClose, graph}) {
  const [activeTab, setActiveTab] = useState("export");

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '12px', boxSizing: 'border-box'}}>
    <h3 style={{margin: '0', marginBottom: '.5em'}}>Save Parsegraph</h3>
    {activeTab === "export" && <ExportForm graph={graph} onExport={onExport} onClose={onClose}/>}
  </div>
};
