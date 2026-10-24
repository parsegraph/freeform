import { render, screen, fireEvent } from "@testing-library/react";
import ExportModal from "./ExportModal";
import fixture from "../fixtures/v1/appearance-colors.json";
import { readGraph } from "../graphDocument";
import { graphXml } from "../xmlGraph";
import { createJsonDraft, createStructuredJson, structuredJsonStatus } from "../structuredJson";

afterEach(() => jest.restoreAllMocks());

test("incomplete JSON blocks source export but can be downloaded as a recoverable v1 draft", () => {
  const root = createJsonDraft();
  const downloads = [];
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push(JSON.parse(decodeURIComponent(this.getAttribute("href").split(",").slice(1).join(","))));
  });
  const onExport = jest.fn();
  render(<ExportModal graph={root} viewport={{ node: () => root, toJSON: () => ({}) }} initialFormat="json" onExport={onExport} />);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(screen.getByRole("alert")).toHaveTextContent("Save a Parsegraph draft");
  expect(downloads).toHaveLength(0);
  expect(onExport).not.toHaveBeenCalled();
  expect(screen.queryByRole("option", { name: /legacy/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "parsegraph" } });
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(downloads).toHaveLength(1);
  expect(downloads[0].version).toBe(1);
  expect(structuredJsonStatus(readGraph(downloads[0]))).toMatchObject({ complete: false, slotCount: 2 });
});

test("complete structured JSON exports its content rather than graph metadata", () => {
  const root = createStructuredJson({ empty: [], object: {}, value: null, text: "" });
  let downloaded;
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloaded = this.getAttribute("href");
  });
  render(<ExportModal graph={root} viewport={{}} initialFormat="json" />);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(downloaded).toBe(`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ empty: [], object: {}, value: null, text: "" }, null, 2))}`);
});

test("export writes the edited v1 document and makes legacy export explicitly lossy", () => {
  const data = JSON.parse(JSON.stringify(fixture));
  data.capabilities["future/1"] = { payload: [true, "preserved"] };
  const root = readGraph(data);
  root.setValue("Edited on screen");
  const appearance = data.capabilities["appearance/1"];
  const viewport = {
    node: () => root,
    toJSON: () => ({
      defaultNodeStyle: appearance.defaults,
      styles: appearance.nodeStyles,
      pageBackgroundColor: "rgba(241,245,249,0.5)",
      cam: { cameraX: 10, cameraY: 20, scale: 2 },
    }),
  };
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
  render(<ExportModal graph={root} viewport={viewport} />);
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(downloads).toHaveLength(1);
  expect(downloads[0].version).toBe(1);
  expect(downloads[0].nodes.find((node) => node.id === "root").value).toBe(
    "Edited on screen"
  );
  expect(downloads[0].capabilities).toEqual(data.capabilities);
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "parsegraph-v0" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("discards");
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(downloads[1].version).toBeUndefined();
  expect(downloads[1].viewport.styles).toEqual(appearance.nodeStyles);
  jest.restoreAllMocks();
});

test("XML and SVG exports download source with the right MIME types and suffixes", () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg">\n <text>A &amp; B</text>\n</svg>';
  const root = graphXml(source);
  const downloads = [];
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    downloads.push({ href: this.getAttribute("href"), name: this.getAttribute("download") });
  });
  render(<ExportModal graph={root} viewport={{}} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "xml" } });
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(downloads[0]).toEqual({ name: "document.xml", href: `data:application/xml;charset=utf-8,${encodeURIComponent(source)}` });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "svg" } });
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(downloads[1]).toEqual({ name: "document.svg", href: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}` });
});

test("invalid XML graph edits fail visibly without closing the exporter or claiming a save", () => {
  const root = graphXml("<root/>");
  const onClose = jest.fn();
  const onExport = jest.fn();
  const download = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  render(<ExportModal graph={root} viewport={{}} onClose={onClose} onExport={onExport} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "svg" } });
  fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(screen.getByRole("alert")).toHaveTextContent("SVG export requires");
  expect(download).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(onExport).not.toHaveBeenCalled();
});
