import Camera from "parsegraph-camera";
import ViewportFrameBuffer, {
  viewportFrameTransform,
} from "./ViewportFrameBuffer";

function mockGL() {
  const constants = [
    "VERTEX_SHADER",
    "FRAGMENT_SHADER",
    "COMPILE_STATUS",
    "LINK_STATUS",
    "ARRAY_BUFFER",
    "STATIC_DRAW",
    "TEXTURE0",
    "TEXTURE_2D",
    "TEXTURE_MIN_FILTER",
    "TEXTURE_MAG_FILTER",
    "LINEAR",
    "TEXTURE_WRAP_S",
    "TEXTURE_WRAP_T",
    "CLAMP_TO_EDGE",
    "RGBA",
    "UNSIGNED_BYTE",
    "FRAMEBUFFER",
    "COLOR_ATTACHMENT0",
    "FRAMEBUFFER_COMPLETE",
    "MAX_TEXTURE_SIZE",
    "MAX_VIEWPORT_DIMS",
    "NO_ERROR",
    "OUT_OF_MEMORY",
    "INVALID_OPERATION",
    "BLEND",
    "FUNC_ADD",
    "SRC_ALPHA",
    "ONE_MINUS_SRC_ALPHA",
    "ONE",
    "DEPTH_TEST",
    "CULL_FACE",
    "SCISSOR_TEST",
    "COLOR_BUFFER_BIT",
    "FLOAT",
    "TRIANGLE_STRIP",
  ];
  const gl = Object.fromEntries(constants.map((name) => [name, name]));
  Object.assign(gl, {
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    blits: [],
  });
  let id = 0;
  let boundFramebuffer = null;
  let boundTexture = null;
  let blending = false;
  for (const method of [
    "createShader",
    "createProgram",
    "createBuffer",
    "createTexture",
    "createFramebuffer",
  ]) {
    gl[method] = jest.fn(() => ({ id: ++id }));
  }
  for (const method of [
    "shaderSource",
    "compileShader",
    "attachShader",
    "linkProgram",
    "bindBuffer",
    "bufferData",
    "deleteShader",
    "deleteProgram",
    "deleteBuffer",
    "deleteTexture",
    "deleteFramebuffer",
    "activeTexture",
    "texParameteri",
    "texImage2D",
    "blendEquation",
    "blendFuncSeparate",
    "viewport",
    "colorMask",
    "clearColor",
    "useProgram",
    "enableVertexAttribArray",
    "vertexAttribPointer",
    "uniform2f",
    "uniform1f",
    "uniform1i",
    "disableVertexAttribArray",
  ])
    gl[method] = jest.fn();
  gl.getShaderParameter = jest.fn(() => true);
  gl.getProgramParameter = jest.fn(() => true);
  gl.getShaderInfoLog = jest.fn(() => "shader error");
  gl.getProgramInfoLog = jest.fn(() => "link error");
  gl.getAttribLocation = jest.fn(() => 2);
  gl.getUniformLocation = jest.fn((program, name) => name);
  gl.getParameter = jest.fn((parameter) =>
    parameter === gl.MAX_TEXTURE_SIZE ? 4096 : [4096, 4096]
  );
  gl.checkFramebufferStatus = jest.fn(() => gl.FRAMEBUFFER_COMPLETE);
  gl.getError = jest.fn(() => gl.NO_ERROR);
  gl.bindFramebuffer = jest.fn((target, framebuffer) => {
    boundFramebuffer = framebuffer;
  });
  gl.bindTexture = jest.fn((target, texture) => {
    boundTexture = texture;
  });
  gl.framebufferTexture2D = jest.fn(
    (target, attachment, textureTarget, texture) => {
      boundFramebuffer.texture = texture;
    }
  );
  gl.enable = jest.fn((flag) => {
    if (flag === gl.BLEND) blending = true;
  });
  gl.disable = jest.fn((flag) => {
    if (flag === gl.BLEND) blending = false;
  });
  gl.clear = jest.fn(() => {
    if (boundFramebuffer) boundFramebuffer.texture.content = "empty";
    else gl.screen = "empty";
  });
  gl.drawArrays = jest.fn(() => {
    gl.blits.push({
      framebuffer: boundFramebuffer,
      texture: boundTexture,
      blending,
    });
    gl.screen = boundTexture.content;
  });
  gl.paint = (content) => {
    boundFramebuffer.texture.content = content;
  };
  return gl;
}

