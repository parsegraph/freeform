import { StrictMode } from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import ImportModal from "./ImportModal";
import { createExample, loadExample } from "../examples";

jest.mock("../examples", () => ({
  createExample: jest.fn((type, options) => ({ type, ...options })),
  loadExample: jest.fn(),
}));

const example = { type: "cross", rounds: 3 };
const loaded = { graph: {}, selectedNode: null, viewportData: { styles: {} }, example };

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
