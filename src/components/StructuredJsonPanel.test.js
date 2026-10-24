import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import StructuredJsonPanel from "./StructuredJsonPanel";
import { inspectJsonSelection, structuredJsonStatus } from "../structuredJson";
import { jsonKindAppearance } from "../structuredJsonAppearance";

jest.mock("../structuredJson", () => ({
  inspectJsonSelection: jest.fn(),
  structuredJsonStatus: jest.fn(),
}));

const descriptor = (overrides = {}) => ({
  nodeId: "number-1",
  kind: "number",
  text: "42",
  canEdit: true,
  canClear: true,
  canWrap: true,
  canReplace: true,
  canPaste: true,
  ...overrides,
});

let props;
beforeEach(() => {
  jest.resetAllMocks();
  inspectJsonSelection.mockReturnValue(descriptor());
  structuredJsonStatus.mockReturnValue({
    complete: true,
    slotCount: 0,
    issues: [],
  });
  props = {
    root: {},
    selectedNode: {},
    onCommand: jest.fn(),
    onSelect: jest.fn(),
    onSaveDraft: jest.fn(),
    onExportJson: jest.fn(),
  };
});

test("an unfinished numeric draft commits while focused without duplication when selection changes", () => {
  const { rerender } = render(<StructuredJsonPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Number" }), {
    target: { value: "-" },
  });
  expect(props.onCommand).toHaveBeenCalledWith(
    { type: "setText", text: "-" },
    "number-1"
  );
  inspectJsonSelection.mockReturnValue(
    descriptor({ nodeId: "string-2", kind: "string", text: "next" })
  );
  rerender(<StructuredJsonPanel {...props} selectedNode={{}} />);
  expect(props.onCommand).toHaveBeenCalledTimes(1);
  expect(props.onCommand).toHaveBeenCalledWith(
    { type: "setText", text: "-" },
    "number-1"
  );
  expect(screen.getByRole("textbox", { name: "String" })).toHaveValue("next");
  fireEvent.blur(screen.getByRole("textbox", { name: "String" }));
  expect(props.onCommand).toHaveBeenCalledTimes(1);
});

