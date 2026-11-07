import { Bidi, Direction, DirectionNode, serializeParsegraph } from "parsegraph";
import GraphStack from "./GraphStack";
import { documentState, graphNodes, initializeGraphDocument, readGraph, writeGraph } from "./graphDocument";
import appearanceFixture from "./fixtures/v1/appearance-colors.json";

const copy = (value) => JSON.parse(JSON.stringify(value));
const camera = (x, scale = 1) => ({ cam: { cameraX: x, cameraY: -x, scale }, showingUI: false });
const document = (value = "start", native = true) => {
  const root = new DirectionNode(value); root.setId("root");
  const child = new DirectionNode("child"); child.setId("child");
  root.connect(Direction.FORWARD, child);
  return native ? initializeGraphDocument(root) : root;
};

test("ungrouped saves still record each distinct snapshot, including navigation", () => {
  const root = document();
  const stack = new GraphStack();
  stack.save(root, "root", camera(0));
  stack.save(root, "root", camera(0));
  expect(stack.undoCount()).toBe(0);
  stack.save(root, "child", camera(1));
  expect(stack.undoCount()).toBe(1);
  root.setValue("edited"); stack.save(root, "child", camera(1));
  expect(stack.undoCount()).toBe(2);
  stack.undo(); expect(stack.widget().value()).toBe("start");
  expect(stack.selectedNode()).toBe("child");
  stack.undo(); expect(stack.selectedNode()).toBe("root");
});

test("multiple saves in a group produce one undo and redo with current token and camera baselines", () => {
  const root = document();
  const stack = new GraphStack();
  stack.save(root, "root", camera(0));
  stack.beginGroup(root, "child", { toJSON: () => camera(20, 2) });
  for (const value of ["s", "se", "session"]) {
    root.setValue(value); stack.save(root, "root", camera(30, 3));
    expect(stack.undoCount()).toBe(1);
    expect(stack.widget().value()).toBe(value);
  }
  expect(stack.endGroup()).toBe(true);
  expect(stack.endGroup()).toBeUndefined();
  stack.undo();
  expect(stack.widget().value()).toBe("start");
  expect(stack.selectedNode()).toBe("child");
  expect(stack.viewportData()).toEqual(camera(20, 2));
  stack.redo();
  expect(stack.widget().value()).toBe("session");
  expect(stack.selectedNode()).toBe("root");
  expect(stack.viewportData()).toEqual(camera(30, 3));
});

test("a temporary insertion removed before ending restores the redo branch", () => {
  const root = document("first");
  const stack = new GraphStack();
  stack.save(root, "root");
  root.setValue("second"); stack.save(root, "root");
  root.setValue("future"); stack.save(root, "root");
  stack.undo();
  const current = stack.widget();
  stack.beginGroup(current, "child", camera(5));
  const temporary = new DirectionNode("temporary"); temporary.setId("temporary");
  current.connect(Direction.DOWNWARD, temporary);
  stack.save(current, temporary, camera(6));
  expect(stack.undoCount()).toBe(2);
  expect(stack.redoCount()).toBe(0);
  current.disconnect(Direction.DOWNWARD);
  stack.save(current, "child", camera(7));
  expect(stack.endGroup()).toBe(false);
  expect(stack.undoCount()).toBe(1);
  expect(stack.redoCount()).toBe(1);
  expect(stack.selectedNode()).toBe("child");
  expect(stack.viewportData()).toEqual(camera(7));
  stack.redo(); expect(stack.widget().value()).toBe("future");
});

test("navigation-only groups do not introduce undo entries or require existing freeform metadata", () => {
  const root = document();
  const stack = new GraphStack();
  stack.save(root);
  stack.beginGroup(root, "child", camera(4));
  stack.save(root, "root", camera(5));
  expect(stack.endGroup()).toBe(false);
  expect(stack.undoCount()).toBe(0);
  stack.beginGroup(root, "child", camera(6));
  expect(stack.endGroup()).toBe(false);
  expect(stack.undoCount()).toBe(0);
});

test("unknown native viewport metadata remains persistent document content", () => {
  const root = document();
  documentState(root).metadata = { freeform: { viewport: { customPanel: "left" } } };
  const stack = new GraphStack(); stack.save(root, "root", camera(1));
  stack.beginGroup(root, "child", camera(2));
  documentState(root).metadata.freeform.viewport.customPanel = "right";
  stack.save(root, "root", camera(3));
  expect(stack.endGroup()).toBe(true);
  stack.undo();
  expect(documentState(stack.widget()).metadata.freeform.viewport.customPanel).toBe("left");
  expect(stack.viewportData()).toEqual(camera(2));
  stack.redo();
  expect(documentState(stack.widget()).metadata.freeform.viewport.customPanel).toBe("right");
});