const pose = { x: 20, y: -30, scale: 2 };

test("the image transform follows actual camera projection for pan and zoom", () => {
  const captured = new Camera();
  captured.setSize(800, 600);
  captured.setOrigin(30, -15);
  captured.setScale(0.5);
  const live = new Camera();
  live.setSize(800, 600);
  live.setOrigin(-80, 75);
  live.setScale(3);
  const pixel = (camera, [x, y]) => {
    const m = camera.project();
    return [
      (m[0] * x + m[3] * y + m[6] + 1) * 400,
      (1 - (m[1] * x + m[4] * y + m[7])) * 300,
    ];
  };
  const transform = viewportFrameTransform(live, captured);
  for (const world of [
    [0, 0],
    [-100, 20],
    [300, -80],
  ]) {
    const from = pixel(captured, world);
    const to = pixel(live, world);
    expect(from[0] * transform.scale + transform.x).toBeCloseTo(to[0]);
    expect(from[1] * transform.scale + transform.y).toBeCloseTo(to[1]);
  }
  expect(viewportFrameTransform(pose, pose)).toEqual({ x: 0, y: 0, scale: 1 });
});

test("only published frames reach the screen while unfinished work survives repeated presentation", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  gl.paint("first complete frame");
  expect(buffer.present(pose, pose)).toBe(false);
  expect(gl.screen).toBe("empty");
  expect(gl.drawArrays).not.toHaveBeenCalled();
  buffer.publish();
  expect(buffer.hasFront()).toBe(true);
  expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
  buffer.present(pose, pose);
  expect(gl.screen).toBe("first complete frame");

  buffer.begin(800, 600);
  gl.paint("unfinished second frame");
  for (let i = 0; i < 3; ++i) {
    buffer.present({ ...pose, x: pose.x + i }, pose);
    expect(gl.screen).toBe("first complete frame");
  }
  buffer.drawTarget();
  gl.paint("second complete frame");
  buffer.publish();
  buffer.present(pose, pose);
  expect(gl.screen).toBe("second complete frame");
  expect(gl.createTexture).toHaveBeenCalledTimes(2);
  expect(gl.blits.every(({ framebuffer }) => framebuffer === null)).toBe(true);
  const firstTexture = gl.blits[0].texture;
  expect(
    gl.blits.slice(0, 4).every(({ texture }) => texture === firstTexture)
  ).toBe(true);
  expect(gl.blits[4].texture).not.toBe(firstTexture);
});

test("graph targets use four samples per logical pixel while presentation keeps camera coordinates", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  expect(gl.texImage2D.mock.calls.map((args) => args.slice(3, 5))).toEqual([
    [1600, 1200], [1600, 1200],
  ]);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 1600, 1200);
  expect(gl.texParameteri).toHaveBeenCalledWith(
    gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR
  );
  buffer.publish();
  buffer.present({ x: 25, y: -20, scale: 4 }, pose);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 800, 600);
  expect(gl.uniform2f).toHaveBeenCalledWith("u_size", 800, 600);
  expect(gl.uniform2f).toHaveBeenCalledWith("u_offset", 20, 40);
  expect(gl.uniform1f).toHaveBeenCalledWith("u_scale", 2);
  buffer.begin(800, 600);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 1600, 1200);
  expect(gl.createTexture).toHaveBeenCalledTimes(2);
  expect(gl.getParameter).toHaveBeenCalledTimes(2);
});

test("presentation preserves premultiplied alpha and restores drawing blend/target state", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  buffer.publish();
  buffer.begin(800, 600);
  const back = gl.bindFramebuffer.mock.calls.at(-1)[1];
  buffer.present({ x: 25, y: -20, scale: 4 }, pose);
  expect(gl.blits[0].blending).toBe(false);
  expect(gl.uniform2f).toHaveBeenCalledWith("u_offset", 20, 40);
  expect(gl.uniform1f).toHaveBeenCalledWith("u_scale", 2);
  expect(gl.uniform2f).toHaveBeenCalledWith("u_size", 800, 600);
  expect(gl.disableVertexAttribArray).toHaveBeenLastCalledWith(2);
  expect(gl.blendFuncSeparate).toHaveBeenLastCalledWith(
    gl.SRC_ALPHA,
    gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE,
    gl.ONE_MINUS_SRC_ALPHA
  );
  buffer.drawTarget();
  expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, back);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 1600, 1200);
  expect(gl.clear).toHaveBeenCalledTimes(3); // begin, begin, present; never drawTarget
});

