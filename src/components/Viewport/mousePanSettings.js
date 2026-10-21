const STORAGE_KEY = "parsegraph-mouse-feel";

export const MOUSE_PAN_CONTROLS = [
  { key: "dragSpeed", label: "Drag speed", min: 0.5, max: 4, step: 0.1, unit: "×", hint: "Higher moves farther while dragging." },
  { key: "glideStrength", label: "Glide strength", min: 0, max: 3, step: 0.1, unit: "×", hint: "Higher adds more motion on release. Zero stops immediately." },
  { key: "friction", label: "Friction", min: 2, max: 20, step: 0.5, unit: "", hint: "Lower lets the glide travel farther." },
  { key: "releaseGrace", label: "Release grace", min: 40, max: 400, step: 20, unit: " ms", hint: "Higher tolerates a longer pause before letting go." },
];

export const DEFAULT_MOUSE_PAN_SETTINGS = Object.freeze({
  dragSpeed: 1,
  glideStrength: 1,
  friction: 8,
  releaseGrace: 160,
});

export const LIGHTER_MOUSE_PAN_SETTINGS = Object.freeze({
  dragSpeed: 1.5,
  glideStrength: 1.3,
  friction: 4.5,
  releaseGrace: 240,
});

function normalize(settings) {
  const result = {};
  MOUSE_PAN_CONTROLS.forEach(({ key, min, max }) => {
    const value = settings?.[key];
    result[key] = Number.isFinite(value)
      ? Math.max(min, Math.min(max, value))
      : DEFAULT_MOUSE_PAN_SETTINGS[key];
  });
  return result;
}

function loadSettings() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_MOUSE_PAN_SETTINGS };
  }
}

// Shared with the active pan controller so slider changes take effect immediately.
export const mousePanSettings = loadSettings();

export function setMousePanSettings(settings) {
  Object.assign(mousePanSettings, normalize(settings));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mousePanSettings));
  } catch {
    // Tuning still works when browser storage is unavailable.
  }
  return { ...mousePanSettings };
}
