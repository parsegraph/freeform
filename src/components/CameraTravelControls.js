import { useState } from "react";
import {
  CAMERA_TRAVEL_CONTROLS, DEFAULT_CAMERA_TRAVEL_SETTINGS,
  cameraTravelSettings, setCameraTravelSettings,
} from "./Viewport/cameraTravelSettings";
import { travelDuration } from "./Viewport/ViewportCameraTravel";

export default function CameraTravelControls() {
  const [settings, setSettings] = useState(() => ({ ...cameraTravelSettings }));
  const update = (next) => setSettings(setCameraTravelSettings(next));
  return (
    <details className="mouse-pan-controls">
      <summary>Node travel</summary>
      <div className="mouse-pan-controls-body">
        <p>Applies to the next node move. Saved in this browser.</p>
        <label className="camera-travel-curve">
          Distance timing
          <select value={settings.curve} onChange={(e) => update({ ...settings, curve: e.target.value })}>
            <option value="constant">Constant</option>
            <option value="logarithmic">Logarithmic</option>
            <option value="power">Power</option>
          </select>
        </label>
        {CAMERA_TRAVEL_CONTROLS.filter(({ key }) =>
          (key !== "exponent" || settings.curve === "power") &&
          (key !== "distanceGrowth" || settings.curve !== "constant")
        ).map(({ key, label, min, max, step, unit, hint }) => (
          <div className="mouse-pan-control" key={key}>
            <label htmlFor={`camera-travel-${key}`}>
              {label}<output htmlFor={`camera-travel-${key}`}>{settings[key]}{unit}</output>
            </label>
            <input id={`camera-travel-${key}`} type="range" min={min} max={max} step={step}
              value={settings[key]} aria-describedby={`camera-travel-${key}-hint`}
              onChange={(e) => update({ ...settings, [key]: Number(e.target.value) })} />
            <small id={`camera-travel-${key}-hint`}>{hint}</small>
          </div>
        ))}
        <p className="camera-travel-preview">
          Same zoom: nearby {Math.round(travelDuration(0, 0, settings))} ms ·
          {" "}5 screens {Math.round(travelDuration(5, 0, settings))} ms ·
          {" "}20 screens {Math.round(travelDuration(20, 0, settings))} ms
        </p>
        <div className="mouse-pan-presets">
          <button type="button" onClick={() => update(DEFAULT_CAMERA_TRAVEL_SETTINGS)}>Reset travel</button>
        </div>
      </div>
    </details>
  );
}
