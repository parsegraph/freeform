import { DirectionCaret, DirectionNode } from "parsegraph";
import Viewport from "./Viewport";

function setup() {
  const viewport = new Viewport();
  const canvas = document.createElement("div");
  canvas.tabIndex = 0;
  const host = document.createElement("div");
  document.body.append(canvas, host);
  viewport._container = canvas;
  viewport._userCaret = new DirectionCaret(new DirectionNode("original"));
  viewport._rendering = { showUI: jest.fn() };
  viewport.refresh = jest.fn();
  viewport.mountEditor(host);
  return { viewport, host };
}

afterEach(() => document.body.replaceChildren());

test("switching inspector hosts retains pending label text without blocking graph keys while hidden", () => {
  const { viewport, host } = setup();
  viewport.showEditor();
  const field = host.querySelector("textarea");
  field.value = "unfinished label";
  viewport.unmountEditor(host);
  expect(viewport.showingEditor()).toBe(false);
  expect(viewport.node().value()).toBe("original");
  const next = document.createElement("div");
  document.body.appendChild(next);
  viewport.mountEditor(next);
  expect(next.querySelector("textarea")).toBe(field);
  expect(field.value).toBe("unfinished label");
  expect(viewport.showingEditor()).toBe(true);
});

test("pending text from an old selection does not reopen on a different node", () => {
  const { viewport, host } = setup();
  viewport.showEditor();
  host.querySelector("textarea").value = "unfinished label";
  viewport.unmountEditor(host);
  viewport._userCaret = new DirectionCaret(new DirectionNode("different"));
  viewport.mountEditor(host);
  expect(viewport.showingEditor()).toBe(false);
  viewport.showEditor();
  expect(host.querySelector("textarea").value).toBe("different");
});

test("opening label editing before the inspector mounts is safe and requests Edit mode", () => {
  const { viewport, host } = setup();
  viewport.unmountEditor(host);
  viewport.showEditor();
  expect(viewport.rendering().showUI).toHaveBeenCalledTimes(1);
  viewport.mountEditor(host);
  expect(host.querySelector("textarea").style.display).not.toBe("none");
  expect(host.querySelector("textarea")).toHaveFocus();
  expect(host.querySelector("textarea").value).toBe("original");
});

test("ordinary text editing keeps composition and multiline Enter, then commits once on Enter", () => {
  const { viewport, host } = setup();
  viewport.applyEditorValue = jest.fn();
  viewport.showEditor();
  const field = host.querySelector("textarea");
  for (const options of [{ isComposing: true }, { shiftKey: true }]) {
    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true, ...options });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(viewport.showingEditor()).toBe(true);
  }
  const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
  field.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(viewport.applyEditorValue).toHaveBeenCalledTimes(1);
  expect(viewport.showingEditor()).toBe(false);
});

test("Escape cancels ordinary label input and returns focus to the canvas", () => {
  const { viewport, host } = setup();
  viewport.showEditor();
  const field = host.querySelector("textarea");
  field.value = "unfinished label";
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(viewport.showingEditor()).toBe(false);
  expect(viewport.node().value()).toBe("original");
  expect(viewport.container()).toHaveFocus();
});