test("resize drops the old front and replaces both targets exactly once", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  buffer.publish();
  buffer.begin(1000, 700);
  expect(buffer.hasFront()).toBe(false);
  buffer.present(pose, pose);
  expect(gl.drawArrays).not.toHaveBeenCalled();
  expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
  expect(gl.createTexture).toHaveBeenCalledTimes(4);
  buffer.begin(1000, 700);
  expect(gl.createTexture).toHaveBeenCalledTimes(4);
  expect(gl.texImage2D.mock.calls.map((args) => args.slice(3, 5))).toEqual([
    [1600, 1200], [1600, 1200], [2000, 1400], [2000, 1400],
  ]);
  expect(gl.getParameter).toHaveBeenCalledTimes(2);
});

test.each([
  ["texture width", 1200, [4096, 4096], 800, 500],
  ["texture height", 1200, [4096, 4096], 500, 800],
  ["viewport width", 4096, [1200, 4096], 800, 500],
  ["viewport height", 4096, [4096, 1200], 500, 800],
  ["target pixel budget", 8192, [8192, 8192], 2000, 1100],
])("%s limit falls back to native samples without attempting excess allocation", (
  description, textureLimit, viewportLimit, width, height
) => {
  const gl = mockGL();
  gl.getParameter.mockImplementation((parameter) =>
    parameter === gl.MAX_TEXTURE_SIZE ? textureLimit : viewportLimit
  );
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(width, height);
  expect(gl.texImage2D.mock.calls.map((args) => args.slice(3, 5))).toEqual([
    [width, height], [width, height],
  ]);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, width, height);
  buffer.publish();
  expect(buffer.present(pose, pose)).toBe(true);
  expect(gl.createTexture).toHaveBeenCalledTimes(2);
});

test("sample storage exactly at the pixel budget still gets supersampling", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(2048, 1024);
  expect(gl.texImage2D.mock.calls.map((args) => args.slice(3, 5))).toEqual([
    [4096, 2048], [4096, 2048],
  ]);
});

test("failed supersample allocation releases both targets and remembers native fallback by size", () => {
  const gl = mockGL();
  gl.checkFramebufferStatus
    .mockReturnValueOnce(gl.FRAMEBUFFER_COMPLETE)
    .mockReturnValueOnce(0);
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  expect(gl.texImage2D.mock.calls.map((args) => args.slice(3, 5))).toEqual([
    [1600, 1200], [1600, 1200], [800, 600], [800, 600],
  ]);
  const textures = gl.createTexture.mock.results.map(({ value }) => value);
  const framebuffers = gl.createFramebuffer.mock.results.map(({ value }) => value);
  expect(gl.deleteTexture.mock.calls).toEqual([[textures[1]], [textures[0]]]);
  expect(gl.deleteFramebuffer.mock.calls).toEqual([[framebuffers[1]], [framebuffers[0]]]);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 800, 600);
  gl.paint("complete fallback frame");
  buffer.publish();
  buffer.present(pose, pose);
  expect(gl.screen).toBe("complete fallback frame");
  buffer.begin(800, 600);
  expect(gl.createTexture).toHaveBeenCalledTimes(4);
  // Resizing away and back must not repeatedly try the failed allocation.
  buffer.begin(900, 600);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 1800, 1200);
  buffer.begin(800, 600);
  expect(gl.texImage2D.mock.calls.slice(-2).map((args) => args.slice(3, 5))).toEqual([
    [800, 600], [800, 600],
  ]);
  expect(gl.getParameter).toHaveBeenCalledTimes(2);
  buffer.contextLost();
  buffer.begin(800, 600);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 1600, 1200);
  expect(gl.getParameter).toHaveBeenCalledTimes(4);
});

test("a thrown supersample allocation error also retries at native resolution", () => {
  const gl = mockGL();
  gl.texImage2D.mockImplementationOnce(() => { throw new Error("Out of memory"); });
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  expect(gl.texImage2D.mock.calls.map((args) => args.slice(3, 5))).toEqual([
    [1600, 1200], [800, 600], [800, 600],
  ]);
  expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 800, 600);
});