test("a group may return to its baseline and then commit a new branch", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  root.setValue("old future"); stack.save(root); stack.undo();
  const current = stack.widget();
  stack.beginGroup(current, "child");
  current.setValue("temporary"); stack.save(current);
  current.setValue("start"); stack.save(current);
  expect(stack.redoCount()).toBe(1);
  current.setValue("new future"); stack.save(current);
  expect(stack.endGroup()).toBe(true);
  expect(stack.undoCount()).toBe(1);
  expect(stack.redoCount()).toBe(0);
  stack.undo(); expect(stack.widget().value()).toBe("start");
  expect(stack.selectedNode()).toBe("child");
  stack.redo(); expect(stack.widget().value()).toBe("new future");
});

test("persistent appearance, metadata, and root IDs survive a grouped change", () => {
  const original = copy(appearanceFixture);
  original.metadata = { project: { name: "original" }, freeform: { custom: "keep" } };
  const root = readGraph(original);
  const stack = new GraphStack();
  stack.save(root, "root", camera(0));
  stack.beginGroup(root, "child", camera(4));
  documentState(root).capabilities["appearance/1"].pageBackgroundColor = "#112233";
  documentState(root).metadata.project.name = "changed";
  stack.save(root, "root", camera(5));
  expect(stack.endGroup()).toBe(true);
  stack.undo();
  const undone = writeGraph(stack.widget());
  expect(undone.capabilities["appearance/1"]).toEqual(original.capabilities["appearance/1"]);
  expect(undone.metadata.project.name).toBe("original");
  expect(undone.metadata.freeform.custom).toBe("keep");
  expect(stack.selectedNode()).toBe("child");
  expect(stack.viewportData()).toEqual(camera(4));
  expect(graphNodes(stack.widget()).map((node) => node.id()).sort())
    .toEqual(graphNodes(readGraph(original)).map((node) => node.id()).sort());
  stack.redo();
  expect(documentState(stack.widget()).metadata.project.name).toBe("changed");
  expect(documentState(stack.widget()).capabilities["appearance/1"].pageBackgroundColor).toBe("#112233");
});

test("the grouped baseline is independent of metadata exposed by the current graph", () => {
  const root = document();
  documentState(root).metadata = { project: { name: "before" } };
  const stack = new GraphStack();
  stack.save(root);
  stack.beginGroup(root, root);
  const editable = stack.widget();
  documentState(editable).metadata.project.name = "after";
  stack.save(editable, editable);
  expect(stack.endGroup()).toBe(true);
  stack.undo();
  expect(documentState(stack.widget()).metadata.project.name).toBe("before");
});

test("groups on an empty stack create a baseline without an empty undo step", () => {
  const root = document();
  const stack = new GraphStack();
  stack.beginGroup(root, "child", camera(2));
  expect(stack.hasWidget()).toBe(true);
  expect(stack.undoCount()).toBe(0);
  expect(stack.endGroup()).toBe(false);
  stack.clear();
  stack.beginGroup(root, "child", camera(2));
  root.setValue("changed"); stack.save(root, "root", camera(3));
  expect(stack.endGroup()).toBe(true);
  stack.undo();
  expect(stack.widget().value()).toBe("start");
  expect(stack.selectedNode()).toBe("child");
});

test("undo interrupts a group and later ungrouped edits remain separate", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  stack.beginGroup(root, "child");
  root.setValue("typing"); stack.save(root);
  root.setValue("typed"); stack.save(root);
  stack.undo();
  expect(stack.endGroup()).toBeUndefined();
  expect(stack.widget().value()).toBe("start");
  stack.redo(); expect(stack.widget().value()).toBe("typed");
  root.setValue("ordinary edit"); stack.save(root);
  expect(stack.undoCount()).toBe(2);
  stack.undo(); expect(stack.widget().value()).toBe("typed");
  stack.undo(); expect(stack.widget().value()).toBe("start");
});

test("a changed group after undo commits a new branch, while a no-op redo interruption keeps the old branch", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  root.setValue("old future"); stack.save(root); stack.undo();
  let current = stack.widget();
  stack.beginGroup(current, "child");
  stack.redo();
  expect(stack.endGroup()).toBeUndefined();
  expect(stack.widget().value()).toBe("old future");
  stack.undo(); current = stack.widget();
  stack.beginGroup(current, "child");
  current.setValue("new future"); stack.save(current);
  expect(stack.endGroup()).toBe(true);
  expect(stack.redoCount()).toBe(0);
  stack.undo(); stack.redo(); expect(stack.widget().value()).toBe("new future");
});

