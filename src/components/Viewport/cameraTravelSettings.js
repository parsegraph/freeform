const STORAGE_KEY = "parsegraph-node-travel";

export const CAMERA_TRAVEL_CONTROLS = [
  { key: "baseTime", label: "Base travel time", min: 0, max: 1000, step: 25, unit: " ms", hint: "Time for a nearby node. Zero makes navigation instant." },
  { key: "distanceGrowth", label: "Distance influence", min: 0, max: 1.5, step: 0.05, unit: "×", hint: "How much longer distant moves take." },
  { key: "exponent", label: "Distance exponent", min: 0.1, max: 1.5, step: 0.05, unit: "", hint: "Below 1 grows more gently than linear distance." },
  { key: "zoomTime", label: "Time per zoom doubling", min: 0, max: 200, step: 10, unit: " ms", hint: "Extra time for each 2× change in node scale." },
  { key: "maxTime", label: "Maximum travel time", min: 500, max: 4000, step: 100, unit: " ms", hint: "Caps long journeys, including zoom changes." },
  { key: "zoomOut", label: "Context zoom-out", min: 0, max: 1.5, step: 0.05, unit: "×", hint: "Adds a smooth zoom-out arc on long moves. Zero disables it." },
  { key: "zoomOutDistance", label: "Zoom-out starts after", min: 0.25, max: 4, step: 0.25, unit: " screens", hint: "Only for destinations completely off-screen." },
];

export const DEFAULT_CAMERA_TRAVEL_SETTINGS = Object.freeze({
  curve: "logarithmic", baseTime: 350, distanceGrowth: 0.35, exponent: 0.5,
  zoomTime: 60, maxTime: 1800, zoomOut: 0.6, zoomOutDistance: 1,
});

function normalize(settings) {
  const result = {
    curve: ["constant", "logarithmic", "power"].includes(settings?.curve)
      ? settings.curve : DEFAULT_CAMERA_TRAVEL_SETTINGS.curve,
  };
  CAMERA_TRAVEL_CONTROLS.forEach(({ key, min, max }) => {
    result[key] = Number.isFinite(settings?.[key])
      ? Math.max(min, Math.min(max, settings[key])) : DEFAULT_CAMERA_TRAVEL_SETTINGS[key];
  });
  return result;
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_CAMERA_TRAVEL_SETTINGS };
  }
}

export const cameraTravelSettings = load();

export function setCameraTravelSettings(settings) {
  Object.assign(cameraTravelSettings, normalize(settings));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cameraTravelSettings));
  } catch {
    // Tuning still works without browser storage.
  }
  return { ...cameraTravelSettings };
}
