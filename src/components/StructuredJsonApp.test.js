import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { DirectionNode } from "parsegraph";
import Viewport from "./Viewport/Viewport";
import {
  graphNodes,
  documentState,
  graphSelection,
  readGraph,
  writeGraph,
} from "../graphDocument";
import {
  applyJsonCommand,
  createStructuredJson,
  inspectJsonSelection,
} from "../structuredJson";
import {
  JSON_RECOVERY_KEY,
  readJsonRecovery,
  writeJsonRecovery,
} from "../structuredJsonRecovery";
import galleryFixture from "../fixtures/v1/appearance-colors.json";

// Exercise App, the actual document chooser/editor/exporter, history, and codecs.
// Only the WebGL viewport is replaced with an adapter using the real commands.
jest.mock("./Viewport/Viewport", () =>
  jest.fn().mockImplementation(() => {
    const { graphNodes } = require("../graphDocument");
    const { applyJsonCommand } = require("../structuredJson");
    let container, root, selected, onDocumentChange, onSave, onUI;
    let showingUI = false;
    let cam = { cameraX: 0, cameraY: 0, scale: 1 };
    const notify = () => onDocumentChange?.(root, selected);
    const rendering = {
      setOffscreenHandler: jest.fn(),
      setOnUI: (listener) => {
        onUI = listener;
      },
      showingUI: () => showingUI,
      showUI: () => {
        showingUI = true;
        onUI?.(true);
      },
      hideUI: () => {
        showingUI = false;
        onUI?.(false);
      },
      toggleUI: () => {
        showingUI = !showingUI;
        onUI?.(showingUI);
      },
      toggleSpotlights: jest.fn(),
      toggleWorldLabels: jest.fn(),
    };
    return {
      mount: (element) => {
        container = element;
      },
      container: () => container,
      rendering: () => rendering,
      input: () => ({ keystrokes: () => null }),
      show: (graph, data) => {
        root = graph;
        selected = graph;
        if (data?.cam) cam = data.cam;
        if (typeof data?.showingUI === "boolean") {
          showingUI = data.showingUI;
          onUI?.(showingUI);
        }
        notify();
      },
      widget: () => root,
      node: () => selected,
      toJSON: () => ({ cam, showingUI }),
      showingStyling: () => false,
      setOnDocumentChange: (listener) => {
        onDocumentChange = listener;
      },
      setSaveGraph: (listener) => {
        onSave = listener;
      },
      setUndo: jest.fn(),
      setRedo: jest.fn(),
      setToggleNodeActions: jest.fn(),
      setToggleNodeStyling: jest.fn(),
      showInCamera: jest.fn(),
      fitGraph: jest.fn(),
      zoomCamera: jest.fn(),
      hideEditor: jest.fn(),
      mountEditor: jest.fn(),
      mountLog: jest.fn(),
      mountStatus: jest.fn(),
      refresh: jest.fn(),
      moveToId: (id) => {
        selected =
          graphNodes(root).find((node) => node.id() === id) ?? selected;
        notify();
      },
      applyStructuredCommand: (command, nodeId) => {
        const target = nodeId
          ? graphNodes(root).find((node) => node.id() === nodeId)
          : selected;
        const result = applyJsonCommand(root, target, command);
        root = result.root;
        selected = result.selectedNode;
        notify();
        onSave?.(root, selected);
        return result;
      },
    };
  })
);

const createViewport = Viewport.getMockImplementation();

beforeAll(() => {
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: { randomUUID: () => "structured-json-app-test" },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Viewport.mockImplementation(createViewport);
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
  cleanup();
  window.onbeforeunload = null;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function saveRecovery(text = "-") {
  const initial = createStructuredJson({ level: 1 });
  const number = graphNodes(initial).find((node) => node.value() === "1");
  const { root, selectedNode } = applyJsonCommand(initial, number, {
    type: "setText",
    text,
  });
  const document = writeGraph(
    root,
    selectedNode,
    {
      cam: { cameraX: 20, cameraY: -30, scale: 0.8 },
      showingUI: true,
    },
    1
  );
  writeJsonRecovery(document);
  return document;
}

function renderApp() {
  const App = require("./App").default;
  return render(<App />);
}

test("gallery launch overrides saved examples, preserves capabilities, and reloads until another source opens", async () => {
  localStorage.setItem("parsegraph-example-session", JSON.stringify({
    version: 1, example: { type: "cross", rounds: 3 },
  }));
  const cam = { cameraX: 12, cameraY: -24, scale: 0.6 };
  const document = {
    ...galleryFixture,
    capabilities: { ...galleryFixture.capabilities, "future/1": { preserved: true } },
    metadata: { freeform: { viewport: { cam, showingUI: true } } },
  };
  window.history.replaceState({}, "", "/freeform/?document=%2Fexamples%2Fcolors.parsegraph&sample=rainbow");
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify(document) });
  const app = renderApp();
  await act(async () => {});
  let viewport = Viewport.mock.results.at(-1).value;
  expect(documentState(viewport.widget()).capabilities).toEqual(document.capabilities);
  expect(viewport.toJSON().cam).toEqual(cam);
  expect(viewport.showInCamera).not.toHaveBeenCalled();
  expect(localStorage.getItem("parsegraph-example-session")).toBeNull();
  expect(new URLSearchParams(window.location.search).get("document")).toBe("/examples/colors.parsegraph");
  expect(window.location.search).not.toContain("sample");
  app.unmount();
  renderApp();
  await act(async () => {});
  expect(fetch).toHaveBeenCalledTimes(2);
  viewport = Viewport.mock.results.at(-1).value;
  expect(documentState(viewport.widget()).capabilities).toEqual(document.capabilities);
  await importOrdinaryGraph();
  expect(viewport.widget().value()).toBe("ordinary");
  expect(window.location.search).not.toContain("document");
});

