import {
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import StructuredLispPanel from "./StructuredLispPanel";
import { useCallback, useRef, useState } from "react";
import { inspectLispSelection, structuredLispStatus } from "../structuredLisp";
import { lispKindAppearance } from "../structuredLispAppearance";

jest.mock("../structuredLisp", () => ({
  inspectLispSelection: jest.fn(),
  structuredLispStatus: jest.fn(),
}));

const descriptor = (overrides = {}) => ({
  nodeId: "form-1",
  kind: "symbol",
  text: "volume",
  canEdit: true,
  canClear: true,
  canWrap: true,
  canReplace: true,
  canPaste: true,
  path: "$[0]",
  ...overrides,
});

let props;
beforeEach(() => {
  jest.resetAllMocks();
  inspectLispSelection.mockReturnValue(descriptor());
  structuredLispStatus.mockReturnValue({
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
    onExportLisp: jest.fn(),
  };
});

test("raw source tokens commit while focused to their original node", () => {
  inspectLispSelection.mockReturnValue(
    descriptor({ kind: "string", text: '"hello"' })
  );
  const { rerender } = render(<StructuredLispPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "String" }), {
    target: { value: '"unfinished' },
  });
  expect(props.onCommand).toHaveBeenCalledWith(
    { type: "setText", text: '"unfinished' },
    "form-1"
  );
  inspectLispSelection.mockReturnValue(
    descriptor({ nodeId: "form-2", text: "next" })
  );
  rerender(<StructuredLispPanel {...props} selectedNode={{}} />);
  expect(props.onCommand).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Symbol" })).toHaveValue("next");
});

test("escaped symbols retain literal newlines when edited", () => {
  inspectLispSelection.mockReturnValue(descriptor({ text: "|first\nsecond|" }));
  render(<StructuredLispPanel {...props} />);
  const field = screen.getByRole("textbox", { name: "Symbol" });
  expect(field).toHaveValue("|first\nsecond|");
  fireEvent.change(field, { target: { value: "|first\nthird|" } });
  expect(props.onCommand).toHaveBeenCalledWith(
    { type: "setText", text: "|first\nthird|" },
    "form-1"
  );
});

