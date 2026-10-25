import {
  createPresentation,
  DirectionCaret,
  serializeParsegraphDocument,
} from "parsegraph";

/**
 * Paired columns from Parsegraph's examples/generators/proportion.ts.
 * The proportional presentation keeps the labeled column ends on one row.
 */
export function buildProportionDocument(count = 3) {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error("Count must be an integer between 1 and 200.");
  }

  const caret = new DirectionCaret("");
  let nextId = 0;
  caret.node().setId(`proportion-${nextId++}`);
  const spawnMove = (direction, value) => {
    const node = caret.spawnMove(direction, value);
    node.setId(`proportion-${nextId++}`);
    return node;
  };

  for (let i = 0; i < count; ++i) {
    for (const direction of ["b", "f"]) {
      caret.push();
      spawnMove(direction);
      for (let j = 0; j < count - i - 1; ++j) {
        spawnMove("d");
        if (j === 0) caret.crease();
      }
      spawnMove("d", String(count - i));
      caret.pop();
    }

    caret.pull("d");
    spawnMove("d", "");
  }

  caret.moveTo(caret.root());
  spawnMove("u");
  caret.push();
  spawnMove("b");
  caret.pop();
  spawnMove("f");

  const root = caret.root();
  const presentation = createPresentation("proportional");
  root.paintGroup().forEach((group) => group.siblings().forEach((node) => {
    presentation.nodeStyles[String(node.id())] = node.value() === undefined
      ? "bud" : node.value() === "" ? "block" : "slot";
  }));
  return serializeParsegraphDocument(root, { presentation });
}
