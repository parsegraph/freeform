import { Direction, reverseDirection } from "parsegraph";
import { DONT_TOUCH_CAMERA, MOVE_SPEED } from "../../settings";

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

  switch (key) {
    case "PageUp":
      viewport.movePaintGroup(false);
      break;
    case "PageDown":
      viewport.movePaintGroup(true);
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
    // eslint-disable-next-line no-fallthrough
    case "Escape":
      viewport.showInCamera();
      break;
    case "x":
    case "Backspace":
      viewport.removeNode();
      break;
    case "q":
    case "o":
      viewport.moveOutward(DONT_TOUCH_CAMERA);
      break;
    case "e":
    case "i":
      viewport.spawnMove(Direction.INWARD, false, DONT_TOUCH_CAMERA);
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
      viewport.spawnMove(Direction.DOWNWARD, false, DONT_TOUCH_CAMERA);
      break;
    case "k":
    case "w":
      viewport.spawnMove(Direction.UPWARD, false, DONT_TOUCH_CAMERA);
      break;
    case "l":
    case "d":
      if (modifiers.ctrlKey) {
        return false;
      }
      viewport.spawnMove(Direction.FORWARD, false, DONT_TOUCH_CAMERA);
      break;
    case "h":
    case "a":
      viewport.spawnMove(Direction.BACKWARD, false, DONT_TOUCH_CAMERA);
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
      viewport.tab(modifiers.shiftKey);
      break;
    case "ArrowDown":
      cam.adjustOrigin(0, MOVE_SPEED / cam.scale());
      viewport.refresh();
      break;
    case "ArrowUp":
      cam.adjustOrigin(0, -MOVE_SPEED / cam.scale());
      viewport.refresh();
      break;
    case "ArrowLeft":
      cam.adjustOrigin(-MOVE_SPEED / cam.scale(), 0);
      viewport.refresh();
      break;
    case "ArrowRight":
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
      return false;
  }
  return true;
};

export { handleKeyDown };
