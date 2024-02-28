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

const addExtension = (name, ext) => {
  if (name.endsWith(ext)) {
    return name;
  }
  if (name.endsWith(".")) {
    if (ext.startsWith(".")) {
      return name + ext.substring(1);
    }
    return name + ext;
  }
  if (ext.startsWith('.')) {
    return name + ext;
  }
  return name + '.' + ext;
};

function ExportForm({graph, onExport, onClose}) {
  const [exportType, setExportType] = useState("parsegraph");
  const [name, setName] = useState(graph.value() ?? "graph");

  const performExport = ()=> {
    try {
    switch(exportType) {
      case "lisp":
        const tokens = [];
        exporters.exportGraphToLisp(graph, tokens);
        download(addExtension(name, ".lisp"), tokens.join(''));
        break;
      case "json":
        download(addExtension(name, ".json"), JSON.stringify(exporters.exportGraphToJson(graph)));
        break;
      case "parsegraph":
        download(addExtension(name, ".parsegraph"), JSON.stringify(serializeParsegraph(graph)));
        break;
      case "words":
        download(addExtension(name, ".txt"), exporters.exportGraphToWords(graph));
        break;
      case "lines":
        download(addExtension(name, ".txt"), exporters.exportGraphToLines(graph));
        break;
      case "public":
        if (!PUBLIC_SERVERS) {
          throw new Error("Public servers not accessible");
        }
        fetch('/public/' + name, {
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
  } catch (ex) {
    alert(ex);
    console.log(ex);
  }
    if (onClose) {
      onClose();
    }
  };

  return <form onSubmit={e=>{
    e.preventDefault();
    performExport();
  }} style={{display: 'flex', flexDirection: 'column', gap: '3px'}}>
  <label style={{display: 'flex', gap: '5px'}}>Name:&nbsp;
    <input style={{flexGrow: '1'}} value={name} onChange={e => setName(e.target.value)}/>
  </label>
  <label style={{display: 'flex', gap:'5px'}}>Format: <select style={{flexGrow:'1'}} value={exportType} onChange={e=>setExportType(e.target.value)}>
    <option value="parsegraph">Parsegraph</option>
    <option value="words">Words</option>
    <option value="lines">Lines</option>
    <option value="lisp">Lisp</option>
    <option value="json">JSON</option>
    {PUBLIC_SERVERS && <option value="public">Public</option>}
  </select>
  </label>
  <div className="buttons">
    <input type="submit" onClick={performExport} value="Save"/>
    <button onClick={onClose}>Cancel</button>
  </div></form>;
}

export default function ExportModal({onExport, onClose, graph}) {
  const [activeTab, setActiveTab] = useState("export");

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '12px', boxSizing: 'border-box'}}>
    <h3 style={{margin: '0', marginBottom: '.5em'}}>Save Parsegraph</h3>
    {activeTab === "export" && <ExportForm graph={graph} onExport={onExport} onClose={onClose}/>}
  </div>
};
