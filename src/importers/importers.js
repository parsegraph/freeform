import { DirectionCaret, DirectionNode, Direction } from "parsegraph";
import { tokenize } from "parsegraph-anthonylisp";
import * as ts from 'typescript';

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

function graphLispTokens(tokens, given) {
  let token = tokens.shift();
  if (token.val === "(") {
    const car = new DirectionCaret();
    car.spawnMove("i");
    car.shrink();
    car.crease();
    let newLined = false;
    car.push();
    let first = true;
    while (tokens.length > 1 && tokens[0].val !== ")") {
      if (tokens[0].val === "\n") {
        tokens.shift();
        newLined = true;
        continue;
      }
      const child = graphLispTokens(tokens, first ? car.node() : null);
      first = false;
      if (newLined) {
        car.pop();
        car.spawnMove("d");
        car.push();
        car.connectMove("f", child);
        newLined = false;
      } else if (child !== car.node()) {
        car.connectMove("f", child);
      }
    }
    tokens.shift();
    //car.connectMove('f', new DirectionNode(endToken.val));
    return car.root();
  } else if (given) {
    given.setValue(token.val);
    return given;
  }
  return new DirectionNode(token.val);
}

function graphJavascript(input) {
  let moduleEx;
  try {
    return graphJson(require('esprima').parseModule(input, { tolerant: true, jsx: true}));
  } catch (ex) {
    moduleEx = ex;
  }
  try {
    return graphJson(require('esprima').parseScript(input, { tolerant: true, jsx: true}));
  } catch (ex) {
    const car = new DirectionCaret("Failed to parse JavaScript");
    if (ex?.toString() !== moduleEx?.toString()) {
      car.spawnMove('d', 'Exception while parsing as script');
      car.spawn('i', ex?.toString());
      car.spawnMove('d', 'Exception while parsing as module');
      car.spawn('i', moduleEx?.toString());
    } else {
      car.spawn('i', JSON.stringify(ex), 'v');
    }
    return car.root();
  }
}

function getTypescriptNodeValue(node, sourceFile) {
  let name = "";

  // This is an incomplete set of AST nodes which could have a top level identifier
  // it's left to you to expand this list, which you can do by using
  // https://ts-ast-viewer.com/ to see the AST of a file then use the same patterns
  // as below
  if (ts.isFunctionDeclaration(node)) {
    name = node.name.text;
    // Hide the method body when printing
    node.body = undefined;
  } else if (ts.isVariableStatement(node)) {
    name = node.declarationList.declarations[0].name.getText(sourceFile);
  } else if (ts.isInterfaceDeclaration(node)){
    name = node.name.text
  }

  return name;
}

function graphTypescriptNode(root, sourceFile) {
  const car = new DirectionCaret(getTypescriptNodeValue(root, sourceFile));

  ts.forEachChild(root, node => {
      car.spawnMove('d');
      car.push();
      car.connect('f', graphTypescriptNode(node, sourceFile));
      car.pop();
  });
  return car.root();
};

function graphTypescript(input) {
  try {
    const sourceFile = ts.createSourceFile(
      "input",
      input,
      ts.ScriptTarget.Latest,
      false
    );
    const car = new DirectionCaret();
    sourceFile.statements.forEach(stmt => {
      car.spawnMove('d');
      car.connect('f', graphTypescriptNode(stmt, sourceFile));
    });
    return car.root();
  } catch (ex) {
    const car = new DirectionCaret("Failed to parse Typescript");
    car.spawnMove('i', ex?.toString(), 'v');
    car.spawnMove('d', JSON.stringify(ex));
    return car.root();
  }
}

function graphLisp(input) {
  const tokens = tokenize(input);
  while (tokens.length > 0 && tokens[0].val === "\n") {
    tokens.shift();
  }
  let node = graphLispTokens(tokens);
  const root = node;
  while (tokens.length > 0) {
    const child = new DirectionNode();
    const rv = graphLispTokens(tokens, child);
    if (child === rv) {
      node.connect(Direction.DOWNWARD, child);
    } else {
      child.connect(Direction.FORWARD, rv);
      node.connect(Direction.DOWNWARD, child);
    }
    node = child;
    while (tokens.length > 0 && tokens[0].val === "\n") {
      tokens.shift();
    }
  }
  return root;
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

export { graphLines, graphJpeg, graphWords, graphLisp, graphJson, graphPng, graphJavascript, graphTypescript };