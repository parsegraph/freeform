import Rect from 'parsegraph-rect';
import { containsAny } from 'parsegraph-camera';

export default class Occluder {
    constructor(x, y, width, height) {
      this._bbox = new Rect(x, y, width, height);
      this.clear();
    }
  
    clear() {
      this._rects = [];
    }
  
    occlude(x, y, w, h) {
      if (
        !containsAny(
          this._bbox.x(),
          this._bbox.y(),
          this._bbox.width(),
          this._bbox.height(),
          x,
          y,
          w,
          h
        )
      ) {
        // console.log("Occluded outside bbox", this._bbox.toString(), x, y, w, h);
        return false;
      }
      if (
        this._rects.some((rect) => {
          return containsAny(rect.x(), rect.y(), rect.w(), rect.h(), x, y, w, h);
        })
      ) {
        return false;
      }
      const newRect = new Rect(x, y, w, h);
      this._rects.push(newRect);
      return true;
    }
}
