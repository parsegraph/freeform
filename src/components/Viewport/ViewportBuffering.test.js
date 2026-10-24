import Camera from "parsegraph-camera";
import { Direction, DirectionNode, LayoutPhase } from "parsegraph";
import Viewport from "./Viewport";
import ViewportRendering from "./ViewportRendering";
import { MAX_PAINT_TIME_MS } from "../../settings";

// Exercise the real rendering phases and scheduling without allocating a GPU.
jest.mock("parsegraph-compileprogram", () => ({
  ...jest.requireActual("parsegraph-compileprogram"),
  BasicGLProvider: function () {
    const canvas = global.document.createElement("canvas");
    const container = global.document.createElement("div");
    container.appendChild(canvas);
    return {
      canvas: () => canvas,
      container: () => container,
      canProject: () => true,
      render: jest.fn(),
      gl: () => ({}),
      setOnContextChanged: jest.fn(),
    };
  },
}));

let contexts;
let animationFrames;
let originalWorker;

beforeEach(() => {
  contexts = new WeakMap();
  jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    if (!contexts.has(this)) {
      contexts.set(this, {
        resetTransform: jest.fn(), clearRect: jest.fn(), drawImage: jest.fn(),
        scale: jest.fn(), translate: jest.fn(),
      });
    }
    return contexts.get(this);
  });
  animationFrames = new Map();
  let nextFrame = 0;
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrames.set(++nextFrame, callback);
    return nextFrame;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => animationFrames.delete(id));
  originalWorker = window.Worker;
});

afterEach(() => {
  window.Worker = originalWorker;
  jest.restoreAllMocks();
});

function fakeBuffer() {
  return {
    begin: jest.fn(), drawTarget: jest.fn(), publish: jest.fn(),
    present: jest.fn(), discard: jest.fn(),
  };
}

function setup() {
  const camera = new Camera();
  camera.setSize(1000, 600);
  camera.setOrigin(500, 300);
  const root = new DirectionNode("root");
  root.layout().setPhase(LayoutPhase.COMMITTED);
  const viewport = Object.create(Viewport.prototype);
  viewport._cam = camera;
  viewport._container = document.createElement("div");
  viewport._root = root;
  viewport.widget = () => viewport._root;
  viewport.node = () => viewport._root;
  viewport.layout = () => viewport._root.layout();
  viewport.hasWidget = () => true;
  viewport._checkScale = false;
  const renderer = new ViewportRendering(viewport);
  viewport._rendering = renderer;
  renderer._frameBuffer = fakeBuffer();
  renderer._extentBuffer = fakeBuffer();
  renderer.renderUI = jest.fn();
  renderer.restart();
  return { renderer, viewport, camera, root };
}

function beginFrame(renderer) {
  expect(renderer.clearBackground()).toBe(false);
  renderer._phase = 3;
  return renderer._frame;
}

function finishFrame(renderer) {
  renderer.publishFrame();
  renderer._phase = renderer._steps.length;
  return renderer._frontFrame;
}

test("camera changes preserve the in-flight pose and pass while zoom limits affect the live camera", () => {
  const { renderer, viewport, camera } = setup();
  const frame = beginFrame(renderer);
  const frozen = frame.camera.toJSON();
  const pass = renderer._renderPass;
  camera.setOrigin(120, 80);
  camera.setScale(2);
  renderer.cameraChanged();
  expect(renderer._frame).toBe(frame);
  expect(renderer._phase).toBe(3);
  expect(renderer._renderPass).toBe(pass);
  expect(renderer.camera().toJSON()).toEqual(frozen);
  expect(viewport.camera()).toBe(camera);

  jest.spyOn(renderer, "focusCamera").mockImplementation(() => {
    viewport.camera().setScale(1.5);
    viewport.clearCheckScale();
  });
  renderer.cameraChanged(true);
  expect(renderer.focusCamera).toHaveBeenCalledTimes(1);
  expect(camera.scale()).toBe(1.5);
  expect(renderer.camera().toJSON()).toEqual(frozen);
  expect(renderer._renderPass).toBe(pass);
});

