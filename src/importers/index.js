import * as importers from "./importers";
import { normalizeGraph } from "../graphDocument";

// Importers build graphs recursively from parts; only the finished graph is a
// document. Lisp and XML imports already produce normalized documents.
const finished = (read) => (...args) => normalizeGraph(read(...args));

export const graphLines = finished(importers.graphLines);
export const graphWords = finished(importers.graphWords);
export const graphJson = finished(importers.graphJson);
export const graphPng = finished(importers.graphPng);
export const graphJpeg = finished(importers.graphJpeg);
export { graphLisp } from "./importers";
export { graphXml } from "../xmlGraph";