test("invalid explicit links show an error without fetching or restoring a saved example", async () => {
  window.history.replaceState({}, "", "/freeform/?document=https%3A%2F%2Fother.test%2Fgraph&sample=rainbow");
  global.fetch = jest.fn();
  renderApp();
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent("this website");
  expect(fetch).not.toHaveBeenCalled();
  expect(Viewport.mock.results.at(-1).value.widget()).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Choose another document" }));
  expect(screen.getByRole("dialog", { name: "New document" })).toBeInTheDocument();
  expect(window.location.search).toBe("");
});

function recover() {
  fireEvent.click(screen.getByRole("button", { name: "Recover JSON draft" }));
}

function recoveredNumberText() {
  const document = readJsonRecovery().document;
  const root = readGraph(document);
  const selected = graphNodes(root).find(
    (node) => node.id() === graphSelection(document)
  );
  return inspectJsonSelection(root, selected).text;
}

async function importOrdinaryGraph(openChooser = true) {
  if (openChooser)
    fireEvent.click(screen.getByRole("button", { name: "Open", exact: true }));
  const chooser = screen.getByRole("dialog", { name: "New document" });
  fireEvent.click(
    within(chooser).getByRole("button", { name: "Open", exact: true })
  );
  const file = new File([""], "ordinary.parsegraph");
  file.text = jest
    .fn()
    .mockResolvedValue(
      JSON.stringify(
        writeGraph(new DirectionNode("ordinary"), undefined, undefined, 1)
      )
    );
  fireEvent.change(screen.getByLabelText("Choose file"), {
    target: { files: [file] },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Import", exact: true })
    );
  });
}

test("the chooser offers recovery and reopens the selected partial number with its camera", () => {
  const document = saveRecovery();
  renderApp();
  expect(
    screen.getByRole("button", { name: "Recover JSON draft" })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("complementary", { name: "JSON editor" })
  ).not.toBeInTheDocument();
  recover();
  expect(
    screen.getByRole("textbox", { name: "Number", exact: true })
  ).toHaveValue("-");
  expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
  const viewport = Viewport.mock.results.at(-1).value;
  expect(viewport.node().id()).toBe(graphSelection(document));
  expect(viewport.toJSON().cam).toEqual({
    cameraX: 20,
    cameraY: -30,
    scale: 0.8,
  });
});

test("switching documents before the debounce expires flushes the most recent focused edit", async () => {
  saveRecovery();
  renderApp();
  recover();
  const field = screen.getByRole("textbox", { name: "Number", exact: true });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "-2e" } });
  expect(recoveredNumberText()).toBe("-");
  // No blur, Apply, timer advance, or unload occurs before opening another file.
  await importOrdinaryGraph();
  expect(
    screen.queryByRole("complementary", { name: "JSON editor" })
  ).not.toBeInTheDocument();
  expect(Viewport.mock.results.at(-1).value.widget().value()).toBe("ordinary");
  expect(recoveredNumberText()).toBe("-2e");
});

test("pagehide flushes a focused unfinished token before the debounce expires", () => {
  saveRecovery();
  renderApp();
  recover();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Number", exact: true }),
    {
      target: { value: "1e-" },
    }
  );
  expect(recoveredNumberText()).toBe("-");
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(recoveredNumberText()).toBe("1e-");
});

test("failed automatic recovery is visible and still allows downloading the unfinished draft", () => {
  saveRecovery();
  const previousRecovery = localStorage.getItem(JSON_RECOVERY_KEY);
  renderApp();
  recover();
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota exceeded");
  });
  act(() => jest.advanceTimersByTime(300));
  expect(screen.getByText(/Recovery could not be saved/)).toHaveTextContent(
    "quota exceeded"
  );
  expect(localStorage.getItem(JSON_RECOVERY_KEY)).toBe(previousRecovery);

  const downloads = [];
  jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function () {
      downloads.push(
        JSON.parse(
          decodeURIComponent(
            this.getAttribute("href").split(",").slice(1).join(",")
          )
        )
      );
    });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const exporter = screen.getByRole("dialog", { name: "Save a copy" });
  fireEvent.click(
    within(exporter).getByRole("button", { name: "Save", exact: true })
  );
  expect(downloads).toHaveLength(1);
  const root = readGraph(downloads[0]);
  const selected = graphNodes(root).find(
    (node) => node.id() === graphSelection(downloads[0])
  );
  expect(inspectJsonSelection(root, selected).text).toBe("-");
});

