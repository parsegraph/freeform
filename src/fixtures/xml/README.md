# XML / SVG tree mapping

`graphXml` imports XML 1.0 using the browser XML parser. XML and SVG files use
the same mapping, which is carried by node values and connections rather than
an opaque copy of the original source. It survives Parsegraph v1 save/reload,
and XML export reads the graph's current contents.

- The root is `#document`.
- Each child has an empty bud below its parent (or the previous child's bud),
  with the XML node attached forward from that bud. The downward bud chain
  preserves document order, including text and whitespace nodes. Buds pull
  forward so each child stays snug before the next row is laid out.
- An element is labeled `<qualified:name>`. Its attributes start inward and
  form a downward chain of `@qualified:name` nodes, each with its literal value
  to the right. The attribute list is contained inside the element.
- `#text`, `#cdata`, `#comment`, `#doctype`, and `?target` have a value below.
- `#xml` represents the optional XML declaration, with attributes inward too.

Text and whitespace inside elements are preserved, including mixed content,
indentation, empty attributes, and `xml:space`. Namespace declarations and
qualified names remain explicit attributes/names. CDATA, comments and processing
instructions are distinct nodes. SVG markup is graph data; it is never inserted
into the active page or executed.

This is a structural round trip, not a byte-identical source editor. The XML
parser normalizes line endings and attribute whitespace per XML rules. Entity
references are decoded and re-escaped on output; quote style and empty-element
syntax may normalize. Whitespace outside the document element is not retained
by the browser document tree. Export does not pretty-print or inject content
whitespace. Output is UTF-8, with an existing encoding declaration updated to
match. Input decoding honors UTF-8/UTF-16 byte-order marks and declared encodings
supported by the browser's `TextDecoder`; decoding failures are reported rather
than replacing invalid bytes. UTF-32 and XML 1.1 are unsupported.

External DOCTYPE identifiers are retained as inert data, removed before parsing,
and restored on export; no DTD is fetched or applied. Internal subsets and
custom entity declarations are rejected, including empty subsets. Built-in
entities and character references work normally. SVG relying on DTD-defined
entities or default attributes needs those values expanded before importing.

XML export validates the edited graph and resulting XML, including names,
namespaces, and document structure. Unsupported connections and invalid edits
produce an error rather than dropping data. SVG export additionally requires an
`svg` document element in `http://www.w3.org/2000/svg`; it exports source, not an
image of the Parsegraph layout.

References: [XML 1.0](https://www.w3.org/TR/xml/) and
[DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString).

`appearance-colors.svg` is copied from the sibling Parsegraph checkout's SVG
export of `examples/fixtures/appearance-colors.parsegraph`. It tests the actual
reference exporter's output through the XML importer/exporter.
