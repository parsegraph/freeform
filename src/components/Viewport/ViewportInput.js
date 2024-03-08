import React from "react";
import { Direction } from "parsegraph";
import {
  MAX_CLICK_DELAY_MS,
  SHOW_KEY_STROKES,
  SINGLE_TAP_GESTURES,
} from "../../settings";
import { midPoint } from "parsegraph-matrix";
import { handleKeyDown } from "./handleKeyDown";
import ViewportKeystrokes from "./ViewportKeystrokes";
import Carousel from "../Carousel";
import Rect from "parsegraph-rect";

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

    // Input event callbacks
    //container.addEventListener('dragover', e => e.preventDefault());
    //container.addEventListener('drop', drop)

    canvas.addEventListener("focus", () => {
      viewport.hideEditor();
    });

    let isDown = null;
    let [mouseX, mouseY] = [NaN, NaN];

    const mouseDownPos = [0, 0];

    const size = [0, 0];

    let clickedOnSelected = false;
    canvas.addEventListener("mousedown", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      if (this.carouselContainer().contains(e.target)) {
        return;
      }
      const car = viewport.caret();
      const cam = viewport.camera();
      const widget = car.root();
      isDown = null;
      [mouseX, mouseY] = [e.clientX, e.clientY];
      this.setMousePos(mouseX, mouseY);
      const [worldX, worldY] = cam.transform(mouseX, mouseY);
      mouseDownPos[0] = worldX;
      mouseDownPos[1] = worldY;
      let selectedNode = widget
        .layout()
        .nodeUnderCoords(worldX, worldY, 1, size);
      isDown = Date.now();
      clickedOnSelected = car.node() === selectedNode;
      const boundsRect = absoluteSizeRect(selectedNode);
      if (
        selectedNode &&
        (clickedOnSelected ||
          cam.containsAll(boundsRect) ||
          selectedNode.neighbors().hasAncestor(car.node()))
      ) {
        if (!clickedOnSelected && cam.containsAll(boundsRect)) {
          car.moveTo(selectedNode);
          viewport.refresh();
        }
        touchingNode = SINGLE_TAP_GESTURES || clickedOnSelected;
        viewport.refresh();
      }
    });

    canvas.addEventListener("mouseup", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      let hadGesture = false;
      if (touchingNode) {
        hadGesture = gesture(mouseX, mouseY);
        if (hadGesture) {
          viewport.repaint();
        }
      }

      const car = viewport.caret();
      const cam = viewport.camera();

      if (!isNaN(isDown) && Date.now() - isDown < MAX_CLICK_DELAY_MS) {
        const [worldX, worldY] = cam.transform(mouseX, mouseY);
        let selectedNode = car
          .root()
          .layout()
          .nodeUnderCoords(worldX, worldY, 1, size);
        if (clickedOnSelected && selectedNode === car.node()) {
          viewport.toggleEditor();
        } else if (selectedNode) {
          car.moveTo(selectedNode);
          viewport.refresh();
        }
      }

      isDown = null;
      [mouseX, mouseY] = [NaN, NaN];
      viewport.refresh();
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      const car = viewport.caret();
      const cam = viewport.camera();
      const dx = e.clientX - mouseX;
      const dy = e.clientY - mouseY;
      if (!touchingNode) {
        if (isDown) {
            cam.adjustOrigin(dx / cam.scale(), dy / cam.scale());
            viewport.refresh();
        } else {
            const [worldX, worldY] = cam.transform(e.clientX, e.clientY);
            let hoveredNode = car.root().layout()
                .nodeUnderCoords(worldX, worldY, 1, size);
            if (this._hoveredNode !== hoveredNode) {
                viewport.refresh();
            }
            this._hoveredNode = hoveredNode;
        }
      } 
      [mouseX, mouseY] = [e.clientX, e.clientY];
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
    canvas.addEventListener("touchstart", (e) => {
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
            viewport.refresh();
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
            viewport.spawnMove(Direction.DOWNWARD, true, true);
          } else {
            viewport.spawnMove(Direction.UPWARD, true, true);
          }
          isDown = NaN;
          return true;
        }
      } else {
        if (dist > bodySize[0] / 2) {
          if (worldX > layout.absoluteX()) {
            viewport.spawnMove(Direction.FORWARD, true, true);
          } else {
            viewport.spawnMove(Direction.BACKWARD, true, true);
          }
          isDown = NaN;
          return true;
        }
      }
      return false;
    };

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
      const car = viewport.caret();
      const cam = viewport.camera();
      e.preventDefault();

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

    canvas.addEventListener("wheel", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      const cam = viewport.camera();
      if (!isNaN(mouseX)) {
        cam.zoomToPoint(Math.pow(1.1, e.deltaY > 0 ? -1 : 1), mouseX, mouseY);
        viewport.checkScale();
      }
    });

    canvas.addEventListener("keydown", (e) => {
      if (!this.viewport().hasWidget()) {
        return;
      }
      if (viewport.showingEditor()) {
        return;
      }

      if (handleKeyDown(viewport, e.key, mouseX, mouseY, e)) {
        if (this.keystrokes()) {
            this.keystrokes().handleKey(e.key);
        }
        e.preventDefault();
      }
    });

    new ResizeObserver(() => {
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