test("finishing a pass coalesces all camera changes into one replacement at the newest pose", () => {
  const { renderer, camera } = setup();
  beginFrame(renderer);
  const pass = renderer._renderPass;
  for (let i = 1; i <= 5; i++) {
    camera.setOrigin(i * 10, i * 20);
    camera.setScale(1 + i / 10);
    renderer.cameraChanged();
  }
  expect(renderer._renderPass).toBe(pass);
  expect(renderer.continueLatestFrame()).toBe(false);
  const previous = finishFrame(renderer);
  expect(renderer.continueLatestFrame()).toBe(true);
  expect(renderer._renderPass).toBe(pass + 1);
  expect(renderer._frontFrame).toBe(previous);
  expect(renderer._frame).toBeNull();

  const newest = beginFrame(renderer);
  expect(newest.camera.toJSON()).toEqual(camera.toJSON());
  finishFrame(renderer);
  expect(renderer.continueLatestFrame()).toBe(false);
  expect(renderer._renderPass).toBe(pass + 1);
});

test("an unchanged camera stops rendering even when its change counter differs", () => {
  const { renderer, camera } = setup();
  beginFrame(renderer);
  const front = finishFrame(renderer);
  const original = camera.toJSON();
  camera.setOrigin(200, 100);
  camera.restore(original);
  expect(front.camera.changeVersion()).not.toBe(camera.changeVersion());
  expect(renderer.continueLatestFrame()).toBe(false);
  expect(renderer.isDone()).toBe(true);
});

test("graph edits keep the last complete image but invalidate drawing and async results", () => {
  const { renderer, root } = setup();
  beginFrame(renderer);
  const front = finishFrame(renderer);
  renderer.restart();
  const pending = beginFrame(renderer);
  pending.cancelLabels = jest.fn();
  pending.textKey = "pending";
  renderer._textRequests.set(pending.textKey, pending);
  renderer._textCache = { revision: renderer._revision, camera: front.camera };
  root.connect(Direction.FORWARD, new DirectionNode("new node"));

  renderer.reset();
  expect(renderer._frontFrame).toBe(front);
  expect(front.text.parentElement).toBe(renderer.viewport().container());
  expect(renderer._frame).toBeNull();
  expect(renderer.validFrame(front)).toBe(false);
  expect(renderer.validFrame(pending)).toBe(false);
  expect(pending.cancelLabels).toHaveBeenCalledTimes(1);
  expect(renderer._textRequests.size).toBe(0);
  expect(renderer._textCache).toBeNull();
  expect(renderer._frameBuffer.discard).not.toHaveBeenCalled();
});

test.each(["root", "size"])("changing the %s discards incompatible front layers and async results", (change) => {
  const { renderer, viewport, camera } = setup();
  beginFrame(renderer);
  const front = finishFrame(renderer);
  front.cancelLabels = jest.fn();
  renderer._extentBuffer.discard.mockClear();
  if (change === "root") viewport._root = new DirectionNode("replacement");
  else camera.setSize(1200, 700);

  renderer.reset();
  expect(renderer._frontFrame).toBeNull();
  expect(front.text.parentElement).toBeNull();
  expect(front.labels.parentElement).toBeNull();
  expect(renderer.validFrame(front)).toBe(false);
  expect(front.cancelLabels).toHaveBeenCalled();
  expect(renderer._frameBuffer.discard).toHaveBeenCalledTimes(1);
  expect(renderer._extentBuffer.discard).toHaveBeenCalledTimes(1);
});

test("late world labels use their captured pose and cannot modify an invalidated frame", () => {
  const { renderer, camera } = setup();
  const frame = beginFrame(renderer);
  const ctx = frame.labels.getContext("2d");
  let completeLabels;
  frame.worldLabels = {
    labels: () => [{}],
    prepareRender: jest.fn((...args) => {
      completeLabels = args.at(-1);
      return jest.fn();
    }),
    render: jest.fn(),
  };
  renderer._showWorldLabels = true;
  renderer.postRender();
  camera.setOrigin(50, 20);
  camera.setScale(2);
  renderer.cameraChanged();
  completeLabels();
  expect(ctx.translate).toHaveBeenCalledWith(frame.camera.x(), frame.camera.y());
  expect(ctx.scale).toHaveBeenCalledWith(frame.camera.scale(), frame.camera.scale());
  expect(frame.worldLabels.render).toHaveBeenCalledTimes(1);
  renderer.reset();
  completeLabels();
  expect(frame.worldLabels.render).toHaveBeenCalledTimes(1);
});

