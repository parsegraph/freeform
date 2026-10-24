import Color from "parsegraph-color";
import TypedBlockPainter from "./TypedBlockPainter";

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const FLOATS_PER_BLOCK = 18 * 6;

function makeProvider({ derivatives = true } = {}) {
  const gl = Object.fromEntries(
    [
      "VERTEX_SHADER",
      "FRAGMENT_SHADER",
      "COMPILE_STATUS",
      "LINK_STATUS",
      "ARRAY_BUFFER",
      "DYNAMIC_DRAW",
      "FLOAT",
      "TRIANGLES",
      "NO_ERROR",
      "CONTEXT_LOST_WEBGL",
      "OUT_OF_MEMORY",
    ].map((name) => [name, name])
  );
  let id = 0;
  for (const method of ["createProgram", "createShader", "createBuffer"]) {
    gl[method] = jest.fn(() => ({ id: id++ }));
  }
  for (const method of [
    "shaderSource",
    "compileShader",
    "attachShader",
    "linkProgram",
    "deleteShader",
    "deleteProgram",
    "deleteBuffer",
    "bindBuffer",
    "bufferData",
    "useProgram",
    "uniformMatrix3fv",
    "uniform1f",
    "enableVertexAttribArray",
    "vertexAttribPointer",
    "drawArrays",
    "disableVertexAttribArray",
  ])
    gl[method] = jest.fn();
  gl.uploads = [];
  gl.bufferSubData = jest.fn((target, offset, data) => {
    gl.uploads.push(Array.from(data));
  });
  gl.getError = jest.fn(() => gl.NO_ERROR);
  gl.isContextLost = jest.fn(() => false);
  gl.getExtension = jest.fn(() => (derivatives ? {} : null));
  gl.getShaderPrecisionFormat = jest.fn(() => ({ precision: 23 }));
  gl.getShaderParameter = jest.fn(() => true);
  gl.getProgramParameter = jest.fn(() => true);
  gl.getShaderInfoLog = jest.fn(() => "invalid shader");
  gl.getProgramInfoLog = jest.fn(() => "invalid program");
  gl.getUniformLocation = jest.fn((program, name) => name);
  gl.getAttribLocation = jest.fn((program, name) =>
    [
      "a_position",
      "a_local",
      "a_size",
      "a_fill",
      "a_border",
      "a_shape",
    ].indexOf(name)
  );
  const shaders = {};
  return { gl: () => gl, shaders: () => shaders };
}

function addBlock(painter, kind, x = 0) {
  painter.drawBlock(x, 0, 100, 60, 8, 2, kind, 0.75);
}

test("ordinary blocks, connectors, and all JSON contours retain order in one draw", () => {
  const provider = makeProvider();
  const gl = provider.gl();
  const painter = new TypedBlockPainter(provider);
  painter.setBackgroundColor(new Color(1, 0.5, 0.25, 0.25));
  painter.setBorderColor(new Color(0.2, 0.3, 0.4, 0.6));
  painter.initBuffer(6);
  addBlock(painter, "object", 10);
  painter.drawBlock(20, 0, 15, 2, 0, 0);
  addBlock(painter, "array", 30);
  addBlock(painter, "boolean", 40);
  addBlock(painter, undefined, 50);
  painter.drawBlock(60, 0, 8, 8, 8, 2);
  painter.render(IDENTITY, 2);

  expect(painter.glProvider()).toBe(provider);
  expect(painter.backgroundColor().a()).toBe(0.25);
  expect(gl.drawArrays).toHaveBeenCalledTimes(1);
  expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 36);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
  const data = gl.uploads[0];
  expect(
    [0, 1, 2, 3, 4, 5].map((i) => data[i * FLOATS_PER_BLOCK + 16])
  ).toEqual([1, 0, 2, 3, 0, 0]);
  expect(
    [0, 1, 2, 3, 4, 5].map((i) => {
      const base = i * FLOATS_PER_BLOCK;
      return data[base] - data[base + 2];
    })
  ).toEqual([10, 20, 30, 40, 50, 60]);
  expect(data.slice(6, 10)).toEqual([1, 0.5, 0.25, 0.25]);
  expect(data[13]).toBeCloseTo(0.6);
  expect(data[17]).toBe(0.75);
  expect(gl.vertexAttribPointer).toHaveBeenCalledTimes(6);
  expect(gl.disableVertexAttribArray).toHaveBeenCalledTimes(6);
});

