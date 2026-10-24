import { WorldLabels } from "./WorldLabel";

const originalWorker = global.Worker;
let worker;
let ctx;

beforeEach(() => {
  worker = { postMessage: jest.fn(), onmessage: null };
  global.Worker = jest.fn(() => worker);
  ctx = {
    measureText: jest.fn(() => ({
      width: 24,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    })),
    strokeText: jest.fn(),
    fillText: jest.fn(),
  };
});

afterEach(() => {
  global.Worker = originalWorker;
});

function prepare(labels, onFinish) {
  const cancel = labels.prepareRender(ctx, 0, 0, 800, 600, 1, onFinish);
  const key = worker.postMessage.mock.calls.at(-1)[0][6];
  return {
    cancel,
    respond: (indices = [0]) => worker.onmessage({ data: { key, labels: indices } }),
  };
}

function render(labels) {
  labels.render(ctx, { luminance: () => 1 });
}

test("cancelling a label request ignores its late worker response", () => {
  const labels = new WorldLabels(1);
  labels.draw("cancelled", 0, 0, 12);
  const onFinish = jest.fn();
  const request = prepare(labels, onFinish);

  request.cancel();
  request.respond();
  render(labels);

  expect(onFinish).not.toHaveBeenCalled();
  expect(ctx.fillText).not.toHaveBeenCalled();
});

test("a superseded response and its cancellation cannot affect a newer request", () => {
  const labels = new WorldLabels(1);
  labels.draw("first", 0, 0, 12);
  const oldFinish = jest.fn();
  const oldRequest = prepare(labels, oldFinish);
  labels.draw("second", 10, 20, 12);
  const newFinish = jest.fn();
  const newRequest = prepare(labels, newFinish);

  oldRequest.respond();
  oldRequest.cancel();
  newRequest.respond([1]);
  render(labels);

  expect(oldFinish).not.toHaveBeenCalled();
  expect(newFinish).toHaveBeenCalledTimes(1);
  expect(ctx.fillText).toHaveBeenCalledTimes(1);
  expect(ctx.fillText).toHaveBeenCalledWith("second", 10, 20);
});

test("worker completion is one-shot even when it synchronously starts another request", () => {
  const labels = new WorldLabels(1);
  labels.draw("label", 0, 0, 12);
  const nextFinish = jest.fn();
  let nextRequest;
  const onFinish = jest.fn(() => { nextRequest = prepare(labels, nextFinish); });
  const request = prepare(labels, onFinish);

  request.respond();
  request.respond();
  request.cancel();
  nextRequest.respond();
  nextRequest.respond();

  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(nextFinish).toHaveBeenCalledTimes(1);
});

test("clearing labels discards completed labels and invalidates pending work", () => {
  const labels = new WorldLabels(1);
  labels.draw("old", 0, 0, 12);
  prepare(labels, jest.fn()).respond();
  render(labels);
  expect(ctx.fillText).toHaveBeenCalledTimes(1);
  ctx.fillText.mockClear();
  const onFinish = jest.fn();
  const pending = prepare(labels, onFinish);

  labels.clear();
  pending.respond();
  render(labels);

  expect(labels.labels()).toEqual([]);
  expect(ctx.fillText).not.toHaveBeenCalled();
  expect(onFinish).not.toHaveBeenCalled();
});