test("text worker results preserve the current pass and reject invalidated requests", () => {
  const { renderer, viewport } = setup();
  let receiveText;
  window.Worker = jest.fn().mockImplementation(() => ({
    addEventListener: (event, callback) => { receiveText = callback; },
    postMessage: jest.fn(),
  }));
  jest.spyOn(viewport, "scheduleRender").mockImplementation(() => {});
  const frame = beginFrame(renderer);
  renderer.initializeText();
  renderer.postRenderText();
  const image = { close: jest.fn() };
  receiveText({ data: { key: frame.textKey, image } });
  expect(renderer._textCache.camera).toBe(frame.camera);
  expect(renderer._frame).toBe(frame);
  expect(renderer._phase).toBe(3);
  expect(viewport.scheduleRender).not.toHaveBeenCalled();
  expect(image.close).toHaveBeenCalledTimes(1);

  renderer.postRenderText();
  const staleKey = frame.textKey;
  renderer.reset();
  const staleImage = { close: jest.fn() };
  receiveText({ data: { key: staleKey, image: staleImage } });
  expect(renderer._textCache).toBeNull();
  expect(viewport.scheduleRender).not.toHaveBeenCalled();
  expect(staleImage.close).toHaveBeenCalledTimes(1);
});

test("front layers publish only after all rendering phases complete", () => {
  const { renderer } = setup();
  beginFrame(renderer);
  const front = finishFrame(renderer);
  renderer.restart();
  for (const method of ["paint", "focusCamera", "initializeText", "renderText", "renderExtents",
    "postRender", "postRenderText", "persist", "renderMetrics"]) {
    jest.spyOn(renderer, method).mockReturnValue(false);
  }
  jest.spyOn(renderer, "render").mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValue(false);
  const publish = jest.spyOn(renderer, "publishFrame");
  const frontText = front.text;
  while (renderer.phaseName() !== "Presenting frame") {
    renderer.crank();
    renderer.present();
    expect(renderer._frontFrame).toBe(front);
    expect(frontText.parentElement).toBe(renderer.viewport().container());
    if (renderer._frame) {
      expect(renderer._frame.text.parentElement).toBeNull();
      expect(renderer._frame.labels.parentElement).toBeNull();
    }
    expect(publish).not.toHaveBeenCalled();
  }
  const pending = renderer._frame;
  renderer.crank();
  expect(renderer.isDone()).toBe(true);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(renderer._frontFrame).toBe(pending);
  expect(frontText.parentElement).toBeNull();
  expect(pending.text.parentElement).toBe(renderer.viewport().container());
  expect(pending.labels.parentElement).toBe(renderer.viewport().container());
});

test("scheduling and overlay refreshes do not restart an in-flight pass", () => {
  const { renderer, viewport } = setup();
  const frame = beginFrame(renderer);
  const restart = jest.spyOn(renderer, "restart");
  viewport.scheduleRender();
  viewport.scheduleRender();
  viewport.refreshOverlay();
  viewport.refreshCamera();
  expect(animationFrames.size).toBe(1);
  expect(restart).not.toHaveBeenCalled();
  expect(renderer._frame).toBe(frame);
  viewport.cancelScheduledRender();
  expect(animationFrames.size).toBe(0);
});

test("a render slice still yields at the time budget and presents the complete front", () => {
  const { renderer, viewport } = setup();
  beginFrame(renderer);
  const front = finishFrame(renderer);
  renderer.restart();
  beginFrame(renderer);
  let now = 0;
  const crank = jest.spyOn(renderer, "crank").mockImplementation(() => {
    now += MAX_PAINT_TIME_MS;
    return true;
  });
  const continueLatest = jest.spyOn(renderer, "continueLatestFrame");
  const present = jest.spyOn(renderer, "present");
  jest.spyOn(Date, "now").mockImplementation(() => now);
  expect(viewport.paint()).toBe(true);
  expect(crank).toHaveBeenCalledTimes(2);
  expect(present).toHaveBeenCalledTimes(1);
  expect(continueLatest).not.toHaveBeenCalled();
  expect(renderer._frontFrame).toBe(front);
  expect(renderer._frameBuffer.present).toHaveBeenLastCalledWith(front.camera, front.camera);
});

