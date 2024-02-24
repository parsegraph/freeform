import { useState } from 'react';

export default function SettingsForm({graph, onClose}) {
  const [exportType, setExportType] = useState("parsegraph");

  const saveSettings = () => {

  };

  return <><label style={{display: 'flex', gap:'5px'}}>Format: <select style={{flexGrow:'1'}} value={exportType} onChange={e=>setExportType(e.target.value)}>
    <option value="words">Words</option>
    <option value="parsegraph">Parsegraph</option>
    <option value="lines">Lines</option>
    <option value="lisp">Lisp</option>
    <option value="json">JSON</option>
  </select>
  </label>
  <div className="buttons">
    <button onClick={saveSettings}>Save</button>
    <button onClick={onClose}>Cancel</button>
  </div></>;
}
