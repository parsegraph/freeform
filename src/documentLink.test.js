import { loadDocumentLink, resolveDocumentLink } from "./documentLink";
import {
  documentState,
  graphViewport,
  graphSelection,
  readGraph,
  writeGraph,
} from "./graphDocument";
import fixture from "./fixtures/v1/appearance-colors.json";

afterEach(() => {
  delete global.fetch;
});

test("resolves root-relative, sibling-relative, and same-origin absolute documents", () => {
  const base = "https://site.test/freeform/";
  for (const value of [
    "/examples/colors.parsegraph",
    "../examples/colors.parsegraph",
    "https://site.test/examples/colors.parsegraph#node",
  ]) {
    expect(resolveDocumentLink(value, base).href).toBe(
      "https://site.test/examples/colors.parsegraph"
    );
  }
  expect(
    resolveDocumentLink("/examples/a%20b.parsegraph?v=2", base).search
  ).toBe("?v=2");
});

test.each([
  "",
  " ",
  "https://other.test/graph",
  "//other.test/graph",
  "javascript:alert(1)",
  "data:application/json,{}",
  "file:///tmp/a",
  "https://user:pass@site.test/graph",
  "http://site.test/graph",
])("rejects unsupported document link %s", (value) => {
  expect(() =>
    resolveDocumentLink(value, "https://site.test/freeform/")
  ).toThrow();
});

test.each([0, 1])(
  "uses the existing v%s importer with camera and selection",
  async (version) => {
    const root = readGraph(fixture);
    const cam = { cameraX: 20, cameraY: -30, scale: 0.8 };
    const document = writeGraph(root, root, { cam, showingUI: false }, version);
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify(document),
      });
    const signal = new AbortController().signal;
    const loaded = await loadDocumentLink(
      "/examples/colors.parsegraph",
      signal
    );
    expect(fetch).toHaveBeenCalledWith(
      `${window.location.origin}/examples/colors.parsegraph`,
      {
        signal,
        mode: "same-origin",
        credentials: "same-origin",
        redirect: "error",
      }
    );
    expect(loaded.selectedNode).toBe(graphSelection(document));
    expect(loaded.viewportData).toEqual(graphViewport(document));
    expect(loaded.url).toBe("/examples/colors.parsegraph");
    if (version === 1)
      expect(documentState(loaded.graph).capabilities).toEqual(
        document.capabilities
      );
  }
);

test("HTTP errors, malformed JSON, and unsupported documents fail without opening a graph", async () => {
  const signal = new AbortController().signal;
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
  await expect(loadDocumentLink("/missing", signal)).rejects.toThrow(
    "HTTP 404"
  );
  fetch.mockResolvedValue({
    ok: true,
    text: async () => "<html>not a document</html>",
  });
  await expect(loadDocumentLink("/missing", signal)).rejects.toThrow();
  fetch.mockResolvedValue({
    ok: true,
    text: async () => JSON.stringify({ ...fixture, version: 999 }),
  });
  await expect(loadDocumentLink("/unsupported", signal)).rejects.toThrow();
});
