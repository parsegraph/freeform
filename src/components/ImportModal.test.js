import { StrictMode } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import ImportModal from "./ImportModal";
import { createExample, loadExample } from "../examples";
import fixture from "../fixtures/v1/appearance-colors.json";
import { documentState } from "../graphDocument";
import { exportGraphToSvg } from "../xmlGraph";
import { TextDecoder, TextEncoder } from "util";
import { benchmarkFor, cancelBenchmark, getBenchmarkRuns } from "../benchmark";

jest.mock("../examples", () => ({
  createExample: jest.fn((type, options) => ({ type, ...options })),
  loadExample: jest.fn(),
}));

const example = { type: "cross", rounds: 3 };
const loaded = { graph: {}, selectedNode: null, viewportData: { styles: {} }, example };

beforeAll(() => { global.TextDecoder = TextDecoder; });

beforeEach(() => {
  jest.clearAllMocks();
  loadExample.mockResolvedValue(loaded);
});

test("restores camera and mode once even under StrictMode", async () => {
  const openGraph = jest.fn();
  const cam = { cameraX: 10, cameraY: 20, scale: 0.5 };
  render(<StrictMode><ImportModal openGraph={openGraph} initialSession={{ example, cam, showingUI: false }} /></StrictMode>);
  await waitFor(() => expect(openGraph).toHaveBeenCalledTimes(1));
  expect(openGraph).toHaveBeenCalledWith(loaded.graph, null, null, { styles: {}, cam }, example, false);
});

test("failed restoration offers the chooser instead of a permanent loading screen", async () => {
  loadExample.mockRejectedValue(new Error("offline"));
  render(<ImportModal openGraph={jest.fn()} initialSession={{ example: { type: "json" } }} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not restore");
  expect(screen.getByRole("combobox", { name: "Template:" })).toBeInTheDocument();
});

test("creating a template passes its recipe with the graph", async () => {
  const openGraph = jest.fn();
  render(<ImportModal openGraph={openGraph} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Template:" }), { target: { value: "cross" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(openGraph).toHaveBeenCalled());
  expect(createExample).toHaveBeenCalledWith("cross", { rounds: 5, vertical: false });
  expect(openGraph).toHaveBeenCalledWith(loaded.graph, null, null, loaded.viewportData, example);
});

test("a cancelled example load cannot replace a subsequently opened file", async () => {
  let finish;
  loadExample.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const openGraph = jest.fn();
  render(<ImportModal openGraph={openGraph} />);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  fireEvent.click(screen.getByRole("button", { name: "Open", exact: true }));
  await act(async () => finish(loaded));
  expect(openGraph).not.toHaveBeenCalled();
});

test("file import opens v1 with all capabilities and reports validation errors in the chooser", async () => {
  const openGraph = jest.fn();
  const onClose = jest.fn();
  render(<ImportModal openGraph={openGraph} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Open", exact: true }));
  const file = new File([""], "colors.parsegraph");
  file.text = jest.fn().mockResolvedValue(JSON.stringify(fixture));
  fireEvent.change(screen.getByLabelText("Choose file"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
  await waitFor(() => expect(openGraph).toHaveBeenCalledTimes(1));
  expect(documentState(openGraph.mock.calls[0][0]).capabilities).toEqual(fixture.capabilities);
  expect(onClose).toHaveBeenCalledTimes(1);
  openGraph.mockClear();
  onClose.mockClear();
  file.text.mockResolvedValue(JSON.stringify({ ...fixture, version: 999 }));
  fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not open file:");
  expect(openGraph).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("SVG files select XML import, preserve whitespace, and keep errors in the chooser", async () => {
  const openGraph = jest.fn();
  const onClose = jest.fn();
  render(<ImportModal openGraph={openGraph} onClose={onClose} />);
  fireEvent.click(screen.getByRole("button", { name: "Open", exact: true }));
  const source = '<svg xmlns="http://www.w3.org/2000/svg">\n  <text>A <tspan>B</tspan> C</text>\n</svg>';
  const file = new File([""], "SOURCE.SVG");
  file.arrayBuffer = jest.fn().mockResolvedValue(new TextEncoder().encode(source).buffer);
  fireEvent.change(screen.getByLabelText("Choose file"), { target: { files: [file] } });
  expect(screen.getByRole("combobox")).toHaveValue("xml");
  fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
  await waitFor(() => expect(openGraph).toHaveBeenCalledTimes(1));
  expect(exportGraphToSvg(openGraph.mock.calls[0][0])).toBe(source);
  expect(onClose).toHaveBeenCalledTimes(1);
  openGraph.mockClear();
  onClose.mockClear();
  file.arrayBuffer.mockResolvedValue(new TextEncoder().encode('<svg><bad></svg>').buffer);
  fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not open file: XML:");
  expect(openGraph).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("file import records read, parse and construction stages and carries the run with its graph", async () => {
  window.history.replaceState({}, "", "/?benchmark=1");
  const openGraph = jest.fn();
  let run;
  try {
    render(<ImportModal openGraph={openGraph} />);
    fireEvent.click(screen.getByRole("button", { name: "Open", exact: true }));
    const file = new File([""], "input.json");
    file.text = jest.fn().mockResolvedValue('{"a":[1,2]}');
    fireEvent.change(screen.getByLabelText("Choose file"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
    await waitFor(() => expect(openGraph).toHaveBeenCalledTimes(1));
    run = benchmarkFor(openGraph.mock.calls[0][0]);
    expect(run).toBeDefined();
    expect(getBenchmarkRuns().at(-1)).toMatchObject({
      source: { kind: "file", type: "json", name: "input.json" },
      status: "running",
      stages: expect.arrayContaining([
        expect.objectContaining({ name: "File read and decode", kind: "async", calls: 1 }),
        expect.objectContaining({ name: "JSON parsing", kind: "sync", calls: 1 }),
        expect.objectContaining({ name: "Graph construction", kind: "sync", calls: 1 }),
      ]),
    });
    cancelBenchmark(run);
    file.text.mockResolvedValue('{broken');
    fireEvent.click(screen.getByRole("button", { name: "Import", exact: true }));
    await screen.findByRole("alert");
    expect(getBenchmarkRuns().at(-1).status).toBe("failed");
  } finally {
    cancelBenchmark(run);
    window.history.replaceState({}, "", "/");
  }
});
