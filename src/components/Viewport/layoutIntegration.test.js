import {
  Bidi, CommitLayout, Direction, DirectionNode, LayoutOperation, LayoutPhase,
} from "parsegraph";
import Camera from "parsegraph-camera";
import ViewportRendering from "./ViewportRendering";
import { graphNodes, readGraph } from "../../graphDocument";
import mixed from "../../fixtures/v2/bidi-contexts.json";

function harness(root) {
  const renderer = Object.create(ViewportRendering.prototype);
  const camera = new Camera();
  camera.setSize(800, 600);
  renderer._viewport = { widget: () => root, camera: () => camera };
  renderer._revision = 0;
  renderer._phase = 0;
  renderer._cranks = 0;
  renderer._renderPass = 0;
  renderer._renderData = { allGroups: 0 };
  renderer._glProvider = { canProject: () => true };
  renderer._ctx = { resetTransform() {}, scale() {}, translate() {} };
  renderer.createLayout = () => new CommitLayout(root, {
    size: (node, out) => { out[0] = Math.max(20, String(node.value()).length * 6); out[1] = 20; },
    getSeparation: () => 10,
  }, Bidi.LTR);
  renderer.focusCamera = jest.fn();
  renderer.renderPaintGroup = jest.fn(() => false);
  renderer._steps = [
    ["Layout", () => renderer.paint()],
    ["Publish geometry", jest.fn(() => {
      expect(renderer.layoutReady()).toBe(true);
      graphNodes(root).forEach((node) => {
        const layout = node.layout();
        expect([layout.absoluteX(), layout.absoluteY(), layout.absoluteScale()].every(Number.isFinite)).toBe(true);
        expect(layout.needsAbsolutePos()).toBe(false);
      });
      return false;
    })],
  ];
  return renderer;
}

function finish(renderer) {
  let steps = 0;
  while (!renderer.isDone()) {
    expect(++steps).toBeLessThan(5000);
    renderer.crank();
  }
}

test("camera and geometry publication wait for DONE after root commitment and root resize", () => {
  const root = readGraph(mixed);
  const renderer = harness(root);
  const publication = renderer._steps[1][1];
  let sawCommittedBeforeDone = false;
  let count = 0;
  while (renderer.phase() === 0) {
    expect(++count).toBeLessThan(5000);
    renderer.crank();
    if (root.layout().phase() === LayoutPhase.COMMITTED && renderer.phase() === 0) {
      sawCommittedBeforeDone = true;
      expect(renderer.layoutReady()).toBe(false);
      renderer.cameraChanged(true);
      expect(renderer.focusCamera).not.toHaveBeenCalled();
    }
    expect(publication).not.toHaveBeenCalled();
  }
  expect(sawCommittedBeforeDone).toBe(true);
  expect(renderer.layoutReady()).toBe(true);
  renderer.cameraChanged(true);
  expect(renderer.focusCamera).toHaveBeenCalledTimes(1);
  finish(renderer);
  expect(publication).toHaveBeenCalledTimes(1);

  const child = root.neighbors().nodeAt(Direction.FORWARD);
  const oldX = child.layout().absoluteX();
  root.setValue("A much wider resized root which moves the opposite direction region");
  renderer.reset();
  expect(renderer.layoutReady()).toBe(false);
  renderer.cameraChanged(true);
  expect(renderer.focusCamera).toHaveBeenCalledTimes(1);
  finish(renderer);
  expect(child.layout().absoluteX()).toBeGreaterThan(oldX);
  expect(publication).toHaveBeenCalledTimes(2);
});

test("retained edits during positioning finish once with current-axis groups and current parent coordinates", () => {
  const root = new DirectionNode("root");
  const forward = new DirectionNode("forward");
  const down = new DirectionNode("down");
  const leaf = new DirectionNode("leaf");
  root.connect(Direction.FORWARD, forward);
  root.connect(Direction.DOWNWARD, down);
  forward.connect(Direction.DOWNWARD, leaf);
  for (const node of [forward, down, leaf]) node.paintGroups().crease();
  const renderer = harness(root);
  let operation, count = 0;
  do {
    expect(++count).toBeLessThan(5000);
    operation = renderer.paint();
  } while (operation !== LayoutOperation.GROUP_POSITION);
  expect(renderer.layoutReady()).toBe(false);

  root.siblings().pull(Direction.DOWNWARD);
  leaf.disconnect();
  down.connect(Direction.FORWARD, leaf);
  forward.paintGroups().uncrease();
  root.setBidi(Bidi.RTL);
  // The live job sees the revisions. Freeform must continue it through DONE,
  // never publish the root's intermediate COMMITTED phase.
  finish(renderer);
  expect(renderer._steps[1][1]).toHaveBeenCalledTimes(1);
  expect(leaf.neighbors().parentNode()).toBe(down);
  expect(leaf.layout().absoluteX()).toBeLessThan(down.layout().absoluteX());
  expect(forward.paintGroup().node()).toBe(root);
  const expectedGroups = [];
  root.paintGroup().forEach((node) => expectedGroups.push(node));
  let renders = 0;
  while (renderer.render()) expect(++renders).toBeLessThan(10);
  const visited = renderer.renderPaintGroup.mock.calls.map(([node]) => node);
  expect(visited).toEqual([expectedGroups[0], ...expectedGroups.slice(1).reverse()]);
  expect(visited).toHaveLength(expectedGroups.length);
  expect(renderer._renderData.allGroups).toBe(expectedGroups.length);
});
