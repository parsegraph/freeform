import Color from "parsegraph-color";
import { compileProgram } from "parsegraph-compileprogram";
import {
  JSON_BORDER_BEND,
  JSON_BORDER_DEPTH,
  JSON_BORDER_LINE_WIDTH,
  JSON_BORDER_PADDING,
} from "../../structuredJsonBorders";

// Six attributes fit WebGL 1's minimum of eight. All kinds share this layout
// and are appended in paint order, including connector rectangles and buds.
const FLOATS_PER_VERTEX = 18;
const VERTICES_PER_BLOCK = 6;
const FLOATS_PER_BLOCK = FLOATS_PER_VERTEX * VERTICES_PER_BLOCK;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
const KINDS = new Map([
  ["object", 1],
  ["array", 2],
  ["boolean", 3],
]);
const ATTRIBUTES = [
  ["a_position", 2, 0],
  ["a_local", 2, 2],
  ["a_size", 2, 4],
  ["a_fill", 4, 6],
  ["a_border", 4, 10],
  ["a_shape", 4, 14],
];

function vertexShader(precision) {
  return `
uniform mat3 u_world;
uniform float u_cssScale;
attribute vec2 a_position;
attribute vec2 a_local;
attribute vec2 a_size;
attribute vec4 a_fill;
attribute vec4 a_border;
attribute vec4 a_shape;
varying ${precision} vec2 v_local;
varying ${precision} vec2 v_size;
varying ${precision} vec4 v_fill;
varying ${precision} vec4 v_border;
varying ${precision} vec4 v_shape;
void main() {
  // Include the outside half of the antialiasing fringe without changing the
  // logical node bounds. This margin stays one CSS pixel at every zoom.
  vec2 margin = sign(a_local);
  vec2 position = a_position + margin / u_cssScale;
  gl_Position = vec4((u_world * vec3(position, 1.0)).xy, 0.0, 1.0);
  v_local = a_local * u_cssScale + margin;
  v_size = a_size * u_cssScale;
  v_fill = a_fill;
  v_border = a_border;
  v_shape = vec4(a_shape.xy * u_cssScale, a_shape.z,
                 a_shape.w * u_cssScale);
}
`;
}

