# Opening gallery documents

Freeform accepts `document` in its launch URL:

```
/freeform/?document=%2Fexamples%2Frainbow.parsegraph
```

Build the query with `new URLSearchParams({ document: example.document })`.
The value is a document URL, not a template name. Root-relative paths are
recommended; relative paths resolve against the editor URL. Absolute URLs must
use the editor's own origin. Only HTTP(S) is supported, without URL credentials
or redirects. Serve the document directly at that location.

The link takes precedence over saved examples and `sample` or `public` parameters,
including when invalid. Freeform shows loading progress, errors, Retry, and
Choose another document. Cancelling aborts the request and prevents a late load
from replacing another document.

The existing importer reads v0 and v1 Parsegraph JSON, preserving supported and
unknown optional capabilities as usual. Saved selection and camera are restored;
documents without a camera are centered and fitted using the full graph bounds,
with a margin on every side. **Fit graph** repeats that operation in View or Edit
mode without changing the selected node. View mode also supports `+`, `=`, and
`-` for keyboard zoom. This is a document import, not
a regeneration from the gallery's generator parameters.

The normalized `document` query remains after loading so refresh opens the
original gallery document again. Save/export to keep edits. Opening another file,
template, or recovered draft removes the link. Existing JSON draft recovery stays
available through the chooser. Gallery files are never modified by the editor.

The website and editor remain separately built and deployed. The website's
gallery links use this contract; both `/examples/` and `/freeform/` must be served
on the same origin. See [VPN hosting](vpn-hosting.md) for the mounted editor.
