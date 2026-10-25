import { readGraph } from "./graphDocument";
import { inspectLispSelection, isStructuredLisp } from "./structuredLisp";
import { readJsonRecovery, writeJsonRecovery } from "./structuredJsonRecovery";

export const LISP_RECOVERY_KEY = "parsegraph-lisp-draft";
const storageFor = (storage) =>
  storage === undefined ? window.localStorage : storage;

function validateLispDocument(document) {
  if (document?.format !== "parsegraph" || document.version !== 1)
    throw new Error("Recovery requires a Parsegraph v1 document.");
  const root = readGraph(document);
  if (!isStructuredLisp(root))
    throw new Error(
      "The saved document is not a structured Lisp/Scheme draft."
    );
  // Slots and incomplete tokens are recoverable; invalid topology is not.
  inspectLispSelection(root, root);
}

export function readLispRecovery(storage) {
  try {
    const raw = storageFor(storage).getItem(LISP_RECOVERY_KEY);
    if (raw === null) return null;
    const record = JSON.parse(raw);
    if (record?.version !== 1)
      throw new Error("Unsupported Lisp/Scheme draft recovery version.");
    if (!Number.isFinite(record.savedAt) || record.savedAt < 0)
      throw new Error("The Lisp/Scheme draft recovery timestamp is invalid.");
    validateLispDocument(record.document);
    return { document: record.document, savedAt: record.savedAt };
  } catch (error) {
    throw new Error(
      `Could not restore the Lisp/Scheme draft: ${error.message} The stored draft has been kept.`
    );
  }
}

export function writeLispRecovery(document, storage) {
  try {
    validateLispDocument(document);
    const savedAt = Date.now();
    storageFor(storage).setItem(
      LISP_RECOVERY_KEY,
      JSON.stringify({ version: 1, savedAt, document })
    );
    return savedAt;
  } catch (error) {
    throw new Error(
      `Could not save the Lisp/Scheme draft in this browser: ${error.message} Use Save draft to download a copy.`
    );
  }
}

// Retain JSON's existing record and keep one separate Lisp record. The chooser
// offers the most recently saved valid draft; a corrupt record cannot hide the
// other format's recovery or be overwritten merely by reading it.
export function readStructuredRecovery(storage) {
  const records = [];
  const errors = [];
  for (const read of [readJsonRecovery, readLispRecovery]) {
    try {
      const record = read(storage);
      if (record) records.push(record);
    } catch (error) {
      errors.push(error.message);
    }
  }
  records.sort((a, b) => b.savedAt - a.savedAt);
  return { recovery: records[0] ?? null, error: errors.join(" ") || null };
}

export function writeStructuredRecovery(document, storage) {
  return document?.metadata?.freeform?.structuredLisp !== undefined
    ? writeLispRecovery(document, storage)
    : writeJsonRecovery(document, storage);
}
