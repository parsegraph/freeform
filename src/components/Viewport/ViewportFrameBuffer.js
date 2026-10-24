const vertexSource = `
attribute vec2 a_position;
uniform vec2 u_size;
uniform vec2 u_offset;
uniform float u_scale;
#ifdef GL_FRAGMENT_PRECISION_HIGH
varying highp vec2 v_texcoord;
#else
varying mediump vec2 v_texcoord;
#endif
void main() {
  vec2 pixel = a_position * u_size * u_scale + u_offset;
  gl_Position = vec4(pixel / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  // Framebuffer texture coordinates start at the bottom, screen pixels at the top.
  v_texcoord = vec2(a_position.x, 1.0 - a_position.y);
}`;

const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_image;
varying vec2 v_texcoord;
void main() {
  gl_FragColor = texture2D(u_image, v_texcoord);
}`;

const FRAME_SAMPLE_SCALE = 2;
// Two RGBA targets at this limit use 64 MiB, excluding the default framebuffer.
const MAX_SAMPLED_TARGET_PIXELS = 8 * 1024 * 1024;

function cameraValue(camera, name) {
  return typeof camera[name] === "function" ? camera[name]() : camera[name];
}

// The camera projects screen = (world + origin) * scale. Plain snapshots must
// therefore contain Camera.x()/y(), rather than cameraPose()'s world center.
export function viewportFrameTransform(live, captured) {
  const scale = cameraValue(live, "scale");
  return {
    scale: scale / cameraValue(captured, "scale"),
    x: (cameraValue(live, "x") - cameraValue(captured, "x")) * scale,
    y: (cameraValue(live, "y") - cameraValue(captured, "y")) * scale,
  };
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Cannot allocate viewport buffer shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Cannot compile viewport buffer shader: ${error}`);
  }
  return shader;
}

/**
 * Double buffers a whole viewport in its existing WebGL context. Only publish()
 * makes a finished back buffer eligible for presentation. Camera movement can
 * present the front arbitrarily often without modifying either texture.
 */
export default class ViewportFrameBuffer {
  constructor(gl) {
    this._gl = gl;
    this._width = 0;
    this._height = 0;
    this._targetWidth = 0;
    this._targetHeight = 0;
    this._limits = null;
    this._allocationFallbacks = new Set();
    this._front = null;
    this._back = null;
    this._hasFront = false;
    this._drawing = false;
    this._program = null;
    this._quad = null;
    this._disposed = false;
  }

  hasFront() {
    return this._hasFront;
  }

  assertAvailable() {
    if (this._disposed) throw new Error("Viewport buffer has been disposed");
  }

