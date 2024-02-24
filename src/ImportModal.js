import { useState } from 'react';

import { DirectionCaret, DirectionNode, deserializeParsegraph } from 'parsegraph';

import * as importers from './importers';

import './modal.css';

const SIZE = 25;

const buildGrid = () => {
  const car = new DirectionCaret();
  for(let col = 0; col < SIZE; ++col) {
    car.spawnMove('d', col);
    car.push();
    for(let row = 0; row < SIZE; ++row) {
      car.spawnMove('f', row);
    }
    car.pop();
  }
  return car.root();
};

const buildAlternatingColumns = () => {
  const car = new DirectionCaret();
  for(let col = 0; col < SIZE; ++col) {
    car.spawnMove('f', col);
    car.push();
    for(let row = 0; row < SIZE; ++row) {
      car.spawnMove(col % 2 !== 0 ? 'u' : 'd', row);
    }
    car.pop();
  }
  return car.root();
}

const buildPlanner = (inc = 15) => {
  const car = new DirectionCaret();
  for(let hour = 0; hour < 24; ++hour) {
    for(let min = 0; min < 60; min += inc) {
      let str = "";
      if (hour === 0 || hour === 12) {
        str += 12;
      } else if (hour < 12) {
        str += (hour);
      } else {
        str += (hour - 12);
      }
      str += ":";
      if (min < 10) {
        str += "0" + min;
      } else {
        str += min;
      }
      str += " " + (hour >= 12 ? "PM" : "AM");
      car.spawnMove('d', str);
    }
  }
  return car.root();
}

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
    if (onClose) {
      onClose();
    }
  };

  return <><label>File: <input type="file" style={{maxWidth: '200px'}} onChange={e=>{
    for (const file of e.target.files) {
      file.text().then(content=>{
        setImportData(content);
      });
    }
  }}/>
  </label>
  <label style={{display: 'flex', gap:'5px'}}>Type: <select style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}>
    <option value="words">Words</option>
    <option value="parsegraph">Parsegraph</option>
    <option value="lines">Lines</option>
    <option value="lisp">Lisp</option>
    <option value="json">JSON</option>
  </select>
  </label>
  <div className="buttons">
    <button style={{flexGrow:'1'}} onClick={performImport}>Import</button>
    {onClose && <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>}
  </div></>;
}

function ImportFromTemplate({openGraph, onClose}) {
  const [importType, setImportType] = useState("blank");

  const createFromTemplate = () => {
    switch(importType) {
      case "blank":
        openGraph(new DirectionNode());
        break;
      case "lisp":
        fetch("/surface.lisp")
          .then(resp=>resp.text())
          .then(text=>{
            openGraph(importers.graphLisp(text));
          });
        break;
      case "json":
        fetch("/package.json")
          .then(resp=>resp.text())
          .then(text=>{
            openGraph(importers.graphJson(JSON.parse(text)));
          });
        break;
      case "grid":
        openGraph(buildGrid());
        break;
      case "daily_planner_15":
        openGraph(buildPlanner(15));
        break;
      case "daily_planner_30":
        openGraph(buildPlanner(30));
        break;
      case "daily_planner_60":
        openGraph(buildPlanner(60));
        break;
      case "alt_columns":
        openGraph(buildAlternatingColumns());
        break;
      default:
        openGraph(new DirectionNode("Unknown import type: " + importType));
        break;
    }
    if (onClose) {
      onClose();
    }
  };

  return <>
   <label style={{display: 'flex', gap:'5px'}}>Template: <select style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}>
    <option value="blank">Blank</option>
    <option value="json">Sample JSON</option>
    <option value="lisp">Sample Lisp</option>
    <option value="grid">Grid</option>
    <option value="daily_planner_15">Daily planner (15m)</option>
    <option value="daily_planner_30">Daily planner (30m)</option>
    <option value="daily_planner_60">Daily planner (hourly)</option>
    <option value="alt_columns">Alternating columns</option>
    <option value="random">Random graph</option>
  </select>
  </label> 
  <div className="buttons">
    <button style={{flexGrow:'1'}} onClick={createFromTemplate}>Create</button>
    {onClose && <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>}
  </div></>;
}

export default function ImportModal({onClose, openGraph}) {

  const [activeTab, setActiveTab] = useState("import");

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '12px', boxSizing: 'border-box'}}>
    <h3 style={{margin: '0', marginBottom: '.5em'}}>{activeTab === "template" ? "New": "Open"} Parsegraph</h3>
    <div className="tabs" style={{display: 'flex', gap:'5px'}}>
      <div className={activeTab === "template" ? "active" : null} onClick={()=>{
        setActiveTab("template");
      }}>New</div>
      <div className={activeTab === "import" ? "active" : null} onClick={()=>{
        setActiveTab("import");
      }}>Open</div>
    </div>
    {activeTab === "template" && <ImportFromTemplate openGraph={openGraph} onClose={onClose}/>}
    {activeTab === "import" && <ImportFromFile openGraph={openGraph} onClose={onClose}/>}
  </div>
}
