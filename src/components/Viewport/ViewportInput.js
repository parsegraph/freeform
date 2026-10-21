import { Direction } from "parsegraph";
import {
  DONT_TOUCH_CAMERA,
  MAX_CLICK_DELAY_MS,
  SINGLE_TAP_GESTURES,
} from "../../settings";
import { matrixTransform2D, midPoint } from "parsegraph-matrix";
import { handleKeyDown } from "./handleKeyDown";
import ViewportKeystrokes from "./ViewportKeystrokes";
import ViewportPan from "./ViewportPan";
import Rect from "parsegraph-rect";

const INACTION_THROTTLE_MS = 15 * 1000;
const INACTION_CHECK_MS = 1000;
// Keep a 100-pixel wheel movement at the previous 10% zoom step.
const WHEEL_ZOOM_SENSITIVITY = Math.log(1.1) / 100;
const WHEEL_LINE_HEIGHT = 16;
const VIEW_PAN_KEYS = new Map([
  ["w", "ArrowUp"],
  ["a", "ArrowLeft"],
  ["s", "ArrowDown"],
  ["d", "ArrowRight"],
]);
const NODE_DIRECTIONS = new Map([
  ["ArrowUp", Direction.UPWARD], ["ArrowDown", Direction.DOWNWARD],
  ["ArrowLeft", Direction.BACKWARD], ["ArrowRight", Direction.FORWARD],
]);

const distance = (x1, y1, x2, y2) => {
  return Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));
};

const absoluteSizeRect = (node) => {
  if (!node) {
    return null;
  }
  const boundsRect = new Rect();
  const layout = node.layout();
  boundsRect.setX(layout.absoluteX());
  boundsRect.setY(layout.absoluteY());
  const absSize = [0, 0];
  layout.absoluteSize(absSize);
  boundsRect.setWidth(absSize[0]);
  boundsRect.setHeight(absSize[1]);
  return boundsRect;
};

class ViewportGamepad {
  constructor(viewport, gamepad) {
    if (!viewport) {
      throw new Error("A viewport must be provided");
    }
    if (!gamepad) {
      throw new Error("A gamepad must be provided");
    }
    this._viewport = viewport;
    this._gamepad = gamepad;

    this._axes = [];
    gamepad.axes.forEach(axis => {
      this._axes.push(axis);
    });

    this._buttons = [];
    gamepad.buttons.forEach(button => {
      this._buttons.push(button.pressed);
    });

    this._lastChange = Date.now();
    this._lastTick = NaN;
    this.schedule();
  }

  viewport() { 
    return this._viewport;
  }

  schedule() {
    if (this._timer) {
      return;
    }
    if (Date.now() - this._lastChange > INACTION_THROTTLE_MS) {
      let id = setTimeout(() => {
        id = null;
        this._timer = null;
        this.tick();
      }, INACTION_CHECK_MS);
      this._timer = () => {
        if (id) {
          clearTimeout(id);
          id = null;
        }
      }
    } else {
      let id = requestAnimationFrame(() => {
        id = null;
        this._timer = null;
        this.tick();
      });
      this._timer = () => {
        if (id) {
          cancelAnimationFrame(id);
          id = null;
        }
      }
    }
  }

  cancel() {
    if (!this._timer) {
      return;
    }
    this._timer();
    this._timer = null;
  }

  gamepad() {
    return this._gamepad;
  }

  buttonDown(index, buttons) {
    const viewport = this.viewport();
    const pullIfOccupied = buttons[1].pressed;
    switch (index) {
      case 3:
        viewport.showInCamera();
        break;
      case 12:
        viewport.spawnMove(Direction.UPWARD, pullIfOccupied, false);
        break;
      case 13:
        viewport.spawnMove(Direction.DOWNWARD, pullIfOccupied, false);
        break;
      case 14:
        viewport.spawnMove(Direction.BACKWARD, pullIfOccupied, false);
        break;
      case 15:
        viewport.spawnMove(Direction.FORWARD, pullIfOccupied, false);
        break;
      case 4:
        viewport.tab(false);
        break;
      case 5:
        viewport.tab(true);
        break;
    }
    this.viewport().logMessage("Down " + index);
  }

