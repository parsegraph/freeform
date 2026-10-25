# Parsegraph Freeform

See https://parsegraph.com/freeform for the live implementation.

Run `yarn` in this directory, then `yarn start` for local development or
`yarn build` for a production build. Both commands generate the text-rendering
and WorldLabel occlusion workers first; separate worker installs are unnecessary.
After editing worker source while the dev server is running, run
`yarn build:workers` and refresh the page.

## Editor workspace

Start from **New document** to create a blank graph, JSON draft, or Lisp/Scheme draft, open a file,
or explore an example. Once a document is open, the toolbar shows its name and
unsaved state, with Open, Save, Undo, Redo, and View/Edit always available.
**Save** opens **Save a copy** to download a document in the selected format.
It does not overwrite the original file.

**View** keeps the canvas open for navigation. **Edit** reveals a contextual
inspector: ordinary graphs get text, appearance, and graph actions; structured
JSON and Lisp/Scheme get actions appropriate to the selected value or slot. Switching modes
keeps the document, selection, and camera. On narrow screens, the inspector sits
below the canvas. Fit graph, zoom, and Labels remain beside the canvas.

The application uses neutral controls and a quiet default canvas. Structured
document types share muted colors across nodes, inline editing, and inspector
buttons; unfinished slots stay amber. Explicit document appearance settings
continue to determine document colors and alpha values.

Lisp/Scheme preserves imported source spacing and line breaks. Forms on the
same source line link directly across a horizontal row, with newlines starting
another row. Containers keep their contents INWARD; source rows need no
organizing buds.
Press **i** for source insertion: type Lisp/Scheme with ordinary spaces,
parentheses, and newlines, then **Escape** to return to graph navigation.
**c** clears a token for replacement; **o** / **O** starts an indented source
row below / above the current row. A changed insertion session is one undo
step. **e** enters a container, **q** returns outward, and **Enter** edits a
single raw token. In navigation mode, Space inserts a neighboring form and
Shift+Enter inserts one on the next line.

**Developer** in the status bar opens movement and diagnostic tools: Mouse feel,
Node travel, rendering controls, Document capabilities, and benchmarks. The
panel starts closed. **Enable benchmarks** starts recording for the session;
the existing `?benchmark=1` launch option also works. These controls are separate
from the document inspector.

The shell keeps the existing import/export formats, recovery behavior, and
graph keyboard shortcuts. See [structured JSON editing](docs/structured-json.md)
and [Lisp/Scheme editing](docs/structured-lisp.md) for slots, inline editing,
keyboard construction, and source round trips.

## Template gallery

**Open → New** offers a visual gallery of the built-in examples. Search by name
or description, filter by category, and select a preview before choosing
**Create**. Tournament and Recursive cross retain their rounds controls;
Tournament also supports a vertical bracket. Proportion accepts 1–200 columns
per side, mirrored around its central spine; refresh restores the chosen count.
Browsing does not change the current document. Blank graph, New JSON document,
and New Lisp/Scheme document remain separate shortcuts.

The thumbnails are static SVGs generated from the real example builders and
the same layout geometry used by the editor. They preserve document appearance
and legacy example colors. They use default settings and a fixed seed for
random examples; the grid uses a smaller sample and daily planners show a
detail of the start of the day. They are representative previews rather than
live views of the selected options.

Regenerate the checked-in files in `public/template-previews/` after changing
builders, fixtures, default styles, or layout geometry:

```sh
yarn templates:previews
yarn templates:previews --check
```

Generation uses the installed project toolchain, with no browser, network, or
sibling checkout required. It uses deterministic text advances for reproducible
layout and SVG `textLength` for consistent label widths. The generator records
recipes in `manifest.json`; `--check` detects stale or missing previews. The
app loads these images lazily, so opening the gallery does not construct or
lay out all the examples. Adding an example also requires an entry in
`src/templateCatalog.js` and regenerating its preview.

Graph structure and layout vocabulary is documented in
[Graph terminology](docs/graph-terminology.md), including buds, vertical and
horizontal multislots, centering, and pulling. See also the
[XML / SVG mapping](src/fixtures/xml/README.md).

Gallery documents can open directly with `/freeform/?document=…`.
See [document links](docs/document-links.md) for the URL contract and refresh behavior.

See [Benchmarking imports and initial layout](docs/benchmarking.md) to capture
stage timings and responsiveness before comparing performance changes.
