import { DirectionCaret, Direction } from "parsegraph";

function exportGraphToLines(root) {
  const car = new DirectionCaret(root);
  const lines = [];
  while (true) {
    if (car.has("f")) {
      car.move("f");
      lines.push(car.node().value());
      car.move("b");
    }
    if (car.has("d")) {
      car.move("d");
    } else {
      break;
    }
  }
  return lines.join("\n");
}

function exportGraphToWords(root) {
  const car = new DirectionCaret(root);
  const lines = [];
  while (true) {
    car.push();
    const words = [];
    while (car.has("f")) {
      car.move("f");
      words.push(car.node().value());
    }
    car.pop();
    lines.push(words.join(" "));
    if (car.has("d")) {
      car.move("d");
    } else {
      break;
    }
  }
  return lines.join("\n");
}

let nest = 0;

const tab = () => {
  const words = [];
  for (let i = 0; i < nest; ++i) {
    words.push("  ");
  }
  return words.join("");
};

function exportGraphToLisp(root, tokens) {
  const hasInward = root.neighbors().hasNode(Direction.INWARD);
  if (root.neighbors().hasNode(Direction.INWARD)) {
    tokens.push("(");
    nest++;
  }
  if (root.value() !== undefined) {
    tokens.push(root.value());
    tokens.push(" ");
  }
  if (hasInward) {
    exportGraphToLisp(root.neighbors().nodeAt(Direction.INWARD), tokens);
    tokens.push(")");
    nest--;
  }
  if (root.neighbors().hasNode(Direction.FORWARD)) {
    exportGraphToLisp(root.neighbors().nodeAt(Direction.FORWARD), tokens);
  }
  if (root.neighbors().hasNode(Direction.DOWNWARD)) {
    tokens.push("\n" + tab());
    exportGraphToLisp(root.neighbors().nodeAt(Direction.DOWNWARD), tokens);
  }
}

function exportGraphToJson(root) {
  if (root.neighbors().hasNode(Direction.INWARD)) {
    let inner = root.neighbors().nodeAt(Direction.INWARD);
    if (inner.neighbors().hasNode(Direction.BACKWARD)) {
      // Object
      const obj = {};
      while (inner) {
        if (
          inner.neighbors().nodeAt(Direction.BACKWARD) &&
          inner.neighbors().nodeAt(Direction.FORWARD)
        ) {
          obj[exportGraphToJson(inner.neighbors().nodeAt(Direction.BACKWARD))] =
            exportGraphToJson(inner.neighbors().nodeAt(Direction.FORWARD));
        }
        inner = inner.neighbors().nodeAt(Direction.DOWNWARD);
      }
      return obj;
    } else {
      // Array
      const arr = [];
      while (inner) {
        arr.push(exportGraphToJson(inner));
        inner = inner.neighbors().nodeAt(Direction.FORWARD);
      }
      return arr;
    }
  } else if (root.value() !== undefined) {
    return JSON.parse(root.value());
  }
  throw new Error("Unhandled empty node");
}

export {
  exportGraphToJson,
  exportGraphToLisp,
  exportGraphToWords,
  exportGraphToLines,
};