  buttonUp(index) {
    this.viewport().logMessage("Up " + index);
  }

  tick() {
    console.log("Tick");
    const gamepad = navigator.getGamepads()[this.gamepad().index];
    if (!gamepad) {
      return false;
    }

    const car = this.viewport().caret();

    let changed = false;

    gamepad.buttons.forEach((button, index) => {
      if (this._buttons[index] === button.pressed) {
        return;
      }
      changed = true;
      console.log("changed", index, button, this._buttons[index], button.pressed);
      this._buttons[index] = button.pressed;
      if (button.pressed) {
        this.buttonDown(index, gamepad.buttons);
      } else {
        this.buttonUp(index, gamepad.buttons);
      }
    });

    if (!isNaN(this._lastTick)) {
      const elapsedMs = Date.now() - this._lastTick;
      const cam = this.viewport().camera();
      const layout = car.node().layout();
      const MOVE_SPEED = 10;
      const ZOOM_SPEED = 1/10;
      gamepad.axes.forEach((axis, index) => {
        const delta = this._axes[index] - axis;
        if (Math.abs(delta) > 1e-3) {
          this.viewport().cancelCameraTravel?.();
          let [dx, dy] = [0, 0];
          switch (index) {
          case 0:
            dx = delta;
            break;
          case 1:
            dy = delta;
            break;
          }
          if (dy && gamepad.buttons[1].pressed) {
            const [x, y] = matrixTransform2D(cam.project(), layout.absoluteX(), layout.absoluteY());
            cam.zoomToPoint(Math.pow(1.1, elapsedMs*delta*ZOOM_SPEED), x + cam.width()/2, y+cam.height()/2);
            this.viewport().checkScale();
            this.viewport().refresh();
            changed = true;
            return;
          }

          this.viewport().camera().adjustOrigin(MOVE_SPEED * (elapsedMs/1000) * dx, MOVE_SPEED * (elapsedMs/1000) * dy);
          this.viewport().refresh();
          console.log("Changed");
          changed = true;
        }
        this._axes[index] = axis;
      });
    }
    this._lastTick = Date.now();
    if (changed) {
      this._lastChange = Date.now();
    }
    this.schedule();
  }
}

export default class ViewportInput {
  viewport() {
    return this._viewport;
  }

  carouselAnchor() {
    if (!this._carouselAnchor) {
      this._carouselAnchor = document.createElement("div");
      this._carouselAnchor.style.position = "relative";
      this._carouselAnchor.style.pointerEvents = "none";
      this.carouselContainer().appendChild(this._carouselAnchor);
    }
    return this._carouselAnchor;
  }

  carouselContainer() {
    return this.viewport().carouselContainer();
  }

  attachedContainer() {
    return this._attached;
  }

  unmount() {
    this.viewport().cancelCameraTravel?.();
    this._uninstallers.forEach(uninstaller=>uninstaller());
    this._uninstallers = [];
  }

  stopPan() {
    this._pan?.stop();
  }
  findControllerForGamepad(index) {
    for (let i = 0; i < this._gamepads.length; ++i) {
      const controller = this._gamepads[i];
      if (controller.gamepad().index === index) {
        return controller;
      }
    }
    return null;
  }

  canInteract() {
    return this.viewport().hasWidget() && this.viewport().rendering().showingUI();
  }

