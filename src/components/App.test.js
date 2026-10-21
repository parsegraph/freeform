import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("./Viewport/Viewport", () =>
  jest.fn().mockImplementation(() => {
    let container, root;
    const rendering = {
      setOffscreenHandler: jest.fn(),
      setOnUI: jest.fn(),
      showingUI: () => false,
    };
    return {
      mount: (element) => {
        container = element;
      },
      container: () => container,
      rendering: () => rendering,
      show: (graph) => {
        root = graph;
      },
      widget: () => root,
      node: () => root,
      setSaveGraph: jest.fn(),
      setUndo: jest.fn(),
      setRedo: jest.fn(),
      setToggleNodeActions: jest.fn(),
      setToggleNodeStyling: jest.fn(),
      moveToId: jest.fn(),
      showInCamera: jest.fn(),
    };
  })
);

jest.mock(
  "./ImportModal",
  () =>
    function ImportFixture({ openGraph }) {
      const { readGraph } = require("../graphDocument");
      const data = JSON.parse(
        JSON.stringify(require("../fixtures/v1/appearance-colors.json"))
      );
      data.capabilities["future/1"] = { note: "preserve me" };
      return (
        <button onClick={() => openGraph(readGraph(data))}>Open fixture</button>
      );
    }
);

beforeAll(() => {
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: { randomUUID: () => "test-session" },
  });
});

test("opening a v1 document exposes applied and preserved capabilities", () => {
  const App = require("./App").default;
  localStorage.clear();
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Open fixture" }));
  expect(
    screen.queryByRole("button", { name: "Open fixture" })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Document capabilities"));
  expect(screen.getByText(/Presentation applied/)).toHaveTextContent(
    "Appearance applied"
  );
  expect(
    screen.getByText(/Preserved without interpretation/)
  ).toHaveTextContent("future/1");
});
