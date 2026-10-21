import Camera from "parsegraph-camera";
import ViewportCameraTravel, { cameraPose, nodeTravelTarget, planTravel, sampleTravel, travelDuration } from "./ViewportCameraTravel";
import { DEFAULT_CAMERA_TRAVEL_SETTINGS as defaults } from "./cameraTravelSettings";

const from = { x: 0, y: 0, scale: 1 };
const to = { x: 10000, y: 2000, scale: 4 };

test("distance timing can be constant, logarithmic, or sublinear power, with a cap", () => {
  const constant = { ...defaults, curve: "constant", zoomTime: 0 };
  expect(travelDuration(100, 0, constant)).toBe(travelDuration(0, 0, constant));
  for (const curve of ["logarithmic", "power"]) {
    const settings = { ...defaults, curve, maxTime: 4000 };
    const near = travelDuration(1, 0, settings) - settings.baseTime;
    const far = travelDuration(10, 0, settings) - settings.baseTime;
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThan(near * 10);
    expect(travelDuration(1e12, 20, settings)).toBe(settings.maxTime);
  }
  expect(travelDuration(0, 3)).toBe(defaults.baseTime + defaults.zoomTime * 3);
  expect(travelDuration(100, 10, { ...defaults, baseTime: 0 })).toBe(0);
});

test("zoom is proportional and only distant off-screen destinations get a context arc", () => {
  const visible = planTravel(from, to, 1000, 1000, true);
  expect(sampleTravel(visible, 0.5).scale).toBeCloseTo(2);
  const distant = planTravel(from, to, 1000, 1000, false);
  expect(sampleTravel(distant, 0.5).scale).toBeLessThan(1);
  const nearby = planTravel(from, { ...to, x: 200, y: 0 }, 1000, 1000, false);
  expect(nearby.dip).toBe(0);
  expect(sampleTravel(distant, 0)).toEqual(from);
  expect(sampleTravel(distant, 1)).toEqual(to);
  expect(sampleTravel(distant, 0.001).x).toBeLessThan(0.001);
  expect(sampleTravel(distant, 0.999).x).toBeGreaterThan(to.x - 0.001);
});

test("moving into a shrunken node preserves apparent size, and moving back reverses the zoom", () => {
  const camera = new Camera();
  camera.setSize(1000, 1000);
  const layout = (scale) => ({
    absoluteX: () => 200, absoluteY: () => 100, absoluteScale: () => scale,
    absoluteSize: (size) => { size[0] = 100 * scale; size[1] = 50 * scale; },
  });
  const inward = nodeTravelTarget(camera, layout(0.25), 0.5, 2);
  expect(inward).toEqual({ x: 200, y: 100, scale: 4 });
  expect(nodeTravelTarget(camera, layout(0.5), 0.25, inward.scale).scale).toBe(2);
  expect(nodeTravelTarget(camera, layout(1), 1, 100).scale).toBe(8);
});

describe("animation lifecycle", () => {
  let camera, travel, time, frames, viewport;
  beforeEach(() => {
    time = 0;
    frames = new Map();
    let id = 0;
    jest.spyOn(performance, "now").mockImplementation(() => time);
    jest.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++id, callback); return id;
    });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => frames.delete(id));
    camera = new Camera();
    camera.setSize(1000, 1000);
    camera.setOrigin(500, 500);
    viewport = { camera: () => camera, hasWidget: () => true, refresh: jest.fn() };
    travel = new ViewportCameraTravel(viewport);
  });
  afterEach(() => jest.restoreAllMocks());
  const advance = (ms) => {
    time += ms;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  };

  test("uses elapsed time and lands exactly at the endpoint after a delayed frame", () => {
    travel.start(to, false);
    expect(cameraPose(camera)).toEqual(from);
    advance(100);
    expect(cameraPose(camera).x).toBeGreaterThan(0);
    expect(cameraPose(camera).x).toBeLessThan(to.x);
    advance(5000);
    expect(cameraPose(camera)).toEqual(to);
    expect(travel.active()).toBe(false);
    expect(frames.size).toBe(0);
  });

  test("retargeting starts at the current pose and cancellation freezes it", () => {
    travel.start(to, false);
    advance(150);
    const midway = cameraPose(camera);
    expect(travel.destinationScale()).toBe(4);
    travel.start({ x: -100, y: 0, scale: 2 }, true);
    expect(cameraPose(camera)).toEqual(midway);
    expect(frames.size).toBe(1);
    advance(100);
    const interrupted = cameraPose(camera);
    travel.cancel();
    advance(5000);
    expect(cameraPose(camera)).toEqual(interrupted);
    expect(frames.size).toBe(0);
  });
});