  constructor(viewport) {
    this._viewport = viewport;
    this._mousePos = [NaN, NaN];
    const canvas = this.viewport().container();
    if (!canvas) {
      throw new Error(
        "ViewportInput requires the Viewport to have a container when it is constructed"
      );
    }
    this._attached = this.viewport().container();

    this._uninstallers = [];

    // Input event callbacks
    //container.addEventListener('dragover', e => e.preventDefault());
    //container.addEventListener('drop', drop)

    this._gamepads = [];
    this._uninstallers.push(() => {
      this._gamepads.forEach(controller => controller.cancel());
      this._gamepads = [];
    });

    const connected = (e) => {
      if (!e.gamepad) {
        return;
      }
      console.log("connected");
      this._gamepads.push(new ViewportGamepad(viewport, e.gamepad));
    };
    const disconnected = (e) => {
      if (!e.gamepad) {
        return;
      }
      console.log("disconnected");
      const controller = this.findControllerForGamepad(e.gamepad.index);
      controller.cancel();
      this._gamepads = this._gamepads.filter(cand => cand !== controller);
    };
    window.addEventListener('gamepadconnected', connected);
    window.addEventListener('gamepaddisconnected', disconnected);
    this._uninstallers.push(() => {
      window.removeEventListener('gamepadconnected', connected);
      window.removeEventListener('gamepaddisconnected', disconnected);
    });

    let isDown = null;
    let [mouseX, mouseY] = [NaN, NaN];

    const mouseDownPos = [0, 0];

    const size = [0, 0];

    let clickedOnSelected = false;
    let dragged = false;
    let dragDistance = 0;
    const pan = new ViewportPan(viewport);
    this._pan = pan;
    this._uninstallers.push(() => pan.stop());
    const dragTo = (e) => {
      const dx = e.clientX - mouseX;
      const dy = e.clientY - mouseY;
      dragDistance += Math.hypot(dx, dy);
      dragged = dragDistance > 4;
      pan.dragBy(dx, dy, e.timeStamp);
    };
    const onMouseDown = (e) => {
      if (e.button !== 0 || !this.viewport().hasWidget()) {
        return;
      }
      if (this.carouselContainer().contains(e.target)) {
        return;
      }
      pan.beginDrag(e.timeStamp);
      dragged = false;
      dragDistance = 0;
      touchingNode = false;
      const car = viewport.caret();
      const cam = viewport.camera();
      const widget = car.root();
      isDown = null;
      [mouseX, mouseY] = [e.clientX, e.clientY];
      this.setMousePos(mouseX, mouseY);
      const [worldX, worldY] = cam.transform(mouseX, mouseY);
      mouseDownPos[0] = worldX;
      mouseDownPos[1] = worldY;
      isDown = Date.now();
      if (!this.canInteract()) {
        return;
      }
      let selectedNode = widget
        .layout()
        .nodeUnderCoords(worldX, worldY, 1, size);
      clickedOnSelected = car.node() === selectedNode;
      const boundsRect = absoluteSizeRect(selectedNode);
      if (
        selectedNode &&
        cam.containsAll(boundsRect) &&
        (clickedOnSelected || selectedNode.neighbors().hasAncestor(car.node()))
      ) {
        if (
          SINGLE_TAP_GESTURES &&
          !clickedOnSelected &&
          cam.containsAll(boundsRect)
        ) {
          car.moveTo(selectedNode);
          viewport.repaint();
        }
        touchingNode =
          (SINGLE_TAP_GESTURES || clickedOnSelected) &&
          cam.containsAll(boundsRect);
        viewport.refresh();
      }
    };
    canvas.addEventListener("mousedown", onMouseDown);

    const onMouseUp = (e, includeFinalMovement = true) => {
      if (e.button !== 0 || !isDown) {
        return;
      }
      // A quick flick may reach its final position only in the release event.
      if (includeFinalMovement) {
        if (!touchingNode) {
          dragTo(e);
        }
        [mouseX, mouseY] = [e.clientX, e.clientY];
      }
      let hadGesture = false;
      if (touchingNode && includeFinalMovement) {
        hadGesture = gesture(mouseX, mouseY);
        if (hadGesture) {
          viewport.repaint();
        }
      }

      const car = viewport.caret();
      const cam = viewport.camera();

      if (
        includeFinalMovement && !dragged && !hadGesture && canvas.contains(e.target) &&
        !isNaN(isDown) &&
        Date.now() - isDown < MAX_CLICK_DELAY_MS
      ) {
        const [worldX, worldY] = cam.transform(mouseX, mouseY);
        let selectedNode = car
          .root()
          .layout()
          .nodeUnderCoords(worldX, worldY, 1, size);
        if (!this.canInteract()) {
          if (selectedNode) viewport.selectNode(selectedNode);
          else viewport.clearNodeSelection();
        } else if (clickedOnSelected && selectedNode === car.node()) {
          viewport.toggleEditor();
        } else {
          viewport.hideEditor();
          if (selectedNode) {
            car.moveTo(selectedNode);
            viewport.repaint();
          }
        }
      }

      if (dragged) {
        pan.endDrag(e.timeStamp);
      } else {
        pan.stop();
      }
      touchingNode = false;
      isDown = null;
      [mouseX, mouseY] = [NaN, NaN];
      viewport.refresh();
    };
    window.addEventListener("mouseup", onMouseUp);

    const onMouseMove = (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      if (!isDown && !canvas.contains(e.target)) {
        return;
      }
      if (isDown && !(e.buttons & 1)) {
        // A move can reveal release before mouseup arrives. Finish the known
        // drag without treating the new hover position as additional movement.
        onMouseUp(e, false);
        return;
      }
      const car = viewport.caret();
      const cam = viewport.camera();
      if (!touchingNode) {
        if (isDown) {
          dragTo(e);
        } else {
          const [worldX, worldY] = cam.transform(e.clientX, e.clientY);
          let hoveredNode = car
            .root()
            .layout()
            .nodeUnderCoords(worldX, worldY, 1, size);
          if (this._hoveredNode !== hoveredNode) {
            viewport.refresh();
          }
          this._hoveredNode = hoveredNode;
        }
      }
      [mouseX, mouseY] = [e.clientX, e.clientY];
    };
    window.addEventListener("mousemove", onMouseMove);
    this._uninstallers.push(() => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
    });

