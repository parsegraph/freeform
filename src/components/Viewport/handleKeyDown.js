import { Direction, reverseDirection } from "parsegraph";
import { MOVE_SPEED } from "../../settings";

const handleKeyDown = (viewport, key, mouseX, mouseY, modifiers) => {
  const cam = viewport.camera();
  const car = viewport.caret();

  const pull = (dir) => {
    if (car.node().neighbors().isRoot()) {
      return;
    }
    if (dir === car.node().neighbors().parentDirection()) {
      car.fitExact();
      car
        .node()
        .neighbors()
        .parentNode()
        .siblings()
        .pull(reverseDirection(car.node().neighbors().parentDirection()));
      viewport.repaint();
    }
    return;
  };

  const tab = () => {
    if (modifiers.shiftKey) {
      car.moveTo(car.node().siblings().next());
    } else {
      car.moveTo(car.node().siblings().prev());
    }
    viewport.repaint();
  };

  const movePaintGroup = (next) => {
    if (next) {
      car.moveTo(car.node().paintGroup().next());
    } else {
      car.moveTo(car.node().paintGroup().prev());
    }
    viewport.repaint();
  };

  switch (key) {
    case "PageUp":
      movePaintGroup(true);
      break;
    case "PageDown":
      movePaintGroup(false);
      break;
    case "-":
      if (!isNaN(mouseX)) {
        viewport.checkScale();
        cam.zoomToPoint(Math.pow(1.1, -1), mouseX, mouseY);
        viewport.refresh();
      }
      break;
    case "+":
    case "=":
      if (!isNaN(mouseX)) {
        viewport.checkScale();
        cam.zoomToPoint(Math.pow(1.1, 1), mouseX, mouseY);
        viewport.refresh();
      }
      break;
    case "r":
      if (modifiers.ctrlKey) {
        return false;
      }
    case "Escape":
      viewport.showInCamera();
      break;
    case "x":
    case "Backspace":
      viewport.removeNode();
      break;
    case "e":
    case "o":
      viewport.moveOutward();
      break;
    case "q":
    case "i":
      viewport.spawnMove(Direction.INWARD, false, true);
      break;
    case "S":
    case "J":
      pull(Direction.DOWNWARD);
      break;
    case "W":
    case "K":
      pull(Direction.UPWARD);
      break;
    case "D":
    case "L":
      pull(Direction.FORWARD);
      break;
    case "A":
    case "H":
      pull(Direction.BACKWARD);
      break;
    case "b":
      viewport.rendering().toggleWorldLabels();
      viewport.refresh();
      break;
    case "v":
      viewport.toggleAlignment();
      break;
    case "j":
    case "s":
      viewport.spawnMove(Direction.DOWNWARD, false, true);
      break;
    case "k":
    case "w":
      viewport.spawnMove(Direction.UPWARD, false, true);
      break;
    case "l":
    case "d":
      viewport.spawnMove(Direction.FORWARD, false, true);
      break;
    case "h":
    case "a":
      viewport.spawnMove(Direction.BACKWARD, false, true);
      break;
    case ",":
      viewport.input().keystrokes().toggleKeystrokes();
      viewport.logMessage("Toggling keystrokes");
      viewport.refresh();
      break;
    case "m":
      viewport.rendering().toggleStats();
      viewport.logMessage("Toggling metrics");
      viewport.refresh();
      break;
    case "Tab":
      tab();
      break;
    case "ArrowUp":
      cam.adjustOrigin(0, MOVE_SPEED / cam.scale());
      viewport.refresh();
      break;
    case "ArrowDown":
      cam.adjustOrigin(0, -MOVE_SPEED / cam.scale());
      viewport.refresh();
      break;
    case "ArrowRight":
      cam.adjustOrigin(-MOVE_SPEED / cam.scale(), 0);
      viewport.refresh();
      break;
    case "ArrowLeft":
      cam.adjustOrigin(MOVE_SPEED / cam.scale(), 0);
      viewport.refresh();
      break;
    case "`":
    case "~":
      viewport.toggleNodeScale();
      break;
    case "c":
      viewport.toggleNodeStyling();
      break;
    case "f":
      viewport.toggleNodeFit();
      break;
    case "t":
      viewport.togglePreferredAxis();
      break;
    case "z":
    case "u":
      viewport.undo();
      break;
    case "y":
    case "R":
      viewport.redo();
      break;
    case "n":
      viewport.toggleExtents();
      break;
    case "p":
      viewport.toggleCrease();
      break;
    case "Insert":
    case "Enter":
      viewport.toggleEditor();
      viewport.refresh();
      break;
    case "Shift":
      return false;
    default:
      console.log("Unhandled '" + key + "'");
      return false;
  }
  return true;
};

export { handleKeyDown };
