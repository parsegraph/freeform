import { DirectionCaret, DirectionNode, Direction } from "parsegraph";
import { createStructuredLisp } from "../structuredLisp";

function graphLines(input) {
  const car = new DirectionCaret();

  input.split(/(\r\n|\n|\r)/g).forEach((line) => {
    car.spawn("f", line);
    car.spawnMove("d");
  });

  return car.root();
}

function graphWords(input) {
  const car = new DirectionCaret();

  input.split(/(\r\n|\n|\r)/g).forEach((line) => {
    car.push();
    line.split(/\s/g).forEach((word) => {
      car.spawnMove("f", word);
    });
    car.pop();
    car.spawnMove("d");
  });

  return car.root();
}

function graphJsonObject(data) {
  const car = new DirectionCaret();
  car.spawnMove("i");
  car.crease();
  let hasKeys = false;
  Object.keys(data).forEach((key) => {
    hasKeys = true;
    const value = data[key];
    car.connect("b", graphJson(key));
    car.connect("f", graphJson(value));
    car.spawnMove("d");
  });
  if (!hasKeys) {
    car.spawn("b");
    car.spawn("f");
  }
  return car.root();
}

function graphJsonArray(data) {
  const car = new DirectionCaret();
  data.forEach((elem, index) => {
    car.connectMove(index === 0 ? "i" : "f", graphJson(elem));
    if (index === 0) {
      car.crease();
    }
  });
  return car.root();
}

function graphJson(data) {
  switch (typeof data) {
    case "object":
      if (data === null) {
        return new DirectionNode("null");
      }
      if (Array.isArray(data)) {
        return graphJsonArray(data);
      }
      return graphJsonObject(data);
    case "string":
    case "number":
    case "boolean":
      return new DirectionNode(JSON.stringify(data));
    default:
      return new DirectionNode(typeof data);
  }
}

function graphLisp(input) {
  return createStructuredLisp(input);
}

const extractPngChunks = require("png-chunks-extract");

function readString(data) {
  return String.fromCharCode(...data);
}

const Buffer = require("buffer/").Buffer;

function graphPng(input) {
  const mapData = (name, data) => {
    if (name.toLowerCase() === "exif") {
      try {
        return require("exif-reader")(Buffer.from(data.buffer));
      } catch (ex) {
        return ex.toString() + " " + readString(data);
      }
    }
    return data.length < 200
      ? readString(data)
      : data.toString().substring(0, 50);
  };
  try {
    return graphJson(
      extractPngChunks(input).map((chunk) => ({
        name: chunk.name,
        length: chunk.data.length,
        data: mapData(chunk.name, chunk.data),
      }))
    );
  } catch (ex) {
    return new DirectionNode(ex.toString());
  }
}

function graphJpeg(input) {
  try {
    console.log(input);
    return graphJson(require("exif-parser").create(input).parse());
  } catch (ex) {
    return new DirectionNode(ex.toString());
  }
}

export { graphLines, graphJpeg, graphWords, graphLisp, graphJson, graphPng };