    const ongoingTouches = new Map();
    const numActiveTouches = () => {
      let i = 0;
      // eslint-disable-next-line
      for (let _ of ongoingTouches.keys()) {
        ++i;
      }
      return i;
    };

    let touchingNode = false;
    let viewTouch = null;

    const cancelInteraction = () => {
      viewport.cancelCameraTravel?.();
      pan.stop();
      ongoingTouches.clear();
      viewTouch = null;
      touchingNode = false;
      isDown = false;
      [mouseX, mouseY] = [NaN, NaN];
      mouseDownPos[0] = 0;
      mouseDownPos[1] = 0;
    };
    document.body.addEventListener("focusout", cancelInteraction);
    window.addEventListener("blur", cancelInteraction);
    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelInteraction();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    this._uninstallers.push(() => {
      document.body.removeEventListener("focusout", cancelInteraction);
      window.removeEventListener("blur", cancelInteraction);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    });

    canvas.addEventListener("touchstart", (e) => {
      viewport.cancelCameraTravel?.();
      pan.stop();
      this._hoveredNode = null;
      if (!this.viewport().hasWidget()) {
        return;
      }
      const car = viewport.caret();
      const cam = viewport.camera();
      if (!car.root()) {
        return;
      }
      if (this.carouselContainer().contains(e.target)) {
        return;
      }
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        [mouseX, mouseY] = [touch.clientX, touch.clientY];
        ongoingTouches.set(touch.identifier, {
          mouseX: touch.clientX,
          mouseY: touch.clientY,
        });
        if (!this.canInteract()) {
          // View-mode taps select on release; drags and pinches keep panning.
          touchingNode = false;
          viewTouch = numActiveTouches() === 1 ? {
            id: touch.identifier, x: touch.clientX, y: touch.clientY,
            time: e.timeStamp, moved: false,
          } : null;
          continue;
        }
        const [worldX, worldY] = cam.transform(mouseX, mouseY);
        const size = [0, 0];
        let selectedNode = car
          .root()
          .layout()
          .nodeUnderCoords(worldX, worldY, 1, size);
        const boundsRect = absoluteSizeRect(selectedNode);
        if (selectedNode && cam.containsAll(boundsRect)) {
          clickedOnSelected = car.node() === selectedNode;
          touchingNode = SINGLE_TAP_GESTURES || clickedOnSelected;
          if (!clickedOnSelected) {
            car.moveTo(selectedNode);
            viewport.repaint();
          }
          isDown = Date.now();
        } else {
          viewport.hideEditor();
          isDown = Date.now();
        }
      }
    });

    const gesture = (mouseX, mouseY) => {
      const car = viewport.caret();
      const cam = viewport.camera();
      const layout = car.node().layout();
      const [worldX, worldY] = cam.transform(mouseX, mouseY);
      const dist = distance(
        worldX,
        worldY,
        layout.absoluteX(),
        layout.absoluteY()
      );
      const bodySize = [0, 0];
      car.node().layout().size(bodySize);
      bodySize[0] *= layout.absoluteScale();
      bodySize[1] *= layout.absoluteScale();

      const dy = Math.abs(worldY - layout.absoluteY());
      const dx = Math.abs(worldX - layout.absoluteX());

      touchingNode = false;

      if (worldX === layout.absoluteX() || dy > dx) {
        if (dist > bodySize[1] / 2) {
          if (worldY > layout.absoluteY()) {
            viewport.spawnMove(Direction.DOWNWARD, true, DONT_TOUCH_CAMERA);
          } else {
            viewport.spawnMove(Direction.UPWARD, true, DONT_TOUCH_CAMERA);
          }
          isDown = NaN;
          return true;
        }
      } else {
        if (dist > bodySize[0] / 2) {
          if (worldX > layout.absoluteX()) {
            viewport.spawnMove(Direction.FORWARD, true, DONT_TOUCH_CAMERA);
          } else {
            viewport.spawnMove(Direction.BACKWARD, true, DONT_TOUCH_CAMERA);
          }
          isDown = NaN;
          return true;
        }
      }
      return false;
    };

    canvas.addEventListener("touchcancel", (e) => {
      viewTouch = null;
      if (!this.viewport().hasWidget()) {
        return;
      }
      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        const touchData = ongoingTouches.get(touch.identifier);
        if (!touchData) {
          continue;
        }
        ongoingTouches.delete(touch.identifier);
      }
    });

    canvas.addEventListener("touchend", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      const car = viewport.caret();
      const cam = viewport.camera();
      if (!car.root()) {
        return;
      }
      let [mouseX, mouseY] = [NaN, NaN];
      const isGesture = numActiveTouches() === 1;
      if (!this.canInteract()) {
        for (const touch of e.changedTouches) {
          if (viewTouch?.id === touch.identifier && isGesture && !viewTouch.moved &&
            Math.hypot(touch.clientX - viewTouch.x, touch.clientY - viewTouch.y) <= 8 &&
            e.timeStamp - viewTouch.time < MAX_CLICK_DELAY_MS) {
            const [x, y] = cam.transform(touch.clientX, touch.clientY);
            const selected = car.root().layout().nodeUnderCoords(x, y, 1, size);
            if (selected) viewport.selectNode(selected);
            else viewport.clearNodeSelection();
          }
          ongoingTouches.delete(touch.identifier);
        }
        viewTouch = null;
        touchingNode = false;
        return;
      }
      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        const touchData = ongoingTouches.get(touch.identifier);
        if (!touchData) {
          continue;
        }
        mouseX = touchData.mouseX;
        mouseY = touchData.mouseY;
        this.setMousePos(mouseX, mouseY);

        ongoingTouches.delete(touch.identifier);
      }
      if (isNaN(mouseX)) {
        return;
      }
      if (touchingNode && isGesture) {
        if (gesture(mouseX, mouseY)) {
          viewport.repaint();
        } else if (!isNaN(isDown) && Date.now() - isDown < MAX_CLICK_DELAY_MS) {
          const [worldX, worldY] = cam.transform(mouseX, mouseY);
          let selectedNode = car
            .root()
            .layout()
            .nodeUnderCoords(worldX, worldY, 1, size);
          if (clickedOnSelected && selectedNode === car.node()) {
            viewport.toggleEditor();
          }
        }
      }
    });

    canvas.addEventListener("touchmove", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      const cam = viewport.camera();
      e.preventDefault();
      if (viewTouch) {
        for (const touch of e.changedTouches) {
          if (touch.identifier === viewTouch.id &&
            Math.hypot(touch.clientX - viewTouch.x, touch.clientY - viewTouch.y) > 8) {
            viewTouch.moved = true;
          }
        }
      }

      if (numActiveTouches() > 1) {
        const [first, second] = [...ongoingTouches.values()];
        const origDistance = distance(
          first.mouseX,
          first.mouseY,
          second.mouseX,
          second.mouseY
        );
        for (let i = 0; i < e.changedTouches.length; ++i) {
          const touch = e.changedTouches[i];
          const touchData = ongoingTouches.get(touch.identifier);
          if (!touchData) {
            continue;
          }
          touchData.mouseX = touch.clientX;
          touchData.mouseY = touch.clientY;
        }
        const newDistance = distance(
          first.mouseX,
          first.mouseY,
          second.mouseX,
          second.mouseY
        );
        cam.zoomToPoint(
          newDistance / origDistance,
          ...midPoint(first.mouseX, first.mouseY, second.mouseX, second.mouseY)
        );
        viewport.checkScale();
        return;
      }

      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        const touchData = ongoingTouches.get(touch.identifier);
        if (!touchData) {
          continue;
        }
        const dx = touch.clientX - touchData.mouseX;
        const dy = touch.clientY - touchData.mouseY;
        if (!touchingNode) {
          cam.adjustOrigin(dx / cam.scale(), dy / cam.scale());
          viewport.refresh();
        }
        touchData.mouseX = touch.clientX;
        touchData.mouseY = touch.clientY;
      }
    });

    const handleWheel = (e) => {
      this._hoveredNode = null;
      if (!this.viewport().hasWidget() || isNaN(mouseX)) {
        return;
      }
      // Wheel deltas can be expressed in pixels, lines, or pages.
      const deltaMode = e.deltaMode;
      const deltaUnit = deltaMode === 1
        ? WHEEL_LINE_HEIGHT
        : deltaMode === 2 ? canvas.clientHeight : 1;
      const delta = e.deltaY * deltaUnit;
      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }
      e.preventDefault();
      pan.stop();
      viewport.cancelCameraTravel?.();
      viewport.camera().zoomToPoint(
        Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), mouseX, mouseY
      );
      viewport.checkScale();
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    this._uninstallers.push(() => {
      canvas.removeEventListener("wheel", handleWheel);
    });

    const onKeyDown = (e) => {
      this._hoveredNode = null;

      if (!viewport.hasWidget() || viewport.showingEditor()) {
        return;
      }

      const key = e.key.toLowerCase();
      const direction = !viewport.rendering().showingUI() &&
        !e.ctrlKey && !e.metaKey && !e.altKey
        ? VIEW_PAN_KEYS.get(key) || e.key
        : e.key;
      if (!this.canInteract() && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "Escape") {
          pan.stop();
          viewport.clearNodeSelection();
          e.preventDefault();
          return;
        }
        if (viewport.navigatingNodes() && NODE_DIRECTIONS.has(direction)) {
          pan.stop();
          viewport.moveToNeighbor(NODE_DIRECTIONS.get(direction));
          e.preventDefault();
          return;
        }
      }
      const panning = pan.keyDown(key, direction);
      if (!panning) {
        if (!this.canInteract()) {
          return;
        }
        pan.stop();
      }
      if (panning || handleKeyDown(viewport, e.key, mouseX, mouseY, e)) {
        if (this.keystrokes()) {
          this.keystrokes().handleKey(e.key);
        }
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => pan.keyUp(e.key.toLowerCase());
    canvas.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    this._uninstallers.push(() => {
      canvas.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    });

    new ResizeObserver(() => {
      viewport.cancelCameraTravel?.();
      viewport.camera().setSize(canvas.offsetWidth, canvas.offsetHeight);
      if (this.viewport().hasWidget()) {
        viewport.checkScale();
        return;
      }
    }).observe(canvas);

    this._keystrokes = new ViewportKeystrokes(viewport);
  }

  hoveredNode() {
    return this._hoveredNode;
  }

  keystrokes() {
    return this._keystrokes;
  }

  setMousePos(mouseX, mouseY) {
    this._mousePos[0] = mouseX;
    this._mousePos[1] = mouseY;
  }
}
