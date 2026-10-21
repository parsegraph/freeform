import { Font } from "parsegraph-glyphpainter";
import { FONT_SIZE, FONT_UPSCALE } from "../../settings";
import { measureBenchmark } from "../../benchmark";

// Atlas ownership follows the displayed document, not a layout pass or group.
export default class DocumentFont {
  isFor(root, provider) {
    return this._root === root && this._provider === provider;
  }

  get(root, provider, benchmark) {
    if (!this.isFor(root, provider)) {
      this.dispose();
      this._root = root;
      this._provider = provider;
    }
    this._benchmark = benchmark;
    if (!this._font) {
      const font = new Font(FONT_UPSCALE * FONT_SIZE, "sans-serif", "normal");
      const update = font.update;
      const owner = this;
      font.update = function (glProvider) {
        return measureBenchmark(owner._benchmark, "Glyph atlas update", () => {
          // glyphpainter 3.0.2 replaces textures when new glyphs are added,
          // without deleting the old ones. Release that upload first; dispose
          // preserves glyph/page coordinates used by the groups' vertex buffers.
          const uploaded = this._windows.get(glProvider)?._numGlyphs;
          if (uploaded > 0 && uploaded !== this._numGlyphs) {
            this.dispose(glProvider);
          }
          return update.call(this, glProvider);
        });
      };
      this._font = font;
    }
    return this._font;
  }

  contextLost() {
    this._font?.dispose(this._provider);
  }

  dispose() {
    this.contextLost();
    this._font = undefined;
    this._root = undefined;
    this._provider = undefined;
    this._benchmark = undefined;
  }
}
