import { useState } from "react";
import {
  DEFAULT_MOUSE_PAN_SETTINGS,
  LIGHTER_MOUSE_PAN_SETTINGS,
  MOUSE_PAN_CONTROLS,
  mousePanSettings,
  setMousePanSettings,
} from "./Viewport/mousePanSettings";
import "./MousePanControls.css";

export default function MousePanControls() {
  const [settings, setSettings] = useState(() => ({ ...mousePanSettings }));
  const update = (next) => setSettings(setMousePanSettings(next));

  return (
    <details className="mouse-pan-controls">
      <summary>Mouse feel</summary>
      <div className="mouse-pan-controls-body">
        <p>Changes apply as you drag. Saved in this browser.</p>
        {MOUSE_PAN_CONTROLS.map(({ key, label, min, max, step, unit, hint }) => (
          <div className="mouse-pan-control" key={key}>
            <label htmlFor={`mouse-pan-${key}`}>
              {label}
              <output htmlFor={`mouse-pan-${key}`}>
                {settings[key]}{unit}
              </output>
            </label>
            <input
              id={`mouse-pan-${key}`}
              type="range"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              aria-describedby={`mouse-pan-${key}-hint`}
              onChange={(event) => update({ ...settings, [key]: Number(event.target.value) })}
            />
            <small id={`mouse-pan-${key}-hint`}>{hint}</small>
          </div>
        ))}
        <div className="mouse-pan-presets">
          <button type="button" onClick={() => update(LIGHTER_MOUSE_PAN_SETTINGS)}>Lighter</button>
          <button type="button" onClick={() => update(DEFAULT_MOUSE_PAN_SETTINGS)}>Reset</button>
        </div>
      </div>
    </details>
  );
}
