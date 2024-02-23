import { useState } from 'react';

import * as exporters from './exporters';
import { serializeParsegraph } from 'parsegraph';

function download(filename, text) {
  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

export default function ExportModal({onClose, graph}) {
  const [exportType, setExportType] = useState("parsegraph");

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
        download("graph.parsegraph", serializeParsegraph(graph));
        break;
      case "words":
        download("parsegraph-words.txt", exporters.exportGraphToWords(graph));
        break;
      case "lines":
        download("parsegraph-lines.txt", exporters.exportGraphToLines(graph));
        break;
      default:
        throw new Error("Unsupported export type: " + exportType)
    }
    onClose();
  };

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px'}}>
    <select value={exportType} onChange={e=>setExportType(e.target.value)}>
      <option value="words">Words</option>
      <option value="parsegraph">Parsegraph</option>
      <option value="lines">Lines</option>
      <option value="lisp">Lisp</option>
      <option value="json">JSON</option>
    </select>
      <button onClick={performExport}>Export</button>
      <button onClick={onClose}>Cancel</button>
  </div>
};