test("saving a draft applies pending text before saving, including partial numbers", () => {
  const calls = [];
  props.onCommand.mockImplementation((command) => calls.push(command));
  props.onSaveDraft.mockImplementation(() => calls.push("save"));
  render(<StructuredJsonPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Number" }), {
    target: { value: "-" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(calls).toEqual([{ type: "setText", text: "-" }, "save"]);
});

test("a failed draft edit remains available and prevents saving stale content", () => {
  props.onCommand.mockImplementation(() => {
    throw new Error("Cannot edit this document");
  });
  render(<StructuredJsonPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Number" }), {
    target: { value: "-" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(props.onSaveDraft).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Number" })).toHaveValue("-");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Cannot edit this document"
  );
});

test("an empty key slot can be explicitly filled with the valid empty key", () => {
  inspectJsonSelection.mockReturnValue(
    descriptor({
      kind: "key",
      text: "",
      isSlot: true,
      canReplace: false,
      canPaste: false,
    })
  );
  render(<StructuredJsonPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(props.onCommand).toHaveBeenCalledWith(
    { type: "setText", text: "" },
    "number-1"
  );
});

test("slot choices issue semantic commands and incomplete drafts cannot export JSON", () => {
  inspectJsonSelection.mockReturnValue(
    descriptor({ kind: "slot", text: "", canEdit: false, isSlot: true })
  );
  structuredJsonStatus.mockReturnValue({
    complete: false,
    slotCount: 1,
    issues: [{ nodeId: "number-1", message: "Value needed at $.volume" }],
  });
  render(<StructuredJsonPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Object" }));
  expect(props.onCommand).toHaveBeenCalledWith({
    type: "replace",
    kind: "object",
  });
  expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Value needed at $.volume" })
  );
  expect(props.onSelect).toHaveBeenCalledWith("number-1");
});

test("paste failures preserve pasted source for correction", () => {
  props.onCommand.mockImplementation(() => {
    throw new Error("Invalid JSON");
  });
  render(<StructuredJsonPanel {...props} />);
  fireEvent.click(screen.getByText("Paste JSON value"));
  fireEvent.change(
    screen.getByRole("textbox", { name: "JSON to place here" }),
    { target: { value: "[" } }
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Replace with pasted value" })
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON");
  expect(
    screen.getByRole("textbox", { name: "JSON to place here" })
  ).toHaveValue("[");
});

test("malformed graph metadata reports an error without rendering unsafe editing actions", () => {
  inspectJsonSelection.mockImplementation(() => {
    throw new Error("Unknown document version");
  });
  structuredJsonStatus.mockImplementation(() => {
    throw new Error("Unknown document version");
  });
  render(<StructuredJsonPanel {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Unknown document version"
  );
  expect(
    screen.queryByRole("region", { name: "Selected structure" })
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
});

test("type buttons share the graph palette and offer inline editing for text", () => {
  props.onEditValue = jest.fn();
  render(<StructuredJsonPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit in graph" }));
  expect(props.onEditValue).toHaveBeenCalledWith("number-1");
  fireEvent.click(screen.getByText("Replace value"));
  for (const kind of [
    "string",
    "number",
    "boolean",
    "null",
    "object",
    "array",
  ]) {
    const button = screen.getByRole("button", {
      name: kind[0].toUpperCase() + kind.slice(1),
      exact: true,
    });
    const colors = jsonKindAppearance(kind);
    expect(button.style.getPropertyValue("--json-type-background")).toBe(
      colors.backgroundColor
    );
    expect(button.style.getPropertyValue("--json-type-text")).toBe(
      colors.textColor
    );
  }
});

test("Enter finishes a string edit while Shift+Enter and IME composition remain text input", () => {
  props.onFinishEditing = jest.fn();
  inspectJsonSelection.mockReturnValue(
    descriptor({ kind: "string", text: "hello" })
  );
  render(<StructuredJsonPanel {...props} />);
  const field = screen.getByRole("textbox", { name: "String" });
  field.focus();
  const newline = createEvent.keyDown(field, { key: "Enter", shiftKey: true });
  fireEvent(field, newline);
  expect(newline.defaultPrevented).toBe(false);
  expect(field).toHaveFocus();
  const composition = createEvent.keyDown(field, {
    key: "Enter",
    isComposing: true,
  });
  fireEvent(field, composition);
  expect(composition.defaultPrevented).toBe(false);
  expect(props.onFinishEditing).not.toHaveBeenCalled();
  const finish = createEvent.keyDown(field, { key: "Enter" });
  fireEvent(field, finish);
  expect(finish.defaultPrevented).toBe(true);
  expect(props.onFinishEditing).toHaveBeenCalledTimes(1);
  expect(field).not.toHaveFocus();
});

test("Enter keeps a failed text edit focused so it can be corrected", () => {
  props.onFinishEditing = jest.fn();
  props.onCommand.mockImplementation(() => {
    throw new Error("Unable to save this edit");
  });
  render(<StructuredJsonPanel {...props} />);
  const field = screen.getByRole("textbox", { name: "Number" });
  field.focus();
  fireEvent.change(field, { target: { value: "-" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(field).toHaveFocus();
  expect(props.onFinishEditing).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Unable to save this edit"
  );
});

test("the real document model supports slots, focused partial text, draft round trips, wrapping and undo", () => {
  const model = jest.requireActual("../structuredJson");
  const documents = jest.requireActual("../graphDocument");
  inspectJsonSelection.mockImplementation(model.inspectJsonSelection);
  structuredJsonStatus.mockImplementation(model.structuredJsonStatus);
  let active;
  let saved;
  function Harness() {
    const [view, setView] = useState(() => {
      const root = model.createStructuredJson({});
      return { root, selectedNode: root };
    });
    const current = useRef(view);
    const history = useRef([view]);
    active = view;
    const command = useCallback((action, nodeId) => {
      const before = current.current;
      const target = nodeId
        ? documents.graphNodes(before.root).find((node) => node.id() === nodeId)
        : before.selectedNode;
      const next = model.applyJsonCommand(before.root, target, action);
      current.current = next;
      history.current.push(next);
      setView(next);
    }, []);
    return (
      <>
        <StructuredJsonPanel
          {...view}
          onCommand={command}
          onSelect={(nodeId) => {
            const next = {
              root: current.current.root,
              selectedNode: documents
                .graphNodes(current.current.root)
                .find((node) => node.id() === nodeId),
            };
            current.current = next;
            setView(next);
          }}
          onSaveDraft={() => {
            saved = documents.writeGraph(
              current.current.root,
              null,
              undefined,
              1
            );
          }}
          onExportJson={() => model.exportStructuredJson(current.current.root)}
        />
        <button
          onClick={() => {
            history.current.pop();
            const previous = history.current[history.current.length - 1];
            current.current = previous;
            setView(previous);
          }}
        >
          Undo draft
        </button>
      </>
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Add member" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Key" }), {
    target: { value: "volume" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Choose a value for this slot/ })
  );
  fireEvent.click(screen.getByRole("button", { name: "Number" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Number" }), {
    target: { value: "-" },
  });
  expect(model.structuredJsonStatus(active.root).slotCount).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const recovered = documents.readGraph(saved);
  expect(model.structuredJsonStatus(recovered).slotCount).toBe(1);
  expect(
    documents.graphNodes(recovered).some((node) => node.value() === "-")
  ).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Number" }), {
    target: { value: "12" },
  });
  expect(model.exportStructuredJson(active.root)).toEqual({ volume: 12 });
  fireEvent.click(screen.getByRole("button", { name: "Wrap in array" }));
  expect(model.exportStructuredJson(active.root)).toEqual({ volume: [12] });
  fireEvent.click(screen.getByRole("button", { name: "Undo draft" }));
  expect(screen.getByRole("textbox", { name: "Number" })).toHaveValue("12");
  fireEvent.click(screen.getByRole("button", { name: "Undo draft" }));
  expect(screen.getByRole("textbox", { name: "Number" })).toHaveValue("-");
  expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
});