function fragmentShader(derivatives, precision) {
  return `${
    derivatives ? "#extension GL_OES_standard_derivatives : enable" : ""
  }
precision ${precision} float;
varying ${precision} vec2 v_local;
varying ${precision} vec2 v_size;
varying ${precision} vec4 v_fill;
varying ${precision} vec4 v_border;
varying ${precision} vec4 v_shape;

float stableLength(vec2 value) {
  float magnitude = max(abs(value.x), abs(value.y));
  if (magnitude == 0.0) return 0.0;
  vec2 normalized = value / magnitude;
  return magnitude * sqrt(dot(normalized, normalized));
}

float boxDistanceLowerBound(vec2 p, vec2 low, vec2 high) {
  vec2 separation = max(max(low - p, p - high), 0.0);
  // The maximum axis distance is a conservative Euclidean lower bound. It
  // also avoids squaring large CSS coordinates on mediump WebGL 1 devices.
  return max(separation.x, separation.y);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 edge = b - a;
  float magnitude = max(abs(edge.x), abs(edge.y));
  if (magnitude == 0.0) return stableLength(p - a);
  vec2 normalized = edge / magnitude;
  // Scale before taking dot products: a 300px segment already overflows when
  // squared with a true 16-bit mediump float. Halving the projection operands
  // also keeps the sum of two large coordinates in range.
  float projection = dot((p - a) * 0.5, normalized) / magnitude;
  float t = clamp(projection / (dot(normalized, normalized) * 0.5), 0.0, 1.0);
  return stableLength(p - a - t * edge);
}

float cubeRoot(float x) {
  return sign(x) * pow(abs(x), 1.0 / 3.0);
}

float quadraticPointDistance(vec2 a, vec2 b, vec2 c, float t) {
  t = clamp(t, 0.0, 1.0);
  return stableLength((a * t + b) * t + c);
}

// The derivative of squared distance to a quadratic is a cubic. Checking all
// its real roots and the endpoints avoids the flat-tangent artifacts of using
// horizontal distance to a brace, and keeps its stroke width constant.
float quadraticDistance(vec2 p, vec2 start, vec2 control, vec2 end) {
  vec2 a = start - 2.0 * control + end;
  vec2 b = 2.0 * (control - start);
  vec2 c = start - p;
  float divisor = 2.0 * dot(a, a);
  if (divisor < 0.0000001) return segmentDistance(p, start, end);
  float A = 3.0 * dot(a, b) / divisor;
  float B = (dot(b, b) + 2.0 * dot(a, c)) / divisor;
  float C = dot(b, c) / divisor;
  float thirdP = (B - A * A / 3.0) / 3.0;
  float halfQ = (2.0 * A * A * A / 27.0 - A * B / 3.0 + C) / 2.0;
  float discriminant = halfQ * halfQ + thirdP * thirdP * thirdP;
  float result = min(stableLength(start - p), stableLength(end - p));
  if (discriminant >= 0.0) {
    float root = sqrt(discriminant);
    float t = cubeRoot(-halfQ + root) + cubeRoot(-halfQ - root) - A / 3.0;
    result = min(result, quadraticPointDistance(a, b, c, t));
  } else {
    float radius = sqrt(-thirdP);
    float angle = acos(clamp(-halfQ / (radius * radius * radius), -1.0, 1.0)) / 3.0;
    float t = 2.0 * radius * cos(angle) - A / 3.0;
    result = min(result, quadraticPointDistance(a, b, c, t));
    t = 2.0 * radius * cos(angle + 2.09439510239) - A / 3.0;
    result = min(result, quadraticPointDistance(a, b, c, t));
    t = 2.0 * radius * cos(angle - 2.09439510239) - A / 3.0;
    result = min(result, quadraticPointDistance(a, b, c, t));
  }
  return result;
}

float roundedDistance(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return stableLength(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

float customDistance(vec2 p, vec2 halfSize, float kind, float lineWidth) {
  vec2 extent = max(halfSize - lineWidth / 2.0, vec2(0.000001));
  if (kind < 2.5 && kind > 1.5) return roundedDistance(p, extent, 0.0);

  p = abs(p);
  float depth = min(min(${Number(JSON_BORDER_DEPTH).toFixed(
    1
  )}, v_size.x / 3.0),
                    min(v_size.y * 2.0 / 3.0, ${Number(
                      JSON_BORDER_PADDING
                    ).toFixed(1)} * v_shape.w));
  float inner = extent.x - depth;
  // The entire rectangle here is safely inside either contour. Large object
  // backgrounds therefore do not run the quadratic solver for interior pixels.
  if (p.x < inner - 2.0 && p.y < extent.y - 2.0) return -2.0;
  float distance = segmentDistance(p, vec2(0.0, extent.y), vec2(inner, extent.y));
  float boundary;
  if (kind > 2.5) {
    distance = min(distance, segmentDistance(p, vec2(extent.x, 0.0), vec2(inner, extent.y)));
    boundary = extent.x - depth * clamp(p.y / extent.y, 0.0, 1.0);
  } else {
    float bend = min(${Number(JSON_BORDER_BEND).toFixed(1)}, v_size.y / 6.0);
    float stem = extent.x - depth / 2.0;
    distance = min(distance, segmentDistance(p, vec2(stem, bend), vec2(stem, extent.y - bend)));
    // A curve cannot be closer than its bounding box. Besides avoiding work,
    // these bounds keep far-away coordinates out of the cubic on tall nodes.
    if (boxDistanceLowerBound(p, vec2(stem, 0.0), vec2(extent.x, bend)) < distance) {
      distance = min(distance, quadraticDistance(p, vec2(extent.x, 0.0), vec2(stem, 0.0), vec2(stem, bend)));
    }
    if (boxDistanceLowerBound(p, vec2(inner, extent.y - bend), vec2(stem, extent.y)) < distance) {
      distance = min(distance, quadraticDistance(p, vec2(stem, extent.y - bend), vec2(stem, extent.y), vec2(inner, extent.y)));
    }
    // Invert the same quadratics in y only to determine which side is filled.
    // Distance itself comes from the nearest point, including horizontal tips.
    if (p.y < bend) {
      float t = 1.0 - sqrt(max(p.y / bend, 0.0));
      boundary = stem + depth / 2.0 * t * t;
    } else if (p.y > extent.y - bend) {
      float t = 1.0 - sqrt(max((extent.y - p.y) / bend, 0.0));
      boundary = stem - depth / 2.0 * t * t;
    } else {
      boundary = stem;
    }
  }
  // Keep the interior distance continuous with the early-out above.
  return p.y <= extent.y && p.x <= boundary ? -min(distance, 2.0) : distance;
}

void main() {
  vec2 halfSize = v_size / 2.0;
  float outerDistance;
  float innerDistance;
  if (v_shape.z < 0.5) {
    float radius = min(v_shape.x / 2.0, min(halfSize.x, halfSize.y));
    outerDistance = roundedDistance(v_local, halfSize, radius);
    innerDistance = outerDistance + v_shape.y / 2.0;
  } else {
    float lineWidth = min(${Number(JSON_BORDER_LINE_WIDTH).toFixed(
      1
    )}, min(v_size.x / 8.0, v_size.y / 8.0));
    float distance = customDistance(v_local, halfSize, v_shape.z, lineWidth);
    outerDistance = distance - lineWidth / 2.0;
    innerDistance = distance + lineWidth / 2.0;
  }
  // Pixel size is independent of the distance solver and its interior fast
  // path. Differentiating those branches can turn numerical jumps into faint
  // internal fringes, even though every affected pixel is inside the contour.
  vec2 pixelSize = ${derivatives ? "fwidth(v_local)" : "vec2(1.0)"};
  float aa = clamp(max(pixelSize.x, pixelSize.y) / 2.0, 0.0001, 1.0);
  float outerCoverage = 1.0 - smoothstep(-aa, aa, outerDistance);
  float fillCoverage = 1.0 - smoothstep(-aa, aa, innerDistance);
  float borderCoverage = max(0.0, outerCoverage - fillCoverage);
  float fillAlpha = v_fill.a * fillCoverage;
  float borderAlpha = v_border.a * borderCoverage;
  float alpha = fillAlpha + borderAlpha;
  vec3 associatedColor = v_fill.rgb * fillAlpha + v_border.rgb * borderAlpha;
  // The graph framebuffer uses SRC_ALPHA for RGB and ONE for alpha. Convert
  // the combined coverage back to straight alpha for that existing blend mode.
  gl_FragColor = vec4(associatedColor / max(alpha, 0.000001), alpha);
}
`;
}

