import { readGraph } from "./graphDocument";
import { inspectJsonSelection, isStructuredJson } from "./structuredJson";

export const JSON_RECOVERY_KEY = "parsegraph-json-draft";
const RECOVERY_VERSION = 1;

function storageFor(storage) {
  return storage === undefined ? window.localStorage : storage;
}

function validateDocument(document) {
  if (document?.format !== "parsegraph" || document.version !== 1) {
    throw new Error("Recovery requires a Parsegraph v1 document.");
  }
  const root = readGraph(document);
  if (!isStructuredJson(root)) {
    throw new Error("The saved document is not a structured JSON draft.");
  }
  // Decode the graph's typed structure, without requiring complete JSON values.
  // Slots and unfinished tokens are recoverable; corrupt topology or metadata
  // must not replace a working recovery record.
  inspectJsonSelection(root, root);
}

/** Read the latest draft without modifying it, including when validation fails. */
export function readJsonRecovery(storage) {
  try {
    const raw = storageFor(storage).getItem(JSON_RECOVERY_KEY);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (record?.version !== RECOVERY_VERSION) {
      throw new Error("Unsupported JSON draft recovery version.");
    }
    if (!Number.isFinite(record.savedAt) || record.savedAt < 0) {
      throw new Error("The JSON draft recovery timestamp is invalid.");
    }
    validateDocument(record.document);
    return { document: record.document, savedAt: record.savedAt };
  } catch (error) {
    throw new Error(
      `Could not restore the JSON draft: ${error.message} The stored draft has been kept.`
    );
  }
}

/** Replace the one recovery record only after the complete draft is validated. */
export function writeJsonRecovery(document, storage) {
  try {
    validateDocument(document);
    const savedAt = Date.now();
    const data = JSON.stringify({
      version: RECOVERY_VERSION,
      savedAt,
      document,
    });
    storageFor(storage).setItem(JSON_RECOVERY_KEY, data);
    return savedAt;
  } catch (error) {
    throw new Error(
      `Could not save the JSON draft in this browser: ${error.message} Use Save draft to download a copy.`
    );
  }
}

export function clearJsonRecovery(storage) {
  try {
    storageFor(storage).removeItem(JSON_RECOVERY_KEY);
  } catch (error) {
    throw new Error(`Could not clear the JSON draft: ${error.message}`);
  }
}
