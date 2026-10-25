import { useEffect, useState } from "react";
import { loadDocumentLink } from "../documentLink";
import { beginBenchmark, cancelBenchmark, failBenchmark } from "../benchmark";

function linkedDocumentName(url) {
  const filename = new URL(url, window.location.href).pathname.split("/").pop();
  if (!filename) return "Linked document";
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

export default function DocumentImport({ documentURL, openGraph, onCancel }) {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    let handedOff = false;
    const benchmark = beginBenchmark({
      kind: "document link",
      name: documentURL,
    });
    setError(null);
    loadDocumentLink(documentURL, controller.signal, benchmark)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        openGraph(
          loaded.graph,
          loaded.selectedNode,
          null,
          loaded.viewportData,
          null,
          undefined,
          loaded.url,
          linkedDocumentName(loaded.url)
        );
        handedOff = true;
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        failBenchmark(benchmark, err);
        setError(`Could not open document: ${err.message}`);
      });
    return () => {
      controller.abort();
      if (!handedOff) cancelBenchmark(benchmark);
    };
  }, [documentURL, openGraph, attempt]);

  return (
    <div
      className="document-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="linked-document-title"
    >
      <p className="document-eyebrow">GALLERY</p>
      <h2 id="linked-document-title">Open gallery document</h2>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p role="status">Loading Parsegraph…</p>
      )}
      <p className="document-note document-source-url">{documentURL}</p>
      <div className="buttons">
        {error && (
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        )}
        <button onClick={onCancel}>Choose another document</button>
      </div>
    </div>
  );
}
