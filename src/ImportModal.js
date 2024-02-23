import { useState } from 'react';

import { deserializeParsegraph } from 'parsegraph';

import * as importers from './importers';

export default function ImportModal({onClose, openGraph}) {
  const [importData, setImportData] = useState(null);
  const [importType, setImportType] = useState("words");

  const performImport = ()=> {
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
    onClose();
  };

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px'}}>
    <label>File to import: <input type="file" onChange={e=>{
      for (const file of e.target.files) {
        file.text().then(content=>{
          setImportData(content);
        });
      }
    }}/>
    </label>
    <select value={importType} onChange={e=>setImportType(e.target.value)}>
      <option value="words">Words</option>
      <option value="parsegraph">Parsegraph</option>
      <option value="lines">Lines</option>
      <option value="lisp">Lisp</option>
      <option value="json">JSON</option>
    </select>
      <button onClick={performImport}>Import</button>
      <button onClick={onClose}>Cancel</button>
  </div>
}
