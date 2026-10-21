import { exampleFromSample, normalizeExample } from "./examples";

const STORAGE_KEY = "parsegraph-example-session";

function normalizeCamera(cam) {
  if (!cam || !Number.isFinite(cam.cameraX) || !Number.isFinite(cam.cameraY) ||
      !Number.isFinite(cam.scale) || cam.scale <= 0) return null;
  return { cameraX: cam.cameraX, cameraY: cam.cameraY, scale: cam.scale };
}

export function readExampleSession() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data?.version !== 1) return null;
    const example = normalizeExample(data.example);
    if (!example) return null;
    return { example, cam: normalizeCamera(data.cam), showingUI: data.showingUI === true };
  } catch {
    return null;
  }
}

export function initialExampleSession(search) {
  const params = new URLSearchParams(search);
  if (params.has("public")) return null;
  const saved = readExampleSession();
  if (!params.has("sample")) return saved;
  const example = exampleFromSample(params.get("sample"));
  if (!example) return null;
  return JSON.stringify(saved?.example) === JSON.stringify(example)
    ? saved : { example };
}

export function clearExampleSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Opening files still works when storage is unavailable.
  }
}

export function watchExampleSession(viewport, example) {
  let lastSaved;
  const save = () => {
    // Wait for the initial fit/restore before recording the camera.
    if (!viewport.hasWidget() || viewport.showingInCamera() || viewport.checkingScale()) return;
    const cam = normalizeCamera(viewport.camera().toJSON());
    if (!cam) return;
    const data = JSON.stringify({
      version: 1, example, cam, showingUI: viewport.rendering().showingUI(),
    });
    if (data === lastSaved) return;
    try {
      localStorage.setItem(STORAGE_KEY, data);
      lastSaved = data;
    } catch {
      // Browsing an example should not depend on storage being available.
    }
  };
  const onVisibilityChange = () => {
    if (document.hidden) save();
  };
  save();
  const timer = setInterval(save, 500);
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pagehide", save);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