test("camera zoom updates only uniforms and clear reuses the existing GPU buffer", () => {
  const provider = makeProvider();
  const gl = provider.gl();
  const painter = new TypedBlockPainter(provider);
  painter.initBuffer(2);
  addBlock(painter, "object");
  addBlock(painter, "boolean");
  painter.render(IDENTITY, 0.25);
  painter.render(IDENTITY, 3);
  expect(gl.uniform1f).toHaveBeenLastCalledWith("u_cssScale", 3);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
  expect(gl.createBuffer).toHaveBeenCalledTimes(1);

  painter.clear();
  painter.render(IDENTITY, 3);
  expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  painter.initBuffer(1);
  addBlock(painter, "array");
  painter.render(IDENTITY, 1);
  expect(gl.createBuffer).toHaveBeenCalledTimes(1);
  expect(gl.deleteBuffer).not.toHaveBeenCalled();
  expect(gl.bufferData).toHaveBeenCalledTimes(1);
  expect(gl.bufferSubData).toHaveBeenCalledTimes(2);

  painter.clear();
  painter.initBuffer(5);
  addBlock(painter, "object");
  painter.render(IDENTITY, 1);
  expect(gl.createBuffer).toHaveBeenCalledTimes(1);
  expect(gl.bufferData).toHaveBeenCalledTimes(2);
});

test.each([true, false])(
  "program is shared per provider with derivatives=%s",
  (derivatives) => {
    const provider = makeProvider({ derivatives });
    const gl = provider.gl();
    for (let i = 0; i < 2; i++) {
      const painter = new TypedBlockPainter(provider);
      painter.initBuffer(1);
      addBlock(painter, "object");
      painter.render(IDENTITY, 1);
    }
    expect(gl.createProgram).toHaveBeenCalledTimes(1);
    expect(gl.createShader).toHaveBeenCalledTimes(2);
    expect(gl.deleteShader).toHaveBeenCalledTimes(2);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    const fragment = gl.shaderSource.mock.calls[1][1];
    expect(fragment.includes("#extension GL_OES_standard_derivatives")).toBe(
      derivatives
    );
    expect(fragment.includes("fwidth(v_local)")).toBe(derivatives);
    expect(fragment).not.toContain("fwidth(outerDistance)");
  }
);

test("failed shader compilation releases its temporary shaders and program", () => {
  const provider = makeProvider();
  const gl = provider.gl();
  const painter = new TypedBlockPainter(provider);
  painter.initBuffer(1);
  addBlock(painter, "object");
  gl.getShaderParameter.mockReturnValue(false);
  expect(() => painter.render(IDENTITY, 1)).toThrow("invalid shader");
  expect(gl.deleteShader).toHaveBeenCalledTimes(1);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.createBuffer).not.toHaveBeenCalled();
  expect(Object.keys(provider.shaders())).toHaveLength(0);
});

test("WebGL 1 without highp fragment support uses matching varying precision", () => {
  const provider = makeProvider({ derivatives: false });
  const gl = provider.gl();
  gl.getShaderPrecisionFormat.mockReturnValue({ precision: 0 });
  const painter = new TypedBlockPainter(provider);
  painter.initBuffer(1);
  addBlock(painter, "object");
  painter.render(IDENTITY, 1);
  for (const [, source] of gl.shaderSource.mock.calls) {
    expect(source).toContain("varying mediump vec2 v_local;");
    expect(source).not.toContain("varying highp");
  }
});

test("failed program linking releases both shaders and does not cache the program", () => {
  const provider = makeProvider();
  const gl = provider.gl();
  gl.getProgramParameter.mockReturnValue(false);
  const painter = new TypedBlockPainter(provider);
  painter.initBuffer(1);
  addBlock(painter, "array");
  expect(() => painter.render(IDENTITY, 1)).toThrow("invalid program");
  expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.createBuffer).not.toHaveBeenCalled();
  expect(Object.keys(provider.shaders())).toHaveLength(0);
});

test("upload failure releases its buffer and can retry without losing block data", () => {
  const provider = makeProvider();
  const gl = provider.gl();
  const painter = new TypedBlockPainter(provider);
  painter.initBuffer(1);
  addBlock(painter, "boolean");
  gl.bufferSubData.mockImplementationOnce(() => {
    throw new Error("out of memory");
  });
  expect(() => painter.render(IDENTITY, 1)).toThrow("out of memory");
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
  expect(gl.drawArrays).not.toHaveBeenCalled();
  painter.render(IDENTITY, 1);
  expect(gl.createBuffer).toHaveBeenCalledTimes(2);
  expect(gl.drawArrays).toHaveBeenCalledTimes(1);
  expect(gl.uploads[0][16]).toBe(3);
});

test("empty batches and lost contexts do not allocate or draw", () => {
  const provider = makeProvider();
  const gl = provider.gl();
  const painter = new TypedBlockPainter(provider);
  painter.initBuffer(0);
  painter.render(IDENTITY, 1);
  painter.initBuffer(1);
  addBlock(painter, "array");
  gl.isContextLost.mockReturnValue(true);
  painter.render(IDENTITY, 1);
  expect(gl.createProgram).not.toHaveBeenCalled();
  expect(gl.createBuffer).not.toHaveBeenCalled();
  expect(gl.drawArrays).not.toHaveBeenCalled();
});
