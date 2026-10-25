# Parsegraph Freeform

See https://parsegraph.com/freeform for the live implementation.

Run `yarn` in this directory, then `yarn start` for local development or
`yarn build` for a production build. Both commands generate the text-rendering
and WorldLabel occlusion workers first; separate worker installs are unnecessary.
After editing worker source while the dev server is running, run
`yarn build:workers` and refresh the page.

Graph structure and layout vocabulary is documented in
[Graph terminology](docs/graph-terminology.md), including buds, vertical and
horizontal multislots, centering, and pulling. See also the
[XML / SVG mapping](src/fixtures/xml/README.md).

Gallery documents can open directly with `/freeform/?document=…`.
See [document links](docs/document-links.md) for the URL contract and refresh behavior.

See [Benchmarking imports and initial layout](docs/benchmarking.md) to capture
stage timings and responsiveness before comparing performance changes.