// compileProgram owns the provider's shared cache. Track only resources made
// during this call so failed compilation does not leak shaders or a program.
function compileSharedProgram(provider, gl, derivatives, precision) {
  const shaders = [];
  const programs = [];
  const trackedGL = new Proxy(gl, {
    get(target, name) {
      if (name === "compileShader") {
        return (shader) => {
          target.compileShader(shader);
          if (!target.getShaderParameter(shader, target.COMPILE_STATUS)) {
            throw new Error(
              `TypedBlockPainter shader failed: ${target.getShaderInfoLog(
                shader
              )}`
            );
          }
        };
      }
      if (name === "linkProgram") {
        return (program) => {
          target.linkProgram(program);
          if (!target.getProgramParameter(program, target.LINK_STATUS)) {
            throw new Error(
              `TypedBlockPainter program failed: ${target.getProgramInfoLog(
                program
              )}`
            );
          }
        };
      }
      if (name === "createShader" || name === "createProgram") {
        return (...args) => {
          const resource = target[name](...args);
          if (resource)
            (name === "createShader" ? shaders : programs).push(resource);
          return resource;
        };
      }
      const value = target[name];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    return compileProgram(
      { gl: () => trackedGL, shaders: () => provider.shaders() },
      `FreeformTypedBlocks-v2-${
        derivatives ? "derivatives" : "pixels"
      }-${precision}`,
      vertexShader(precision),
      fragmentShader(derivatives, precision)
    );
  } catch (error) {
    programs.forEach((program) => gl.deleteProgram(program));
    throw error;
  } finally {
    shaders.forEach((shader) => gl.deleteShader(shader));
  }
}

export default class TypedBlockPainter {
  constructor(glProvider) {
    this._glProvider = glProvider;
    this._backgroundColor = new Color(1, 1, 1, 1);
    this._borderColor = new Color(0, 0, 0, 1);
    this._data = new Float32Array(0);
    this._capacity = 0;
    this._count = 0;
    this._allocated = 0;
    this._buffer = null;
    this._gpuCapacity = 0;
    this._program = null;
    this._dirty = false;
  }

  glProvider() {
    return this._glProvider;
  }

  backgroundColor() {
    return this._backgroundColor;
  }

  setBackgroundColor(color) {
    this._backgroundColor = color;
  }

  setBorderColor(color) {
    this._borderColor = color;
  }

  clear() {
    this._count = 0;
    this._allocated = 0;
    this._dirty = false;
  }

  initBuffer(count) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        "TypedBlockPainter block count must be a nonnegative integer"
      );
    }
    if (count > this._capacity) {
      const capacity = Math.max(count, this._capacity * 2);
      this._data = new Float32Array(capacity * FLOATS_PER_BLOCK);
      this._capacity = capacity;
    }
    this._allocated = count;
    this._count = 0;
    this._dirty = true;
  }

  drawBlock(cx, cy, width, height, roundness, thickness, kind, nodeScale = 1) {
    if (this._count >= this._allocated) {
      throw new Error(
        "TypedBlockPainter buffer is full; call initBuffer(count) first"
      );
    }
    if (
      ![cx, cy, width, height, roundness, thickness, nodeScale].every(
        Number.isFinite
      )
    ) {
      throw new Error("TypedBlockPainter requires finite block geometry");
    }
    if (width <= 0 || height <= 0) return;
    const fill = this._backgroundColor;
    const border = this._borderColor;
    const attributes = [
      width,
      height,
      fill.r(),
      fill.g(),
      fill.b(),
      fill.a(),
      border.r(),
      border.g(),
      border.b(),
      border.a(),
      Math.max(0, roundness),
      Math.max(0, thickness),
      KINDS.get(kind) || 0,
      Math.max(0, nodeScale),
    ];
    let offset = this._count * FLOATS_PER_BLOCK;
    for (let vertex = 0; vertex < VERTICES_PER_BLOCK; vertex++) {
      const x = (CORNERS[vertex * 2] * width) / 2;
      const y = (CORNERS[vertex * 2 + 1] * height) / 2;
      this._data[offset] = cx + x;
      this._data[offset + 1] = cy + y;
      this._data[offset + 2] = x;
      this._data[offset + 3] = y;
      this._data.set(attributes, offset + 4);
      offset += FLOATS_PER_VERTEX;
    }
    this._count++;
    this._dirty = true;
  }

  render(worldMatrix, cssPixelsPerGroupUnit = 1) {
    if (!this._count) return;
    const gl = this._glProvider.gl();
    if (gl.isContextLost()) return;
    if (!Number.isFinite(cssPixelsPerGroupUnit) || cssPixelsPerGroupUnit <= 0)
      return;
    if (!this._program) {
      const derivatives = !!gl.getExtension("OES_standard_derivatives");
      const precision =
        gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
          ?.precision > 0
          ? "highp"
          : "mediump";
      this._program = compileSharedProgram(
        this._glProvider,
        gl,
        derivatives,
        precision
      );
      if (!this._program) return;
      this._worldLocation = gl.getUniformLocation(this._program, "u_world");
      this._scaleLocation = gl.getUniformLocation(this._program, "u_cssScale");
      this._attributes = ATTRIBUTES.map(([name, size, offset]) => [
        gl.getAttribLocation(this._program, name),
        size,
        offset,
      ]);
    }
    if (!this._buffer) {
      this._buffer = gl.createBuffer();
      if (!this._buffer)
        throw new Error("Unable to create TypedBlockPainter buffer");
      this._dirty = true;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    if (this._dirty) {
      try {
        if (this._gpuCapacity < this._capacity) {
          gl.bufferData(
            gl.ARRAY_BUFFER,
            this._data.byteLength,
            gl.DYNAMIC_DRAW
          );
          this._gpuCapacity = this._capacity;
        }
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          this._data.subarray(0, this._count * FLOATS_PER_BLOCK)
        );
        const error = gl.getError();
        if (error !== gl.NO_ERROR && error !== gl.CONTEXT_LOST_WEBGL) {
          throw new Error(
            `Unable to upload TypedBlockPainter buffer (WebGL error ${error})`
          );
        }
        this._dirty = false;
      } catch (error) {
        gl.deleteBuffer(this._buffer);
        this._buffer = null;
        this._gpuCapacity = 0;
        throw error;
      }
    }
    gl.useProgram(this._program);
    gl.uniformMatrix3fv(this._worldLocation, false, worldMatrix);
    gl.uniform1f(this._scaleLocation, cssPixelsPerGroupUnit);
    for (const [location, size, offset] of this._attributes) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(
        location,
        size,
        gl.FLOAT,
        false,
        FLOATS_PER_VERTEX * 4,
        offset * 4
      );
    }
    try {
      gl.drawArrays(gl.TRIANGLES, 0, this._count * VERTICES_PER_BLOCK);
    } finally {
      for (const [location] of this._attributes)
        gl.disableVertexAttribArray(location);
    }
  }
}
