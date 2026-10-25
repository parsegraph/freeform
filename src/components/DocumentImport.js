import { useEffect, useState } from "react";
import { loadDocumentLink } from "../documentLink";
import { beginBenchmark, cancelBenchmark, failBenchmark } from "../benchmark";

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
          loaded.url
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
    <div style={{ padding: "12px" }}>
      <h3>Open gallery document</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <p role="status">Loading Parsegraph…</p>
      )}
      <p style={{ overflowWrap: "anywhere" }}>{documentURL}</p>
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
