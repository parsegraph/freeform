import { Direction, reverseDirection } from "parsegraph";
import { MOVE_SPEED } from "../../settings";

const handleKeyDown = (viewport, key, mouseX, mouseY) => {
    const cam = viewport.camera();
    const car = viewport.caret();

    const pull = (dir) => {
        if (car.node().neighbors().isRoot()) {
            return;
        }
        if (dir === car.node().neighbors().parentDirection()) {
            car.fitExact();
            car.node().neighbors().parentNode().siblings().pull(
                reverseDirection(car.node().neighbors().parentDirection())
            );
            viewport.repaint();
        }
        return;
    };

    switch (key) {
        case '-':
            if (!isNaN(mouseX)) {
                viewport.checkScale();
                cam.zoomToPoint(Math.pow(1.1, -1), mouseX, mouseY);
                viewport.refresh();
            }
            break;
        case '+':
        case '=':
            if (!isNaN(mouseX)) {
                viewport.checkScale();
                cam.zoomToPoint(Math.pow(1.1, 1), mouseX, mouseY);
                viewport.refresh();
            }
            break;
        case 'Escape':
            viewport.showInCamera();
            break;
        case 'x':
        case 'Backspace':
            viewport.removeNode();
        break;
        case 'o':
            viewport.moveOutward();
        break;
        case 'i':
        viewport.spawnMove(Direction.INWARD, false, true);
        break;
        case 'J':
        pull(Direction.DOWNWARD);
        break;
        case 'K':
        pull(Direction.UPWARD);
        break;
        case 'L':
        pull(Direction.FORWARD);
        break;
        case 'H':
        pull(Direction.BACKWARD);
        break;
        case 'w':
            viewport.rendering().toggleWorldLabels();
            viewport.refresh();
            break;
        case 'v':
        viewport.toggleAlignment();
        break;
        case 'j':
        viewport.spawnMove(Direction.DOWNWARD, false, true);
        break;
        case 'k':
        viewport.spawnMove(Direction.UPWARD, false, true);
        break;
        case 'l':
        viewport.spawnMove(Direction.FORWARD, false, true);
        break;
        case 'r':
            viewport.showInCamera()
            break;
        case 'h':
        viewport.spawnMove(Direction.BACKWARD, false, true);
        break;
        case 'ArrowUp':
            cam.adjustOrigin(0, MOVE_SPEED/cam.scale());
            viewport.refresh();
            break;
        case 'ArrowDown':
            cam.adjustOrigin(0, -MOVE_SPEED/cam.scale());
            viewport.refresh();
            break;
        case 'ArrowRight':
            cam.adjustOrigin(-MOVE_SPEED/cam.scale(), 0);
            viewport.refresh();
            break;
        case 'ArrowLeft':
            cam.adjustOrigin(MOVE_SPEED/cam.scale(), 0);
            viewport.refresh();
            break;
        case '`':
        case '~':
            viewport.toggleNodeScale();
            break;
        case 'c':
            viewport.toggleNodeStyling();
            break;
        case 'u':
            viewport.undo();
            break;
        case 'R':
            viewport.redo()
            break;
        case 'e':
            viewport.toggleExtents();
            break;
        case 'Enter':
            viewport.toggleEditor();
            viewport.refresh();
            break;
        default:
            console.log("Unhandled '" + key + "'");
            return false;
    }
    return true;
}

export {
    handleKeyDown
};