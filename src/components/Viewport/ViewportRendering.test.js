import Camera from "parsegraph-camera";
import ViewportRendering from "./ViewportRendering";

function node(x, scale = 1) {
  return { layout: () => ({
    absoluteX: () => x, absoluteY: () => 0, absoluteScale: () => scale,
    absoluteSize: (size) => { size[0] = 100 * scale; size[1] = 50 * scale; },
  }) };
}

test("neighbor focus schedules travel once and rapid moves use the planned zoom", () => {
  const camera = new Camera();
  camera.setSize(1000, 1000);
  camera.setOrigin(500, 500);
  let selected = node(0);
  let ensure = false;
  let destination;
  const travel = {
    active: () => destination !== undefined,
    destinationScale: () => destination?.scale,
    start: jest.fn((target) => { destination = target; }),
  };
  const viewport = {
    camera: () => camera, node: () => selected, cameraTravel: () => travel,
    input: () => ({ stopPan: jest.fn() }),
    showingInCamera: () => false, checkingScale: () => false,
    ensuringVisible: () => ensure,
    clearShowingInCamera: jest.fn(), clearCheckScale: jest.fn(),
    clearEnsuringVisible: () => { ensure = false; },
  };
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = viewport;
  const original = camera.toJSON();
  // A restored camera is left untouched on the first frame.
  expect(renderer.focusCamera()).toBe(false);
  expect(camera.toJSON()).toEqual(original);
  selected = node(200, 0.5);
  ensure = true;
  expect(renderer.focusCamera()).toBe(true);
  expect(destination.scale).toBe(2);
  expect(camera.toJSON()).toEqual(original);
  // Rendering must advance while the animation is active.
  expect(renderer.focusCamera()).toBe(false);
  expect(travel.start).toHaveBeenCalledTimes(1);
  // The live camera could still be zoomed out during the first journey.
  camera.setScale(0.1);
  selected = node(500, 0.25);
  ensure = true;
  renderer.focusCamera();
  expect(destination.scale).toBe(4);
  expect(travel.start).toHaveBeenCalledTimes(2);
});