  initializeProgram() {
    if (this._program) return;
    const gl = this._gl;
    let vertex;
    let fragment;
    let program;
    let quad;
    try {
      vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
      fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      if (!program) throw new Error("Cannot allocate viewport buffer program");
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(
          `Cannot link viewport buffer program: ${gl.getProgramInfoLog(
            program
          )}`
        );
      }
      quad = gl.createBuffer();
      if (!quad) throw new Error("Cannot allocate viewport buffer quad");
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
        gl.STATIC_DRAW
      );
      this._position = gl.getAttribLocation(program, "a_position");
      this._size = gl.getUniformLocation(program, "u_size");
      this._offset = gl.getUniformLocation(program, "u_offset");
      this._scale = gl.getUniformLocation(program, "u_scale");
      this._image = gl.getUniformLocation(program, "u_image");
      this._program = program;
      this._quad = quad;
    } catch (error) {
      if (quad) gl.deleteBuffer(quad);
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }

  createTarget(width, height) {
    const gl = this._gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    try {
      if (!texture || !framebuffer) {
        throw new Error("Cannot allocate viewport frame buffer");
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
      );
      if (
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error(
          `Cannot create complete viewport frame buffer (${width} × ${height})`
        );
      }
      return { texture, framebuffer };
    } catch (error) {
      if (texture) gl.deleteTexture(texture);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      throw error;
    } finally {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  deleteTarget(target) {
    if (!target) return;
    this._gl.deleteTexture(target.texture);
    this._gl.deleteFramebuffer(target.framebuffer);
  }

  createTargets(width, height) {
    const front = this.createTarget(width, height);
    try {
      return { front, back: this.createTarget(width, height) };
    } catch (error) {
      this.deleteTarget(front);
      throw error;
    }
  }

  resize(width, height) {
    if (this._front && this._width === width && this._height === height) return;
    const gl = this._gl;
    // Limit queries may synchronize with the GPU. Cache them for this context.
    this._limits ??= {
      texture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      viewport: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    };
    const { texture: limit, viewport: viewportLimit } = this._limits;
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0 ||
      width > limit ||
      height > limit ||
      width > viewportLimit[0] ||
      height > viewportLimit[1]
    ) {
      throw new Error(
        `Unsupported viewport buffer dimensions: ${width} × ${height}`
      );
    }
    const allocationKey = `${width}x${height}`;
    let targetWidth = width * FRAME_SAMPLE_SCALE;
    let targetHeight = height * FRAME_SAMPLE_SCALE;
    if (
      this._allocationFallbacks.has(allocationKey) ||
      targetWidth > limit || targetHeight > limit ||
      targetWidth > viewportLimit[0] || targetHeight > viewportLimit[1] ||
      targetWidth * targetHeight > MAX_SAMPLED_TARGET_PIXELS
    ) {
      targetWidth = width;
      targetHeight = height;
    }
    // Allocate both replacements before deleting the old pair. If extra sample
    // storage is unavailable, retain complete-frame buffering at native size.
    let targets;
    try {
      targets = this.createTargets(targetWidth, targetHeight);
    } catch (error) {
      if (targetWidth === width && targetHeight === height) throw error;
      // WebGL reports allocation failures through sticky error flags as well
      // as framebuffer completeness. Consume the failed attempt's errors so
      // later graph painters do not mistake them for failures in their draws.
      while (gl.getError() !== gl.NO_ERROR) {
        // The GL error set is drained only on this allocation-recovery path.
      }
      this._allocationFallbacks.add(allocationKey);
      targetWidth = width;
      targetHeight = height;
      targets = this.createTargets(targetWidth, targetHeight);
    }
    this.deleteTarget(this._front);
    this.deleteTarget(this._back);
    this._front = targets.front;
    this._back = targets.back;
    this._width = width;
    this._height = height;
    this._targetWidth = targetWidth;
    this._targetHeight = targetHeight;
    this.discard();
  }

  graphBlend() {
    const gl = this._gl;
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA
    );
  }

  targetState(framebuffer, width, height) {
    const gl = this._gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
  }

  begin(width, height) {
    this.assertAvailable();
    this._drawing = false;
    this.initializeProgram();
    this.resize(width, height);
    this._drawing = true;
    this.drawTarget();
    const gl = this._gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Rebind between time slices, after present() has used the default framebuffer.
  drawTarget() {
    this.assertAvailable();
    if (!this._drawing) throw new Error("No viewport frame is being drawn");
    // Projection remains in logical viewport coordinates. Rasterizing its clip
    // space into a larger target samples geometry more densely without replaying
    // graph drawing. LINEAR presentation averages each 2 × 2 footprint at rest.
    this.targetState(this._back.framebuffer, this._targetWidth, this._targetHeight);
    this.graphBlend();
  }

  publish() {
    this.assertAvailable();
    if (!this._drawing)
      throw new Error("Cannot publish an unstarted viewport frame");
    [this._front, this._back] = [this._back, this._front];
    this._hasFront = true;
    this._drawing = false;
    // The published front must never remain bound as a drawing target.
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
  }

  present(liveCamera, capturedCamera) {
    this.assertAvailable();
    const gl = this._gl;
    this.targetState(
      null,
      this._width || gl.drawingBufferWidth,
      this._height || gl.drawingBufferHeight
    );
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this._hasFront) return false;
    const transform = viewportFrameTransform(liveCamera, capturedCamera);
    gl.useProgram(this._program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quad);
    gl.enableVertexAttribArray(this._position);
    gl.vertexAttribPointer(this._position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this._size, this._width, this._height);
    gl.uniform2f(this._offset, transform.x, transform.y);
    gl.uniform1f(this._scale, transform.scale);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._front.texture);
    gl.uniform1i(this._image, 0);
    // Graph drawing has already accumulated premultiplied RGB into the texture.
    // Blending it with SRC_ALPHA here would apply alpha a second time.
    gl.disable(gl.BLEND);
    try {
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } finally {
      gl.disableVertexAttribArray(this._position);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.graphBlend();
    }
    return true;
  }

  discard() {
    this._hasFront = false;
    this._drawing = false;
  }

  contextLost() {
    // Lost-context resources are already invalid. Do not call deletion APIs;
    // the next begin() after restoration will rebuild everything lazily.
    this._front = null;
    this._back = null;
    this._program = null;
    this._quad = null;
    this._width = 0;
    this._height = 0;
    this._targetWidth = 0;
    this._targetHeight = 0;
    this._limits = null;
    this._allocationFallbacks.clear();
    this.discard();
  }

  dispose() {
    if (this._disposed) return;
    this.deleteTarget(this._front);
    this.deleteTarget(this._back);
    if (this._quad) this._gl.deleteBuffer(this._quad);
    if (this._program) this._gl.deleteProgram(this._program);
    this.contextLost();
    this._disposed = true;
  }
}