test("starting another group finalizes the previous group, and unsaved content becomes a distinct baseline", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  root.setValue("outside session");
  stack.beginGroup(root, "child");
  root.setValue("first session"); stack.save(root);
  stack.beginGroup(root, "root");
  root.setValue("second session"); stack.save(root);
  expect(stack.endGroup()).toBe(true);
  expect(stack.undoCount()).toBe(3);
  stack.undo(); expect(stack.widget().value()).toBe("first session");
  stack.undo(); expect(stack.widget().value()).toBe("outside session");
  stack.undo(); expect(stack.widget().value()).toBe("start");
});

test("replace finalizes a group without erasing its baseline, including an identical replacement", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  root.setValue("earlier edit"); stack.save(root);
  stack.beginGroup(root, "child");
  root.setValue("session"); stack.save(root, "child");
  root.setValue("styled session"); stack.replace(root, "child");
  expect(stack.endGroup()).toBeUndefined();
  expect(stack.undoCount()).toBe(2);
  stack.replace(root, "child");
  expect(stack.undoCount()).toBe(2);
  stack.undo(); expect(stack.widget().value()).toBe("earlier edit");
  stack.undo(); expect(stack.widget().value()).toBe("start");
});

test("clear ends grouping so new document edits cannot overwrite the departing history", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  stack.beginGroup(root, root);
  root.setValue("old session"); stack.save(root);
  stack.clear();
  expect(stack.endGroup()).toBeUndefined();
  expect(stack.hasWidget()).toBe(false);
  const next = document("new document");
  stack.save(next);
  next.setValue("new edit"); stack.save(next);
  stack.undo(); expect(stack.widget().value()).toBe("new document");
  expect(stack.undoCount()).toBe(0);
});

test("legacy viewport colors and styles count as edits while its camera does not", () => {
  const baseline = { ...camera(0), defaultNodeStyle: appearanceFixture.capabilities["appearance/1"].defaults,
    styles: { child: { backgroundColor: "#112233" } }, pageBackgroundColor: "#ffffff" };
  // readGraph migrates the document's own legacy viewport styles to appearance.
  const root = readGraph({ ...serializeParsegraph(document("legacy", false)), viewport: baseline });
  const stack = new GraphStack(); stack.save(root, "root", baseline);
  stack.beginGroup(root, "child", { ...baseline, ...camera(1) });
  stack.save(root, "root", { ...baseline, ...camera(2) });
  expect(stack.endGroup()).toBe(false);
  stack.beginGroup(root, "child", baseline);
  stack.save(root, "root", { ...baseline, pageBackgroundColor: "#000000" });
  expect(stack.endGroup()).toBe(true);
  stack.undo(); expect(documentState(stack.widget()).appearance.pageBackgroundColor).toBe("#ffffff");
  stack.redo(); expect(documentState(stack.widget()).appearance.pageBackgroundColor).toBe("#000000");
});

test("v2 history preserves all bidi declarations and treats a direction change as content", () => {
  const root = document();
  const child = graphNodes(root).find((node) => node.id() === "child");
  root.setBidi(Bidi.INHERIT);
  child.setBidi(Bidi.RTL);
  const nested = new DirectionNode("nested"); nested.setId("nested"); nested.setBidi(Bidi.LTR);
  child.connect(Direction.INWARD, nested);
  documentState(root).capabilities["future/1"] = { preserved: true };
  const stack = new GraphStack(); stack.save(root, "child", camera(1));
  stack.beginGroup(root, "nested", camera(2));
  child.setBidi(Bidi.LTR); stack.save(root, "child", camera(3));
  expect(stack.endGroup()).toBe(true);
  stack.undo();
  const saved = writeGraph(stack.widget());
  expect(saved.version).toBe(2);
  expect(Object.fromEntries(saved.nodes.map((node) => [node.id, node.bidi]))).toEqual({ root: "inherit", child: "rtl", nested: "ltr" });
  expect(saved.capabilities["future/1"]).toEqual({ preserved: true });
  expect(stack.selectedNode()).toBe("nested");
  expect(stack.viewportData()).toEqual(camera(2));
  stack.redo();
  expect(graphNodes(stack.widget()).find((node) => node.id() === "child").bidi()).toBe(Bidi.LTR);
});

test("grouped equality does not depend on serialized node traversal order", () => {
  const root = document();
  const stack = new GraphStack(); stack.save(root);
  // A valid native document permits any node record order. Current-axis
  // traversal can produce a different order when that document is reloaded.
  stack._actions[0].nodes.reverse();
  stack.beginGroup(root, "child", camera(1));
  stack.save(root, "root", camera(2));
  expect(stack.endGroup()).toBe(false);
  expect(stack.undoCount()).toBe(0);
});
