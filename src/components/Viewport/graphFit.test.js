import { CommitLayout } from "parsegraph";
import Viewport from "./Viewport";
import ViewportRendering from "./ViewportRendering";
import { cameraPose } from "./ViewportCameraTravel";
import { readGraph, documentState, graphNodes } from "../../graphDocument";
import { createDocumentLayout } from "../../graphPresentation";
import memory from "../../fixtures/v1/memory-piers.json";
import proportion from "../../fixtures/v1/proportion-proportional.json";
import mixed from "../../fixtures/v2/bidi-contexts.json";

function harness(width = 800, height = 600) {
  const viewport = new Viewport();
  viewport.scheduleRepaint = jest.fn();
  viewport.refreshCamera = jest.fn();
  viewport._input = { stopPan: jest.fn() };
  const renderer = Object.create(ViewportRendering.prototype);
  renderer._viewport = viewport;
  viewport._rendering = renderer;
  viewport.camera().setSize(width, height);
  return { viewport, renderer };
}

function open(viewport, document, saved) {
  const root = readGraph(document);
  viewport.show(root, saved);
  const ctx = { save() {}, restore() {}, resetTransform() {},
    measureText: (text) => ({ width: [...text].length * 6 }) };
  const layout = new CommitLayout(root, createDocumentLayout(documentState(root).presentation, ctx), "ltr");
  while (layout.crank()) {}
  return root;
}

function expectEntireGraphVisible(viewport) {
  const camera = viewport.camera();
  graphNodes(viewport.widget()).forEach(node => {
    const l = node.layout(), size = [0, 0]; l.absoluteSize(size);
    const left = (l.absoluteX() - size[0] / 2 + camera.x()) * camera.scale();
    const top = (l.absoluteY() - size[1] / 2 + camera.y()) * camera.scale();
    expect(left).toBeGreaterThanOrEqual(camera.width() * 0.1 - 1e-5);
    expect(top).toBeGreaterThanOrEqual(camera.height() * 0.1 - 1e-5);
    expect(left + size[0] * camera.scale()).toBeLessThanOrEqual(camera.width() * 0.9 + 1e-5);
    expect(top + size[1] * camera.scale()).toBeLessThanOrEqual(camera.height() * 0.9 + 1e-5);
  });
}

test.each([[800, 600], [320, 700], [1400, 400]])("initial fit contains asymmetric Memory Piers and a subsequent document in %s × %s", (width, height) => {
  const { viewport, renderer } = harness(width, height);
  open(viewport, memory);
  renderer.focusCamera();
  expectEntireGraphVisible(viewport);
  expect(viewport.cameraTravel().active()).toBe(false);
  expect(viewport.checkingScale()).toBe(false);
  open(viewport, proportion);
  renderer.focusCamera();
  expectEntireGraphVisible(viewport);
  expect(viewport.cameraTravel().active()).toBe(false);
});

test("saved camera and selection survive opening; explicit Fit animates without changing selection", () => {
  const { viewport, renderer } = harness();
  const cam = { cameraX: -2000, cameraY: 400, scale: 2 };
  const root = open(viewport, memory, { cam });
  const selected = graphNodes(root).at(-1);
  viewport.moveToId(selected.id());
  renderer.focusCamera();
  expect(viewport.camera().toJSON()).toMatchObject(cam);
  const before = cameraPose(viewport.camera());
  viewport.fitGraph();
  renderer.focusCamera();
  expect(viewport.node()).toBe(selected);
  expect(cameraPose(viewport.camera())).toEqual(before);
  expect(viewport.cameraTravel().active()).toBe(true);
  viewport.cameraTravel().tick(performance.now() + 10000);
  viewport.cameraTravel().cancel();
  expectEntireGraphVisible(viewport);
  expect(viewport.node()).toBe(selected);
});

test("initial fit waits through zero dimensions and does not consume its request", () => {
  const { viewport, renderer } = harness(0, 0);
  open(viewport, memory);
  expect(() => renderer.focusCamera()).not.toThrow();
  expect(viewport._fitGraphRequested).toBe(true);
  viewport.camera().setSize(800, 600);
  renderer.focusCamera();
  expectEntireGraphVisible(viewport);
});

test.each(["inherit", "rtl"])("camera fit includes nested opposite-direction regions with a %s root", (bidi) => {
  const fixture = JSON.parse(JSON.stringify(mixed));
  fixture.nodes.find((node) => node.id === fixture.root).bidi = bidi;
  const { viewport, renderer } = harness(420, 700);
  open(viewport, fixture);
  renderer.focusCamera();
  expectEntireGraphVisible(viewport);
});
