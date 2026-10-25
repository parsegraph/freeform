import { readGraph, graphSelection, graphViewport } from "./graphDocument";
import {
  attachBenchmark,
  measureBenchmark,
  measureBenchmarkAsync,
} from "./benchmark";

// Gallery links name a document on the editor's own origin, not a generator recipe.
export function resolveDocumentLink(value, location = window.location.href) {
  if (!value?.trim()) throw new Error("The document link is empty.");
  const base = new URL(location);
  const url = new URL(value, base);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.origin !== base.origin ||
    url.username ||
    url.password
  ) {
    throw new Error("Document links must point to this website.");
  }
  url.hash = "";
  return url;
}

export async function loadDocumentLink(value, signal, benchmark) {
  const url = resolveDocumentLink(value);
  const text = await measureBenchmarkAsync(
    benchmark,
    "Document download",
    async () => {
      const response = await fetch(url.href, {
        signal,
        mode: "same-origin",
        credentials: "same-origin",
        redirect: "error",
      });
      if (!response.ok)
        throw new Error(`The server returned HTTP ${response.status}.`);
      return response.text();
    }
  );
  if (signal.aborted) throw new DOMException("Load cancelled", "AbortError");
  const data = measureBenchmark(benchmark, "JSON parsing", () =>
    JSON.parse(text)
  );
  const graph = attachBenchmark(
    measureBenchmark(benchmark, "Graph construction", () => readGraph(data)),
    benchmark
  );
  return {
    graph,
    selectedNode: graphSelection(data),
    viewportData: graphViewport(data),
    url: url.pathname + url.search,
  };
}