test("failed source edits remain editable and block saving stale content", () => {
  props.onCommand.mockReturnValue(false);
  render(<StructuredLispPanel {...props} />);
  const field = screen.getByRole("textbox", { name: "Symbol" });
  fireEvent.change(field, { target: { value: "|unfinished" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(props.onSaveDraft).not.toHaveBeenCalled();
  expect(field).toHaveValue("|unfinished");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your text is still here"
  );
  expect(
    screen.getByRole("button", { name: "Export Lisp/Scheme" })
  ).toBeDisabled();
  props.onCommand.mockReturnValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(props.onSaveDraft).toHaveBeenCalledTimes(1);
});

test("a failed edit on a previous selection still blocks saving and is restored when reselected", () => {
  props.onCommand.mockReturnValue(false);
  const { rerender } = render(<StructuredLispPanel {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Symbol" }), {
    target: { value: "|unfinished" },
  });
  inspectLispSelection.mockReturnValue(
    descriptor({ nodeId: "form-2", text: "next" })
  );
  rerender(<StructuredLispPanel {...props} selectedNode={{}} />);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(props.onSaveDraft).not.toHaveBeenCalled();
  expect(props.onCommand).toHaveBeenLastCalledWith(
    { type: "setText", text: "|unfinished" },
    "form-1"
  );
  expect(
    screen.getByRole("button", { name: "Export Lisp/Scheme" })
  ).toBeDisabled();
  inspectLispSelection.mockReturnValue(descriptor());
  rerender(<StructuredLispPanel {...props} selectedNode={{}} />);
  expect(screen.getByRole("textbox", { name: "Symbol" })).toHaveValue(
    "|unfinished"
  );
});

test("slots expose applicable types, use their graph palette, and incomplete drafts cannot export", () => {
  inspectLispSelection.mockReturnValue(
    descriptor({
      kind: "slot",
      text: "",
      isSlot: true,
      canEdit: false,
      allowedKinds: ["number", "comment", "block-comment"],
      canWrap: false,
    })
  );
  structuredLispStatus.mockReturnValue({
    complete: false,
    slotCount: 1,
    issues: [{ nodeId: "form-1", message: "Choose a byte value" }],
  });
  render(
    <StructuredLispPanel
      {...props}
      recoveryMessage="Draft saved on this device."
    />
  );
  const number = screen.getByRole("button", { name: "Number", exact: true });
  expect(number.style.getPropertyValue("--json-type-background")).toBe(
    lispKindAppearance("number").backgroundColor
  );
  expect(
    screen.queryByRole("button", { name: "Symbol", exact: true })
  ).not.toBeInTheDocument();
  fireEvent.click(number);
  expect(props.onCommand).toHaveBeenCalledWith({
    type: "replace",
    kind: "number",
  });
  expect(
    screen.getByRole("button", { name: "Export Lisp/Scheme" })
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Choose a byte value" }));
  expect(props.onSelect).toHaveBeenCalledWith("form-1");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Draft saved on this device"
  );
});

test("document controls add forms and clear the document without offering replacement", () => {
  inspectLispSelection.mockReturnValue(
    descriptor({
      kind: "document",
      canEdit: false,
      canAdd: true,
      canWrap: false,
      canReplace: false,
      entryCount: 2,
    })
  );
  render(<StructuredLispPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Add form" }));
  expect(props.onCommand).toHaveBeenLastCalledWith({ type: "add" });
  fireEvent.click(screen.getByRole("button", { name: "Clear document" }));
  expect(props.onCommand).toHaveBeenLastCalledWith({ type: "clear" });
  expect(screen.getByText("2 forms")).toBeInTheDocument();
  expect(screen.queryByText("Replace form")).not.toBeInTheDocument();
});

test("entry controls preserve insertion direction, ordering, and dotted-tail commands", () => {
  inspectLispSelection.mockReturnValue(
    descriptor({
      kind: "list",
      canEdit: false,
      canAdd: true,
      canInsertSibling: true,
      canMoveEarlier: true,
      canMoveLater: true,
      canRemove: true,
      canAddTail: true,
    })
  );
  const { rerender } = render(<StructuredLispPanel {...props} />);
  const actions = [
    ["Add item", { type: "add" }],
    ["Insert before", { type: "insertSibling", offset: -1 }],
    ["Insert after", { type: "insertSibling", offset: 1 }],
    ["Insert on new line", { type: "insertSibling", newline: true }],
    ["Move earlier", { type: "move", offset: -1 }],
    ["Move later", { type: "move", offset: 1 }],
    ["Remove entry", { type: "remove" }],
    ["Add dotted tail", { type: "addTail" }],
  ];
  actions.forEach(([label, action]) => {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(props.onCommand).toHaveBeenLastCalledWith(action);
  });
  inspectLispSelection.mockReturnValue(
    descriptor({
      kind: "dotted-tail",
      canEdit: false,
      canReplace: false,
      canWrap: false,
      canRemoveTail: true,
    })
  );
  rerender(<StructuredLispPanel {...props} selectedNode={{}} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove dotted tail" }));
  expect(props.onCommand).toHaveBeenLastCalledWith({ type: "removeTail" });
});

test("line controls split and join source rows without joining across a line comment", () => {
  inspectLispSelection.mockReturnValue(
    descriptor({ canBreakLine: true, startsLine: false, canJoinLine: true })
  );
  const { rerender } = render(<StructuredLispPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Start new line" }));
  expect(props.onCommand).toHaveBeenLastCalledWith({
    type: "setLineBreak",
    enabled: true,
  });
  inspectLispSelection.mockReturnValue(
    descriptor({ canBreakLine: true, startsLine: true, canJoinLine: true })
  );
  rerender(<StructuredLispPanel {...props} selectedNode={{}} />);
  fireEvent.click(screen.getByRole("button", { name: "Join previous line" }));
  expect(props.onCommand).toHaveBeenLastCalledWith({
    type: "setLineBreak",
    enabled: false,
  });
  inspectLispSelection.mockReturnValue(
    descriptor({ canBreakLine: true, startsLine: true, canJoinLine: false })
  );
  rerender(<StructuredLispPanel {...props} selectedNode={{}} />);
  expect(
    screen.getByRole("button", { name: "Join previous line" })
  ).toBeDisabled();
});

test("wrapping offers only grammar-compatible wrappers", () => {
  inspectLispSelection.mockReturnValue(
    descriptor({ wrapKinds: ["datum-comment"] })
  );
  render(<StructuredLispPanel {...props} />);
  fireEvent.click(screen.getByText("Wrap form"));
  const wrapping = within(screen.getByText("Wrap form").closest("details"));
  expect(
    wrapping.queryByRole("button", { name: "Quote" })
  ).not.toBeInTheDocument();
  fireEvent.click(wrapping.getByRole("button", { name: "Datum comment" }));
  expect(props.onCommand).toHaveBeenCalledWith({
    type: "wrap",
    kind: "datum-comment",
  });
});

test("paste errors retain the source for correction", () => {
  props.onCommand.mockImplementation(() => {
    throw new Error("Unclosed list");
  });
  render(<StructuredLispPanel {...props} />);
  fireEvent.click(screen.getByText("Paste Lisp/Scheme source"));
  const field = screen.getByRole("textbox", { name: "Source to place here" });
  fireEvent.change(field, { target: { value: "(define x" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Replace with pasted source" })
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Unclosed list");
  expect(field).toHaveValue("(define x");
  props.onCommand.mockReturnValue(undefined);
  fireEvent.change(field, { target: { value: "(define x 1)" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Replace with pasted source" })
  );
  expect(props.onCommand).toHaveBeenLastCalledWith({
    type: "paste",
    text: "(define x 1)",
  });
  expect(field).toHaveValue("");
});

test("inline editing and Enter preserve source text, newline input, and IME composition", () => {
  props.onEditValue = jest.fn();
  props.onFinishEditing = jest.fn();
  inspectLispSelection.mockReturnValue(
    descriptor({ kind: "string", text: '"hello"' })
  );
  render(<StructuredLispPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit in graph" }));
  expect(props.onEditValue).toHaveBeenCalledWith("form-1");
  const field = screen.getByRole("textbox", { name: "String" });
  field.focus();
  for (const event of [
    createEvent.keyDown(field, { key: "Enter", shiftKey: true }),
    createEvent.keyDown(field, { key: "Enter", isComposing: true }),
  ]) {
    fireEvent(field, event);
    expect(event.defaultPrevented).toBe(false);
    expect(field).toHaveFocus();
  }
  fireEvent.keyDown(field, { key: "Enter" });
  expect(props.onFinishEditing).toHaveBeenCalledTimes(1);
  expect(field).not.toHaveFocus();
});

test("malformed metadata reports a problem without offering editing actions", () => {
  inspectLispSelection.mockImplementation(() => {
    throw new Error("Unknown Lisp draft version");
  });
  structuredLispStatus.mockImplementation(() => {
    throw new Error("Unknown Lisp draft version");
  });
  render(<StructuredLispPanel {...props} />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Unknown Lisp draft version"
  );
  expect(
    screen.queryByRole("region", { name: "Selected structure" })
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Export Lisp/Scheme" })
  ).toBeDisabled();
});

test("the real editor preserves unfinished source through draft saves, then wraps and undoes a complete form", () => {
  const model = jest.requireActual("../structuredLisp");
  const documents = jest.requireActual("../graphDocument");
  inspectLispSelection.mockImplementation(model.inspectLispSelection);
  structuredLispStatus.mockImplementation(model.structuredLispStatus);
  let active;
  let saved;
  function Harness() {
    const [view, setView] = useState(() => {
      const root = model.createStructuredLisp("");
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
      const next = model.applyLispCommand(before.root, target, action);
      current.current = next;
      history.current.push(next);
      setView(next);
    }, []);
    return (
      <>
        <StructuredLispPanel
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
            saved = documents.writeGraph(current.current.root);
          }}
          onExportLisp={() => model.exportStructuredLisp(current.current.root)}
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
  fireEvent.click(screen.getByRole("button", { name: "Add form" }));
  fireEvent.click(screen.getByRole("button", { name: "String", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "String" }), {
    target: { value: '"unfinished' },
  });
  expect(model.structuredLispStatus(active.root).slotCount).toBe(1);
  expect(
    screen.getByRole("button", { name: "Export Lisp/Scheme" })
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const recovered = documents.readGraph(saved);
  expect(model.structuredLispStatus(recovered).slotCount).toBe(1);
  expect(
    documents
      .graphNodes(recovered)
      .some((node) => node.value() === '"unfinished')
  ).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "String" }), {
    target: { value: '"ready"' },
  });
  expect(model.exportStructuredLisp(active.root)).toBe('"ready"');
  fireEvent.click(screen.getByText("Wrap form"));
  fireEvent.click(screen.getByRole("button", { name: "Quote", exact: true }));
  expect(model.exportStructuredLisp(active.root)).toBe('\'"ready"');
  fireEvent.click(screen.getByRole("button", { name: "Undo draft" }));
  expect(screen.getByRole("textbox", { name: "String" })).toHaveValue(
    '"ready"'
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo draft" }));
  expect(screen.getByRole("textbox", { name: "String" })).toHaveValue(
    '"unfinished'
  );
  expect(
    screen.getByRole("button", { name: "Export Lisp/Scheme" })
  ).toBeDisabled();
});

test("the real line controls change source grouping and native drafts retain it", () => {
  const model = jest.requireActual("../structuredLisp");
  const documents = jest.requireActual("../graphDocument");
  inspectLispSelection.mockImplementation(model.inspectLispSelection);
  structuredLispStatus.mockImplementation(model.structuredLispStatus);
  const source = "(sum a b)\n(next)\n";
  let active;
  let saved;
  function Harness() {
    const [view, setView] = useState(() => {
      const root = model.createStructuredLisp(source);
      return { root, selectedNode: documents.graphNodes(root).find(node => node.value() === "b") };
    });
    active = view;
    return <StructuredLispPanel {...view}
      onCommand={command => setView(current => model.applyLispCommand(current.root, current.selectedNode, command))}
      onSaveDraft={() => { saved = documents.writeGraph(view.root, view.selectedNode); }}
    />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Start new line" }));
  expect(model.inspectLispSelection(active.root, active.selectedNode).startsLine).toBe(true);
  expect(model.exportStructuredLisp(active.root)).toMatch(/\(sum a\s*\n[ \t]*b\)/);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  const restored = documents.readGraph(saved);
  expect(model.inspectLispSelection(restored, active.selectedNode.id()).startsLine).toBe(true);
  expect(model.exportStructuredLisp(restored)).toBe(model.exportStructuredLisp(active.root));
  fireEvent.click(screen.getByRole("button", { name: "Join previous line" }));
  expect(model.exportStructuredLisp(active.root)).toBe(source);
  fireEvent.click(screen.getByRole("button", { name: "Insert on new line" }));
  expect(model.inspectLispSelection(active.root, active.selectedNode)).toMatchObject({kind: "slot", startsLine: true});
  expect(screen.getByRole("button", { name: "Export Lisp/Scheme" })).toBeDisabled();
});
