import { useState } from 'react';

import { DirectionNode, deserializeParsegraph } from 'parsegraph';

import * as importers from './importers';

import './modal.css';

function ImportFromFile({openGraph, onClose}) {
  const [importData, setImportData] = useState(null);
  const [importType, setImportType] = useState("words");

  const performImport = ()=> {
    try {
    switch(importType) {
      case "words":
        openGraph(importers.graphWords(importData));
        break;
      case "lisp":
        openGraph(importers.graphLisp(importData));
        break;
      case "json":
        openGraph(importers.graphJson(JSON.parse(importData)));
        break;
      case "parsegraph":
        openGraph(deserializeParsegraph(JSON.parse(importData)));
        break;
      case "lines":
        openGraph(importers.graphLines(importData));
        break;
      default:
        throw new Error("Unsupported import type: " + importType)
    }
  } catch (ex) {
    console.log(ex);
    alert (ex);
  }
    onClose();
  };

  return <><label>Import: <input type="file" onChange={e=>{
    for (const file of e.target.files) {
      file.text().then(content=>{
        setImportData(content);
      });
    }
  }}/>
  </label>
  <label style={{display: 'flex', gap:'5px'}}>Format: <select style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}>
    <option value="words">Words</option>
    <option value="parsegraph">Parsegraph</option>
    <option value="lines">Lines</option>
    <option value="lisp">Lisp</option>
    <option value="json">JSON</option>
  </select>
  </label>
  <div className="buttons">
    <button style={{flexGrow:'1'}} onClick={performImport}>Import</button>
    <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>
  </div></>;
}

function ImportFromTemplate({openGraph, onClose}) {
  const [importType, setImportType] = useState("blank");

  const createFromTemplate = () => {
    switch(importType) {
      case "blank":
        openGraph(new DirectionNode());
        break;
      default:
        openGraph(new DirectionNode("Unknown import type: " + importType));
        break;
    }
    onClose();
  };

  return <>
   <label style={{display: 'flex', gap:'5px'}}>Format: <select style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}>
    <option value="blank">Blank</option>
    <option value="unknown">unknown</option>
  </select>
  </label> 
  <div className="buttons">
    <button style={{flexGrow:'1'}} onClick={createFromTemplate}>Create</button>
    <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>
  </div></>;
}

export default function ImportModal({onClose, openGraph}) {

  const [activeTab, setActiveTab] = useState("import");

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '12px', boxSizing: 'border-box'}}>
    <h3 style={{margin: '0', marginBottom: '.5em'}}>Open Parsegraph</h3>
    <div className="tabs" style={{display: 'flex', gap:'5px'}}>
      <div className={activeTab === "template" ? "active" : null} onClick={()=>{
        setActiveTab("template");
      }}>Template</div>
      <div className={activeTab === "import" ? "active" : null} onClick={()=>{
        setActiveTab("import");
      }}>Import</div>
    </div>
    {activeTab === "template" && <ImportFromTemplate openGraph={openGraph} onClose={onClose}/>}
    {activeTab === "import" && <ImportFromFile openGraph={openGraph} onClose={onClose}/>}
  </div>
}
