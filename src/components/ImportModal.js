import { useCallback, useEffect, useState } from 'react';

import { DirectionNode, deserializeParsegraph } from 'parsegraph';

import * as importers from '../importers';

import './modal.css';
import { buildAlternatingColumns, buildGrid, buildPlanner, buildRandom, buildMarchMadness, buildFootballPlayoffs, buildTournament } from '../builders';

function ImportFromFile({openGraph, onClose}) {
  const [importData, setImportData] = useState(null);
  const [importType, setImportType] = useState("words");
  const [importName, setImportName] = useState(null);

  const performImport = useCallback(()=> {
    console.log(importType);
    try {
      if (importType === "png") {
        importData.arrayBuffer().then((buff) => {
          openGraph(importers.graphPng(new Uint8Array(buff)));
        });
        return;
      }
      if (importType === "jpeg") {
        importData.arrayBuffer().then((buff) => {
          openGraph(importers.graphJpeg(buff));
        });
        return;
      }

      importData.text().then(importData => {
        switch (importType) {
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
          const data = JSON.parse(importData);
          openGraph(deserializeParsegraph(data), data.selectedNode);
          break;
        case "lines":
          openGraph(importers.graphLines(importData));
          break;
        default:
          throw new Error("Unsupported import type: " + importType)
        }
      });
    } catch (ex) {
      console.log(ex);
      alert (ex);
    } finally {
      if (onClose) {
        onClose();
      }
    }
  }, [onClose, importType, importData, openGraph]);

  const loadFiles = useCallback(e => {
    for (const file of e.target.files) {
      setImportName(file.name);
      setImportData(file);
      switch (file.name.split('.').pop().toLowerCase()) {
      case "png":
        setImportType("png");
        break;
      case "jpg":
      case "jpeg":
        setImportType("jpeg");
        break;
      case "lisp":
        setImportType("lisp");
        break;
      case "parsegraph":
      case "graph":
        setImportType("parsegraph");
        break;
      case "json":
        setImportType("json");
        break;
      case "txt":
      case "ini":
        setImportType("lines");
        break;
      default:
        setImportType("words");
        break;
      }
    }
  }, []);

  return <form onSubmit={e => {
    e.preventDefault();
    performImport();
  }} style={{display: 'flex', flexDirection: "column", justifyContent: "stretch"}}>
  <span style={{display: 'block', paddingBottom: '0.5em', fontSize: '18px'}}>Load a Parsegraph from a file.</span>
  <label htmlFor="fileUpload" style={{display: 'block', background: importData ? '#0a8a0a' : '#5f5fff', color: 'white', padding: '5px', borderRadius: '3px', marginBottom: '5px', flexGrow: '1'}}>{importData ? (importName ?? "File selected") : "Choose file"}</label>
  <input style={{display: 'none'}} id="fileUpload" type="file" onChange={loadFiles}/>
  <label style={{display: 'flex', gap:'5px'}}>Type: <select style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}>
    <option value="words">Words</option>
    <option value="parsegraph">Parsegraph</option>
    <option value="lines">Lines</option>
    <option value="lisp">Lisp</option>
    <option value="json">JSON</option>
    <option value="png">PNG</option>
    <option value="jpeg">JPEG</option>
  </select>
  </label>
  <div className="buttons">
    <input type="submit" style={{flexGrow:'1'}} onClick={performImport} value="Import"/>
    {onClose && <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>}
  </div></form>;
}

const loadRoom = (openGraph, roomName) => {
  return fetch("/public/" + roomName).then(resp=>resp.json()).then(roomData =>{
    openGraph(deserializeParsegraph(roomData), null, roomName);
  });
}

function JoinPublic({openGraph, onClose}) {
  const [importType, setImportType] = useState("");

  const joinRoom = ()=> {
    loadRoom(openGraph, importType);
    if (onClose) {
      onClose();
    }
  };

  return <form onSubmit={e=>{
    e.preventDefault();
    joinRoom();
  }}>
  <span style={{display: 'block', paddingBottom: '0.5em', fontSize: '18px'}}>Load a public Parsegraph.</span>
  <label style={{display: 'flex', gap:'5px'}}>Name: <input style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}/>
  </label>
  <div className="buttons">
    <input type="submit" style={{flexGrow:'1'}} onClick={joinRoom} value="Load"/>
    {onClose && <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>}
  </div></form>;
}

const openSampleLisp = (openGraph) => {
  return fetch("/surface.lisp")
    .then(resp=>resp.text())
    .then(text=>{
      openGraph(importers.graphLisp(text));
    });
};

const openSampleJson = (openGraph) => {
  return fetch("/package.json")
    .then(resp=>resp.text())
    .then(text=>{
      openGraph(importers.graphJson(JSON.parse(text)));
    });
};

