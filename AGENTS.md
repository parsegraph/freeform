# Working in Freeform

When discussing or changing graph topology or layout, read
[the graph terminology](docs/graph-terminology.md). Use its definitions of buds,
multislots, spine/prongs, orientation, centering, and pulling. Multislot
orientation refers to its bud spine: vertical means DOWNWARD buds with FORWARD
children; horizontal means FORWARD buds with DOWNWARD children.

For XML/SVG import and export, also read
[the XML mapping](src/fixtures/xml/README.md). Keep the importer, exporter, and
mapping documentation consistent when changing the graph structure.
