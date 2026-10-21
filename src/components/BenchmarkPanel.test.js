import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import BenchmarkPanel from "./BenchmarkPanel";
import {
  benchmarkEnabled,
  getBenchmarkEvents,
  getBenchmarkRuns,
  subscribeBenchmarks,
} from "../benchmark";

jest.mock("../benchmark", () => ({
  benchmarkEnabled: jest.fn(),
  getBenchmarkEvents: jest.fn(),
  getBenchmarkRuns: jest.fn(),
  subscribeBenchmarks: jest.fn(),
}));

function run(id, name, status = "complete") {
  return {
    id,
    source: { kind: "file", type: "xml", name, bytes: 100 },
    status,
    elapsedMs: 150,
    milestones: { firstRenderPassMs: 140 },
    stages: [],
    responsiveness: {
      maxFrameGapMs: 80,
      frameGapsOver50Ms: 1,
      longTasksSupported: false,
    },
    environment: {
      userAgent: "test browser",
      viewport: { width: 800, height: 600 },
      devicePixelRatio: 1,
      visibility: "visible",
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  benchmarkEnabled.mockReturnValue(true);
  getBenchmarkRuns.mockReturnValue([]);
  getBenchmarkEvents.mockReturnValue([]);
  subscribeBenchmarks.mockReturnValue(jest.fn());
});

test("stays absent and does not subscribe when benchmarking is disabled", () => {
  benchmarkEnabled.mockReturnValue(false);
  const { container } = render(<BenchmarkPanel />);
  expect(container).toBeEmptyDOMElement();
  expect(subscribeBenchmarks).not.toHaveBeenCalled();
});

test("follows lifecycle updates, allows inspecting older runs, and unsubscribes", () => {
  let listener;
  const unsubscribe = jest.fn();
  subscribeBenchmarks.mockImplementation((update) => {
    listener = update;
    return unsubscribe;
  });
  getBenchmarkRuns.mockReturnValue([run("a", "first.xml", "running")]);
  const { unmount } = render(<BenchmarkPanel />);
  expect(screen.getByRole("status")).toHaveTextContent("Recording");

  getBenchmarkRuns.mockReturnValue([
    run("a", "first.xml"),
    run("b", "second.xml"),
  ]);
  act(() => listener());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByText("second.xml · 100 bytes")).toBeInTheDocument();
  expect(
    screen.getByText(/Long-task reporting unavailable/)
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Run" }), {
    target: { value: "a" },
  });
  expect(screen.getByText("first.xml · 100 bytes")).toBeInTheDocument();
  unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test.each([
  ["JSON", "freeform-benchmarks.json", "application/json"],
  ["JSONL", "freeform-benchmark-events.jsonl", "application/x-ndjson"],
])(
  "exports all retained %s data, regardless of the selected older run",
  async (format, filename, type) => {
    const reports = [run("a", "first.xml"), run("b", "second.xml")];
    const events = [
      { type: "begin", runId: "a", atMs: 0 },
      { type: "begin", runId: "b", atMs: 0 },
    ];
    getBenchmarkRuns.mockReturnValue(reports);
    getBenchmarkEvents.mockReturnValue(events);
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:benchmark");
    URL.revokeObjectURL = jest.fn();
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function () {
        expect(this.download).toBe(filename);
        expect(this.href).toBe("blob:benchmark");
      });
    try {
      render(<BenchmarkPanel />);
      fireEvent.change(screen.getByRole("combobox", { name: "Run" }), {
        target: { value: "a" },
      });
      fireEvent.click(screen.getByRole("button", { name: `Export ${format}` }));
      expect(click).toHaveBeenCalledTimes(1);
      const blob = URL.createObjectURL.mock.calls[0][0];
      const contents = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(blob);
      });
      expect(blob.type).toBe(type);
      if (format === "JSON") {
        expect(JSON.parse(contents)).toEqual(reports);
      } else {
        expect(contents.endsWith("\n")).toBe(true);
        expect(
          contents
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        ).toEqual(events);
      }
      await waitFor(() =>
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:benchmark")
      );
    } finally {
      click.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  }
);

test("populates the copyable trace only when opened after recording", () => {
  let listener;
  subscribeBenchmarks.mockImplementation((update) => {
    listener = update;
    return jest.fn();
  });
  getBenchmarkRuns.mockReturnValue([run("a", "first.xml", "running")]);
  const events = [{ type: "begin", runId: "a", atMs: 0 }];
  getBenchmarkEvents.mockReturnValue(events);
  render(<BenchmarkPanel />);
  expect(getBenchmarkEvents).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "Benchmark event trace" })
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export JSONL" })).toBeDisabled();

  const details = screen.getByText("Event trace (JSONL)").parentElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(
    screen.getByText(/trace will be available when recording ends/)
  ).toBeInTheDocument();
  expect(getBenchmarkEvents).not.toHaveBeenCalled();

  getBenchmarkRuns.mockReturnValue([run("a", "first.xml")]);
  act(() => listener());
  const textarea = screen.getByRole("textbox", {
    name: "Benchmark event trace",
  });
  expect(textarea).toHaveValue(`${JSON.stringify(events[0])}\n`);
  expect(textarea).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Export JSONL" })).toBeEnabled();
});