test("corrupt recovery is reported in the chooser without deleting its saved bytes", () => {
  localStorage.setItem(JSON_RECOVERY_KEY, "{broken");
  renderApp();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Could not restore the JSON draft"
  );
  expect(
    screen.queryByRole("button", { name: "Recover JSON draft" })
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "New JSON document" })
  ).toBeInTheDocument();
  expect(localStorage.getItem(JSON_RECOVERY_KEY)).toBe("{broken");
});

test("the shell names imported documents, starts with no history, and keeps developer tools closed", async () => {
  renderApp();
  await importOrdinaryGraph(false);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "ordinary.parsegraph"
  );
  expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Developer" })).toHaveAttribute(
    "aria-expanded", "false"
  );
  expect(screen.queryByRole("region", { name: "Developer tools" })).not.toBeInTheDocument();
  expect(screen.queryByText("Mouse feel")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  const dialog = screen.getByRole("dialog", { name: "Save a copy" });
  expect(within(dialog).getByRole("textbox", { name: "Name:" })).toHaveValue(
    "ordinary.parsegraph"
  );
});

test("switching View and Edit preserves selected content, camera, and unsaved state", () => {
  saveRecovery();
  renderApp();
  recover();
  const viewport = Viewport.mock.results.at(-1).value;
  fireEvent.change(screen.getByRole("textbox", { name: "Number", exact: true }), {
    target: { value: "-5" },
  });
  const selectedId = viewport.node().id();
  const camera = viewport.toJSON().cam;
  fireEvent.click(screen.getByRole("button", { name: "View", exact: true }));
  expect(screen.getByRole("button", { name: "View", exact: true })).toHaveAttribute(
    "aria-pressed", "true"
  );
  expect(screen.queryByRole("complementary", { name: "JSON editor" })).not.toBeInTheDocument();
  expect(viewport.node().id()).toBe(selectedId);
  expect(viewport.node().value()).toBe("-5");
  expect(viewport.toJSON().cam).toEqual(camera);
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(screen.getByLabelText("Graph canvas")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
  expect(screen.getByRole("textbox", { name: "Number", exact: true })).toHaveValue("-5");
  expect(viewport.node().id()).toBe(selectedId);
  expect(viewport.toJSON().cam).toEqual(camera);
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(screen.getByLabelText("Graph canvas")).toHaveFocus();
});

test("toolbar undo and redo restore semantic content and return focus to the canvas", () => {
  saveRecovery();
  renderApp();
  recover();
  expect(screen.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Number", exact: true }), {
    target: { value: "12" },
  });
  expect(screen.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(screen.getByRole("textbox", { name: "Number", exact: true })).toHaveValue("-");
  expect(screen.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo", exact: true })).toBeEnabled();
  expect(screen.getByLabelText("Graph canvas")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(screen.getByRole("textbox", { name: "Number", exact: true })).toHaveValue("12");
  expect(screen.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  expect(screen.getByLabelText("Graph canvas")).toHaveFocus();
});

test("Undo and Redo mark a saved draft as unsaved again", () => {
  saveRecovery();
  const download = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  renderApp();
  recover();
  fireEvent.change(screen.getByRole("textbox", { name: "Number", exact: true }), {
    target: { value: "12" },
  });
  const saveDraft = () => {
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Save a copy" }))
      .getByRole("button", { name: "Save", exact: true }));
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
  };
  saveDraft();
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(screen.getByRole("textbox", { name: "Number", exact: true })).toHaveValue("-");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  saveDraft();
  fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(screen.getByRole("textbox", { name: "Number", exact: true })).toHaveValue("12");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  expect(download).toHaveBeenCalledTimes(2);
});

test("the save dialog contains keyboard focus and Escape restores its toolbar trigger", () => {
  saveRecovery();
  renderApp();
  recover();
  const save = screen.getByRole("button", { name: "Save", exact: true });
  const toolbar = save.closest("header");
  save.focus();
  fireEvent.click(save);
  const dialog = screen.getByRole("dialog", { name: "Save a copy" });
  const close = within(dialog).getByRole("button", { name: "Close export" });
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(close).toHaveFocus();
  expect(toolbar).toHaveAttribute("inert");
  fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
  expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Save a copy" })).not.toBeInTheDocument();
  expect(save).toHaveFocus();
  expect(toolbar).not.toHaveAttribute("inert");
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
});
