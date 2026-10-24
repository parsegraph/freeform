# Structured JSON editing

Freeform's first structured editor supports JSON. Open a JSON file or create a
JSON draft, select a node, and use its structured actions. Ordinary Parsegraph
documents retain unrestricted graph editing.

Choose **New JSON document** in the New/Open chooser, or open a `.json` file.
The JSON sidebar appears in Edit mode. Unfinished slots use amber blocks; the
sidebar's diagnostics also select the corresponding node directly.

Node types have a shared color scheme in the graph and type-choice buttons.
Objects, arrays, and booleans also have curly, square, and angle border cues.
These side accents are capped at 8 screen pixels wide, so tall or large
containers do not acquire oversized brackets. They currently sit inside the
ordinary block outline.

## Slots and document states

A **slot** is an editor-owned placeholder for content required by the document.
Its expected contents come from the surrounding JSON grammar. An unfinished
object key and an unfinished JSON value have different roles. Slots may retain
partial input, such as `-` while entering a negative number.

A slot is distinct from an empty string, `null`, an empty array, an empty object,
and a layout bud. Empty containers are complete JSON values. A bud organizes
the graph's connections; its lack of a label does not make it a slot. See the
[graph terminology](graph-terminology.md).

The editor distinguishes a structurally understood draft from a complete JSON
document. A draft can contain unfinished slots or a value still being typed.
Diagnostics identify what needs attention. JSON export requires complete values
and valid object members; it never replaces unfinished slots with `null` or
silently omits them.

## Editing

Actions depend on the selected node's role:

- Add a member to an object or an item to an array.
- Fill a value slot with a string, number, boolean, `null`, object, or array.
- Edit keys and literal values, including empty strings and unfinished numbers.
- Clear a value to leave a slot, or remove its containing member/item.
- Move a member/item earlier or later in its container.
- Wrap an existing value in an array or object, preserving the value.
- Paste JSON into a selected value position.

Each structured command is one undo operation. Selection, camera navigation,
and presentation still use Freeform's existing graph viewer. Structural edits
must pass through the semantic commands; arbitrary connections cannot safely
be treated as JSON content.

Text is committed as it is typed, including incomplete numeric input, so focused
fields are included in recovery. This first iteration records individual input
changes in undo history.

Select an editable value and press **Enter**, or choose **Edit in graph**, to
open a matching textbox over the node. Enter finishes editing and returns focus
to graph navigation; Shift+Enter adds a newline to strings. Escape also finishes
and keeps live changes (use Undo to reverse them). Composition/IME Enter does
not prematurely finish editing. The sidebar text fields also finish on Enter.
The textbox tracks the published graph's geometry and stays focused through
edits, including a large paste.

Semantic edits retain the last complete rendered frame until the replacement
is ready. Text changes preserve the camera instead of reopening/recentering
the document for each keystroke.

### Building with the keyboard

The JSON sidebar has a collapsed **Keyboard controls** reference. These commands
apply while the graph has focus. In View mode, select a node first; Escape
clears the selection and returns directional keys to camera panning.

| Key | Action |
| --- | --- |
| `,` | Insert a new member/item slot after the selected entry. On the root object/array, append inside it. |
| `i` / `e` | Enter an object/array's first entry, creating it if empty. On a key, go to its value. |
| `:` | Go from an object key to its value. |
| `]` / `}` / `o` / `q` | Select the containing object/array. |
| `h j k l` / WASD | Follow the existing directional connections. At a dead end, down/up moves to the next/previous entry. |
| Enter | Edit a key or editable value; press Enter again to finish. |
| `x` / Backspace | Remove an array item or object member selected by its key/bud. Clear a selected object member's value, or the document root, to a slot. |
| `u` / `z` | Undo. |
| `y` / `R` | Redo. |

In View mode, arrows also follow the selected node's connections, including the
down/up fallback between entries. In Edit mode, arrows retain camera panning.

At an **empty value slot**, JSON punctuation chooses the value's type:

| Key | Value |
| --- | --- |
| `"` | String; opens inline editing. |
| `[` / `{` | Empty array / object. Use `i` to add its first entry. |
| A digit / `-` | Number; opens inline editing with that character already entered. |
| `t` / `f` / `n` | `true` / `false` / `null`. |

These type shortcuts leave existing values unchanged. A nested container is
itself an entry in its parent: comma inserts beside it, while `i` enters it.
Holding comma does not create repeated entries. Navigation does not create
arbitrary graph nodes at a dead end.

For example, start with an empty object, press `i`, then Enter to type its first
key. Finish with Enter, press `:` to select the value slot, then `"` to type a
string. Finish with Enter and use comma to add the next member.

While a textbox has focus, punctuation is ordinary text, including commas and
brackets. Ctrl/Meta/Alt combinations are left to the browser and native text
editing. These bindings retain Freeform's directional navigation; `i` means
INWARD rather than Vim's insert mode.

## Saving and recovery

**Save draft** writes a native Parsegraph v1 document containing the graph and
the editor's typed metadata. It preserves slots, partial input, and selection,
and can be reopened in Freeform. JSON export produces ordinary JSON only when
the draft is complete. Legacy Parsegraph v0 does not carry the typed metadata
needed to resume structured editing.

The browser keeps one latest JSON draft as a recovery record, available through
the document chooser. This is a local recovery aid, not a filesystem write or
a substitute for downloading important work. Browser storage can be cleared,
disabled, or run out of space. Failed storage writes are reported; a malformed
recovery record is retained instead of silently deleted.

The storage key is `parsegraph-json-draft`. Its wrapper contains a version,
save timestamp, and the native v1 document. Recovery accepts incomplete editor
drafts but rejects malformed graph structure or unsupported metadata versions.

## Graph mapping and implementation

The graph is authoritative. Stable node IDs map to explicit JSON roles in
`metadata.freeform.structuredJson`, currently version 1. Types are not inferred
only from label text or empty connections. This metadata is part of native
snapshots, so undo and reloading retain the same interpretation.

Containers connect INWARD to a vertical multislot: empty buds form a DOWNWARD
spine, with FORWARD prongs. Array prongs hold values. Object prongs hold keys,
with each key's value DOWNWARD. Prongs are centered and buds pull toward their
children. Nested containers apply the same mapping.

The structured JSON adapter interprets selected nodes, enumerates applicable
actions, applies edits, validates the graph, and exports complete JSON. The
renderer still uses ordinary Parsegraph nodes. There is no separate mutable AST
or per-node runtime widget object to synchronize with the graph.

## Current limits

This experiment remains browser-based. Native file dialogs, saving back to a
source path, filesystem watching, and multiple documents are separate work.
XML/SVG and other importers do not yet use the JSON slot editor.

JSON import currently uses `JSON.parse`, and export regenerates JSON. Original
whitespace, escape spelling, numeric spelling, and duplicate source keys are not
preserved; JavaScript numeric precision limits also apply. This is structural
editing, not a byte-preserving source editor. A schema-aware layer for required
properties, domain-specific types, or numeric ranges is also future work.

Commands currently reconstruct the typed graph while preserving surviving node
identities and visual settings. Incremental updates for very large JSON files
are a later optimization; ordinary Freeform graphs do not use this path.
