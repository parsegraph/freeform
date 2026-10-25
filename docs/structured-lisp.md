# Structured Scheme / Lisp editing

Freeform opens Scheme source as an editable document of forms. **New Lisp/Scheme
document** starts with an unfinished value slot. Importing `.scm`, `.ss`, `.sld`,
`.scheme`, `.lsp`, or `.lisp` source uses the same reader. Existing native graphs
without structured Scheme metadata keep their ordinary Freeform behavior.

The inspector offers the operations appropriate to the selected form. Press
**i** to enter source insertion mode and type Lisp/Scheme directly into the
graph. **Escape** returns to graph navigation. **Enter** instead opens or
finishes an inline editor over a single literal. Literal fields contain raw
source tokens: strings include their quotes, characters include `#\`, and
numbers retain their radix, exactness, and original spelling. Shift+Enter inserts
a newline in a token field; input composition remains ordinary text editing.

This is a structural source editor, not a Scheme interpreter. It reads data and
never executes imported forms, expands macros, or resolves bindings.

## What survives a source round trip

The reader retains multiple top-level forms, lists, vectors, bytevectors,
dotted tails, and quote, quasiquote, unquote, and unquote-splicing shorthand.
Symbols, escaped symbols, strings, booleans, characters, and numbers keep their
literal token spellings. Numbers are not converted to JavaScript numbers, so
large integers, rational notation, radix prefixes, and complex notation do not
lose precision or spelling.

Line comments, nested block comments, and datum comments are editable graph
content. Comments between a reader prefix and its operand remain associated
with that prefix. Comments following a dotted-tail operand stay with the tail.

Imported whitespace is preserved, including indentation, blank lines, CRLF line
endings, trailing spaces, and the absence of a final newline. Whitespace inside
strings, escaped symbols, and block comments remains part of the raw token.
Sibling forms on the same source line link directly in one horizontal row; a
newline before a sibling starts another row. The graph contains the forms and
unfinished slots themselves, without organizing row or entry buds. Blank lines
remain in exported source but do not currently create additional empty graph
rows or extra vertical spacing.

The source exporter walks the current graph and its per-form separators; no
original-source buffer is used to reconstruct it. Edits add separators only
where needed to keep tokens distinct or keep a line comment from swallowing
the next form or closing parenthesis. A final document comment can retain its
original end of file without a newline. Invalid separators in a native draft
produce diagnostics and block source export.

## Slots and grammar-aware operations

A slot is editor-owned unfinished content, distinct from an empty list, a
comment, or an organizing bud. Native `.parsegraph` drafts preserve slots and
incomplete literal tokens. Source export stays disabled until every slot and
literal is complete and all container rules hold.

The main operations are:

- Add or insert a form, move it earlier or later, and remove it.
- Insert on a new line, start a new line before an existing form, or join it to
  the previous row. Joining after a line comment is disabled. Changing one
  boundary leaves whitespace elsewhere in the document unchanged.
- Replace a selected form with a literal, container, reader prefix, comment, or
  slot. The document root remains a document.
- Wrap an existing datum in a list, vector, or reader prefix while preserving
  that datum's node identity.
- Add or remove a dotted tail on a list. Newly added list entries go before
  the tail, and the tail stays last.
- Paste one parsed form over a selection. Pasting at the document root replaces
  all top-level forms. Parse errors leave the current graph unchanged.
- Clear a value to a slot, or clear all forms from a document.

A prefix has one operand; removing that operand leaves a fillable slot. Insert
another form beside the prefix instead of adding a second operand inside it.
Bytevector slots offer numbers and comments. Their numbers must denote exact
integers from 0 to 255: radix integers, exact rational integers, and explicitly
exact decimals are supported. Complex spellings are not accepted as bytevector
elements, even when they would numerically reduce to an integer.

Source insertion is explicit: press **i** while a form is selected, then type
source with ordinary spaces, parentheses, and newlines. Selecting a scalar or
slot starts at that value; selecting a container appends inside it, reusing an
empty trailing slot. Letters that normally navigate, such as HJKL and WASD,
become text while inserting. Strings and comments retain their normal source
delimiters, and unfinished tokens remain saveable as native drafts. Escape exits
this mode and restores the navigation keys. Press **e** to enter a container
without starting source insertion; Enter retains the existing single-token
editor.

Use **c** to clear a selected token or slot and immediately type its replacement;
containers are not cleared by this shortcut. **o** opens a source row below the
whole current row, and **O** opens one above it, then enters insertion mode.
Both retain the surrounding indentation and line-ending style. These row
commands leave the existing forms together rather than splitting the row at
the selected column.

A changed insertion session is one undo step, including opening its insertion
position and removing temporary slots on exit. Typing still updates the graph
and recoverable draft as it happens. **u** / **z** undoes the session after
returning to navigation; **y** / **R** redoes it.
Single-token inline editing with Enter is also grouped into one undo step;
unfinished tokens still reach draft recovery as they are typed.

Containers stay structurally balanced: `(` creates and enters a list, and `)`
leaves it. Exiting insertion after typing `(a` therefore produces `(a)`.
Incomplete literal tokens and missing prefix operands remain draft holes.

When the graph has focus in navigation mode, Space inserts a neighboring slot
on the same line; Shift+Enter inserts one on the next line. A line comment
always forces the next form onto a new line. Enter continues to open or finish
inline editing.
`(` fills a slot with a list or wraps a selected datum, and `)` returns to its container.
`'`, backtick, `,`, and `@` apply quote, quasiquote, unquote, and unquote-splicing
prefixes. `e` enters a container, `q` returns outward, and
`x` / Backspace removes or clears the selection. Left/right Vim and WASD keys
follow semantic siblings; up/down follows adjacent source rows, keeping the
column when possible. Selected-node arrows in View mode do the same. These
punctuation shortcuts do not intercept typing inside text fields.

## Drafts, recovery, and graph mapping

Saving a native draft preserves incomplete content and stable node IDs. Source
export produces Scheme text only after validation. Browser draft recovery is
independent of the JSON draft, so working in one language does not replace the
other language's recovery entry. Undo and redo retain literal spellings, slots,
selection, and the document's visual settings.

The graph is authoritative. `metadata.freeform.structuredLisp`, version 1 with
`layout: "direct-source-lines"`, declares each node's language role. Scalar
source text lives on the node. Form roles store `leading` whitespace; container
and prefix roles also store `trailing` whitespace. These local separators,
roles, and the nesting-scale baseline do not form a parallel source AST. The
reader's temporary tree and a command's decoded tree exist only while
constructing or editing.

The root is a `document`. Every container and reader-prefix wrapper connects
INWARD to its first form. FORWARD connects forms on the same source line;
DOWNWARD connects a row's first form to the next row's first form. Noninitial
forms in a row have no DOWNWARD sibling connection. Every form reserves INWARD
for its own contents, so nested forms do not consume the row connections.
These direct source rows are not multislots: there is no separate bud spine or
prong. A newline in a form's `leading` separator starts a new row; a native
draft whose connections disagree with its separators is rejected.

Forms use `Fit.EXACT`. Row starters pull FORWARD to lay out their horizontal
row before the next DOWNWARD row, then `loosen()` gives vertical separation
the full row's footprint. FORWARD edges keep `Alignment.NONE` so a row stays
straight. Each INWARD boundary shrinks the contained forms once. Moving a form
between row positions compensates for the changed physical ancestry, preserving
its size relative to its semantic container. A dotted tail is a final prefix
wrapper containing its tail datum and preserved comments.

Semantic edits reconstruct the graph while retaining surviving IDs, manual
scale adjustments, node fits, paint groups, layout preferences, and unchanged
edge alignment. All directional separation settings are copied, including
manual tightening.
Focus intent is retained, except that a direction made parent-facing by an edit
is removed from that node's focus selection. This does not add camera behavior.

Older version-1 Scheme drafts, both the vertical mapping without a layout
marker and the `source-lines` mapping with organizing buds, migrate to direct
source rows when opened. Form IDs, source separators, effective form scales,
and applicable visual settings survive; a selected organizing bud resolves to
its associated form. The obsolete organizing buds are removed.

The earliest importer discarded whitespace, which cannot be recovered from
those drafts. The adapter infers a newline between their siblings. Reimport
the original source file to recover its actual line grouping and formatting.
The later `source-lines` drafts already preserve this formatting. Unknown
layout markers fail explicitly.

## Scope and limits

The reader follows the useful datum and lexical forms in the
[R7RS formal syntax](https://standards.scheme.org/corrected-r7rs/r7rs-Z-H-9.html).
It validates source-token and container structure, not the meaning or arity of
Scheme procedures, the legality of a macro expansion, or library bindings.
It is not a complete implementation of every Scheme or Common Lisp reader.

Datum labels and shared/cyclic data (`#1=`, `#1#`), case-folding directives,
reader evaluation such as `#.`, implementation-specific reader extensions,
and square/curly bracket syntax fail explicitly rather than being reinterpreted
or dropped. Incomplete imported source also fails explicitly; unfinished
editing is supported through native drafts. Nesting is bounded to protect
interactive editing from excessively deep input. Source positions are not
tracked independently of the graph, and blank-line height is not yet reflected
in graph geometry.
