# Graph terminology

Use these terms when discussing graph structure, importers, and layout, with
both humans and agents. Directions describe connections in the graph, not the
camera's current orientation.

## Directions and buds

- **FORWARD / BACKWARD**: right / left.
- **DOWNWARD / UPWARD**: down / up.
- **INWARD / OUTWARD**: containment / return from containment. “Inner” refers
  to an INWARD connection.
- **Bud**: an empty node, normally created with `new DirectionNode()`. It is a
  real, navigable node used to organize connections, rather than XML content.

## Multislot

A **multislot** is a fork-shaped structure for an ordered sequence of children.
Empty buds form the **spine**; each bud has a **prong** connecting to one child.
Bud 0 holds child 0, bud 1 holds child 1, and so on. Each child may have its own
multislot without using up the connections that link its siblings.

The multislot's orientation names the direction of its **spine**, not its
children:

| Multislot | Spine (bud to next bud) | Prong (bud to child) |
| --- | --- | --- |
| Vertical multislot | DOWNWARD | FORWARD |
| Horizontal multislot | FORWARD | DOWNWARD |

Vertical multislot:

```text
parent
  |
  v
 bud 0 ---> child 0
  |
  v
 bud 1 ---> child 1
  |
  v
 bud 2 ---> child 2
```

Horizontal multislot:

```text
parent
  |
  v
 bud 0 ---> bud 1 ---> bud 2
  |          |          |
  v          v          v
child 0    child 1    child 2
```

These diagrams describe connections, not exact layout positions. A downward
connection from the parent to the first bud is the **dog-leg** used by the XML
mapping. The spine always connects buds to buds. A chain such as
`bud -> child -> bud -> sibling` is not a multislot: its children sit along the
spine instead of on separate prongs.

## Centering and pulling

**Alignment** controls where a connected subtree sits across its connection's
axis. A **centered multislot** centers the fork under/beside its parent and
centers each child's subtree on its prong.

For the horizontal multislot used by the XML importer:

- Center-align the DOWNWARD connection from the parent to the first bud.
- Center-align each DOWNWARD connection from a bud to its child.
- Leave FORWARD spine connections at `Alignment.NONE` so the spine stays
  straight; centering those connections can stagger the buds vertically.

Alignment is set on the parent end of a connection, for example
`bud.neighbors().align(Direction.DOWNWARD, Alignment.CENTER)`. Use `Fit.EXACT`
on that parent, as the caret's alignment API does.

**Pulling** chooses which direction the layout prioritizes. Pull each bud
toward its child (DOWNWARD for a horizontal multislot, FORWARD for a vertical
one) so the child's subtree is laid out snugly before the next spine segment.
Pulling and center alignment are separate choices; neither changes the graph's
connections or child order.

## XML mapping

XML elements keep their attributes INWARD, as a downward list of keys with
values FORWARD. Their child content uses a centered horizontal multislot,
including preserved text and whitespace nodes. See the
[XML / SVG mapping](../src/fixtures/xml/README.md) and
[implementation](../src/xmlGraph.js) for the complete grammar.