function ImportFromTemplate({openGraph, onClose}) {
  const [importType, setImportType] = useState("blank");
  const [numRounds, setNumRounds] = useState(5);
  const [vertical, setVertical] = useState(false);

  const createFromTemplate = () => {
    switch(importType) {
      case "blank":
        openGraph(new DirectionNode());
        break;
      case "lisp":
        openSampleLisp(openGraph);
        break;
      case "json":
        openSampleJson(openGraph);
        break;
      case "grid":
        openGraph(buildGrid());
        break;
      case "daily_planner_5":
        openGraph(buildPlanner(5));
        break;
      case "daily_planner_10":
        openGraph(buildPlanner(10));
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
      case "random":
        openGraph(buildRandom(250));
        break;
      case "alt_columns":
        openGraph(buildAlternatingColumns());
        break;
      case "march_madness":
        openGraph(buildMarchMadness(false));
        break;
      case "march_madness_vert":
        openGraph(buildMarchMadness(true));
        break;
      case "playoffs":
        openGraph(buildFootballPlayoffs(false));
        break;
      case "playoffs_vert":
        openGraph(buildFootballPlayoffs(true));
        break;
      case "march":
        openGraph(buildTournament(vertical, ...createTournamentRounds(numRounds)));
        break;
      default:
        openGraph(new DirectionNode("Unknown import type: " + importType));
        break;
    }
    if (onClose) {
      onClose();
    }
  };

  return <form onSubmit={e => {
    e.preventDefault();
    createFromTemplate();
  }}>
   <span style={{display: 'block', paddingBottom: '0.5em', fontSize: '18px'}}>Create a new Parsegraph.</span>
   <label style={{display: 'flex', gap:'5px'}}>Template: <select style={{flexGrow:'1'}} value={importType} onChange={e=>setImportType(e.target.value)}>
    <option value="blank">Blank</option>
    <option value="json">Sample JSON</option>
    <option value="lisp">Sample Lisp</option>
    <option value="grid">Grid</option>
    <option value="daily_planner_5">Daily planner (5m)</option>
    <option value="daily_planner_10">Daily planner (10m)</option>
    <option value="daily_planner_15">Daily planner (15m)</option>
    <option value="daily_planner_30">Daily planner (30m)</option>
    <option value="daily_planner_60">Daily planner (hourly)</option>
    <option value="alt_columns">Alternating columns</option>
    <option value="random">Random graph</option>
    <option value="march_madness">March Madness</option>
    <option value="march_madness_vert">March Madness (Vertical)</option>
    <option value="playoffs">Playoffs</option>
    <option value="playoffs_vert">Playoffs (Vertical)</option>
    <option value="march">Tournament</option>
  </select>
  </label> 
  {importType === "march" && <div style={{display: "flex", flexDirection: "column", justifyContent: "space-between"}}><label>Rounds:&nbsp;
  <input value={numRounds} onChange={e=>setNumRounds(Number.parseInt(e.target.value))} type="range" min="1" max="10"></input><span style={{display: 'inline-block', minWidth: "2em"}}>{numRounds}</span>
  </label>
  <label style={{display: 'flex', justifyContent: 'end'}}><input style={{minWidth: "2em"}} type="checkbox" checked={vertical} onChange={e=>setVertical(e.target.checked)}/>Vertical</label></div>}
  <div className="buttons">
    <input type="submit" style={{flexGrow:'1'}} onClick={createFromTemplate} value="Create"/>
    {onClose && <button style={{flexGrow:'1'}} onClick={onClose}>Cancel</button>}
  </div></form>;
}

const createTournamentRounds = (numRounds) => {
  if (typeof numRounds === "string") {
    try {
      numRounds = Number.parseInt(numRounds);
    } catch (ex) {
      //console.log(ex);
      numRounds = 2;
    }
  }
  const rounds = [];
  const getLabel = (i) => {
    switch(i) {
      case 0: return "Championship";
      case 1: return "Semifinals";
      case 2: return "Quarterfinals";
      default: return "Round " + (numRounds - i);
    }
  }
  for (let i = 0; i < numRounds; ++i) {
    rounds.push(getLabel(i));
  }
  return rounds;
}

export default function ImportModal({onClose, openGraph, sampleName}) {

  const [activeTab, setActiveTab] = useState("template");

  useEffect(() => {
    if (!sampleName || !openGraph) {
      return;
    }
    const sampleParts = sampleName.split("_");
    switch (sampleParts[0]) {
    case "lisp":
      openSampleLisp(openGraph);
      break;
    case "json":
      openSampleJson(openGraph);
      break;
    case "grid":
      openGraph(buildGrid(sampleParts[1]));
      break;
    case "playoffs":
      openGraph(buildFootballPlayoffs(sampleParts[1]?.toLowerCase().startsWith("vert")));
      break;
    case "march":
      const vert = sampleParts[2]?.toLowerCase().startsWith("vert");
      if (sampleParts[1] === "madness") {
        openGraph(buildMarchMadness(vert));
        break;
      }
      openGraph(buildTournament(vert, ...createTournamentRounds(sampleParts[1])));
      break;
    default:
      return;
    }
  }, [sampleName, openGraph]);

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '12px', boxSizing: 'border-box'}}>
    <h3 style={{margin: '0', marginBottom: '.5em'}}>{activeTab === "template" ? "New": (activeTab === "public" ? "Load" : "Open")} Parsegraph</h3>
    <div className="tabs" style={{display: 'flex', gap:'5px'}}>
      <button className={activeTab === "template" ? "active" : null} onClick={()=>{
        setActiveTab("template");
      }}>New</button>
      <button className={activeTab === "import" ? "active" : null} onClick={()=>{
        setActiveTab("import");
      }}>Open</button>
      <button className={activeTab === "public" ? "active" : null} onClick={()=>{
        setActiveTab("public");
      }}>Public</button>
    </div>
    {activeTab === "template" && <ImportFromTemplate openGraph={openGraph} onClose={onClose}/>}
    {activeTab === "import" && <ImportFromFile openGraph={openGraph} onClose={onClose}/>}
    {activeTab === "public" && <JoinPublic openGraph={openGraph} onClose={onClose}/>}
  </div>
}