test("camera motion transforms all published layers without additional GPU presentation", () => {
  const { renderer, camera, root } = setup();
  jest.spyOn(root.layout(), "needsAbsolutePos").mockReturnValue(false);
  beginFrame(renderer);
  const front = finishFrame(renderer);
  const overlay = renderer._overlayCanvas.getContext("2d");
  renderer.renderUI.mockImplementation(() => {
    expect(renderer.camera()).toBe(camera);
    expect(renderer.ctx()).toBe(overlay);
  });
  renderer.present();
  expect(renderer._frameBuffer.present).toHaveBeenCalledTimes(1);
  expect(renderer._extentBuffer.present).toHaveBeenCalledTimes(1);
  expect(renderer._frameBuffer.present).toHaveBeenLastCalledWith(front.camera, front.camera);

  camera.setOrigin(480, 260);
  camera.setScale(2);
  renderer.cameraChanged();
  renderer.present();
  for (const canvas of [renderer.glProvider().canvas(), renderer.extentGlProvider().canvas(),
    front.text, front.labels]) {
    expect(canvas.style.transform).toBe("translate(-40px, -80px) scale(2)");
  }
  expect(renderer._frameBuffer.present).toHaveBeenCalledTimes(1);
  expect(renderer._extentBuffer.present).toHaveBeenCalledTimes(1);
  expect(overlay.clearRect).toHaveBeenCalledTimes(2);
  expect(renderer.renderUI).toHaveBeenCalledTimes(2);
});

test("removing the published root clears preserved GPU canvases only once", () => {
  const { renderer, viewport, camera } = setup();
  beginFrame(renderer);
  const front = finishFrame(renderer);
  renderer.present();
  camera.adjustOrigin(20, 10);
  renderer.present();
  expect(renderer.glProvider().canvas().style.transform).not.toBe("");

  viewport._root = new DirectionNode("replacement");
  renderer.reset();
  renderer.present();
  expect(renderer._frameBuffer.present).toHaveBeenCalledTimes(2);
  expect(renderer._extentBuffer.present).toHaveBeenCalledTimes(2);
  expect(renderer._frameBuffer.present).toHaveBeenLastCalledWith(camera, undefined);
  expect(renderer.glProvider().canvas().style.transform).toBe("");
  expect(renderer.extentGlProvider().canvas().style.transform).toBe("");
  expect(front.text.parentElement).toBeNull();
  expect(front.labels.parentElement).toBeNull();
  renderer.present();
  expect(renderer._frameBuffer.present).toHaveBeenCalledTimes(2);
  expect(renderer._extentBuffer.present).toHaveBeenCalledTimes(2);
});

test("offscreen warnings require a published frame matching the current camera", () => {
  const { renderer, camera } = setup();
  const offscreen = jest.fn();
  renderer.setOffscreenHandler(offscreen);
  beginFrame(renderer);
  Object.assign(renderer._renderData, { i: 0, allGroups: 3, offscreenGroups: 3 });
  renderer.present();
  expect(offscreen).toHaveBeenLastCalledWith(false);

  // A visible completed frame remains authoritative while the next traversal
  // has only encountered culled groups so far.
  Object.assign(renderer._renderData, { i: 1, allGroups: 4, offscreenGroups: 3 });
  const visible = finishFrame(renderer);
  expect(visible.offscreen).toBe(false);
  renderer.restart();
  beginFrame(renderer);
  Object.assign(renderer._renderData, { i: 0, allGroups: 3, offscreenGroups: 3 });
  renderer.present();
  expect(offscreen).toHaveBeenLastCalledWith(false);

  const completedOffscreen = finishFrame(renderer);
  expect(completedOffscreen.offscreen).toBe(true);
  renderer.present();
  expect(offscreen).toHaveBeenLastCalledWith(true);
  camera.adjustOrigin(100, 50);
  renderer.cameraChanged();
  renderer.present();
  expect(renderer._frontFrame).toBe(completedOffscreen);
  expect(offscreen).toHaveBeenLastCalledWith(false);
});

test.each([
  [3, "renderPaintGroup"],
  [5, "renderPaintGroupText"],
])("a dirty group during phase %i restarts at layout without skipping it", (phase, drawGroup) => {
  const { renderer, viewport, root } = setup();
  const pending = beginFrame(renderer);
  renderer._phase = phase;
  const pass = renderer._renderPass;
  jest.spyOn(renderer, drawGroup).mockImplementation(() => {
    root.invalidate();
    return true;
  });
  const refresh = jest.spyOn(viewport, "refresh");
  const paint = jest.spyOn(renderer, "paint").mockReturnValue(false);

  expect(renderer.crank()).toBe(true);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(renderer._renderPass).toBe(pass + 1);
  expect(renderer.phaseName()).toBe("Painting graph");
  expect(renderer._frame).toBeNull();
  expect(renderer.validFrame(pending)).toBe(false);
  expect(paint).not.toHaveBeenCalled();

  renderer.crank();
  expect(paint).toHaveBeenCalledTimes(1);
  expect(renderer.phaseName()).toBe("Focusing camera");
  viewport.cancelScheduledRender();
});