test("allocation recovery drains sticky GL errors before retrying or drawing graph content", () => {
  const gl = mockGL();
  const pendingErrors = [gl.OUT_OF_MEMORY, gl.INVALID_OPERATION];
  gl.checkFramebufferStatus.mockReturnValueOnce(0);
  gl.getError.mockImplementation(() => pendingErrors.shift() ?? gl.NO_ERROR);
  gl.texImage2D
    .mockImplementationOnce(() => {})
    .mockImplementation(() => {
      // Native allocation and later painter error checks must see clean GL state.
      expect(pendingErrors).toEqual([]);
    });
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  expect(gl.getError).toHaveBeenCalledTimes(3);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  expect(gl.viewport).toHaveBeenLastCalledWith(0, 0, 800, 600);
  buffer.begin(800, 600);
  // Ordinary frames and presentation never add a synchronous GL error query.
  buffer.publish();
  buffer.present(pose, pose);
  expect(gl.getError).toHaveBeenCalledTimes(4);
});

test("discard prevents stale or partial frames from being published", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  buffer.publish();
  buffer.begin(800, 600);
  buffer.discard();
  expect(buffer.hasFront()).toBe(false);
  expect(buffer.present(pose, pose)).toBe(false);
  expect(() => buffer.drawTarget()).toThrow("No viewport frame");
  expect(() => buffer.publish()).toThrow("unstarted");
  buffer.begin(800, 600);
  buffer.publish();
  expect(buffer.hasFront()).toBe(true);
  expect(gl.createTexture).toHaveBeenCalledTimes(2);
});

test("unsupported dimensions and incomplete allocations fail without presenting partial content", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  expect(() => buffer.begin(5000, 600)).toThrow(
    "Unsupported viewport buffer dimensions"
  );
  expect(gl.createTexture).not.toHaveBeenCalled();
  gl.checkFramebufferStatus.mockReturnValue(0);
  expect(() => buffer.begin(800, 600)).toThrow(
    "Cannot create complete viewport frame buffer"
  );
  expect(buffer.hasFront()).toBe(false);
  expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
  expect(gl.drawArrays).not.toHaveBeenCalled();
  expect(gl.bindFramebuffer).toHaveBeenLastCalledWith(gl.FRAMEBUFFER, null);
});

test.each([[0, 600], [800, 0], [-1, 600], [800.5, 600], [NaN, 600], [Infinity, 600]])(
  "invalid logical size %s × %s is rejected rather than being downscaled",
  (width, height) => {
    const gl = mockGL();
    const buffer = new ViewportFrameBuffer(gl);
    expect(() => buffer.begin(width, height)).toThrow("Unsupported viewport buffer dimensions");
    expect(gl.createTexture).not.toHaveBeenCalled();
  }
);

test("context restoration recreates resources and disposal releases each live resource once", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  buffer.begin(800, 600);
  buffer.publish();
  buffer.contextLost();
  expect(buffer.hasFront()).toBe(false);
  expect(gl.deleteTexture).not.toHaveBeenCalled();
  expect(gl.deleteProgram).not.toHaveBeenCalled();
  buffer.begin(800, 600);
  expect(gl.createTexture).toHaveBeenCalledTimes(4);
  expect(gl.createProgram).toHaveBeenCalledTimes(2);
  expect(gl.getParameter).toHaveBeenCalledTimes(4);
  buffer.dispose();
  buffer.dispose();
  expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
  expect(() => buffer.begin(800, 600)).toThrow("disposed");
});

test("shader failures release temporary resources and can be retried", () => {
  const gl = mockGL();
  const buffer = new ViewportFrameBuffer(gl);
  gl.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false);
  expect(() => buffer.begin(800, 600)).toThrow("shader error");
  expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  expect(gl.createProgram).not.toHaveBeenCalled();
  gl.getProgramParameter.mockReturnValueOnce(false);
  expect(() => buffer.begin(800, 600)).toThrow("link error");
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.createTexture).not.toHaveBeenCalled();
  buffer.begin(800, 600);
  expect(gl.createTexture).toHaveBeenCalledTimes(2);
});
