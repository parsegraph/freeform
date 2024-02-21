import { useEffect, useRef, useState } from 'react';
import './App.css';

import { 
  serializeParsegraph,
  deserializeParsegraph,
  Direction,
  DirectionNode,
  CommitLayout,
  paintNodeBounds,
  paintNodeLines,
  Alignment,
  DirectionCaret,
  Axis,
  nameDirection,
  reverseDirection,
  getDirectionAxis,
} from "parsegraph";
import Color from 'parsegraph-color';
import { BasicGLProvider } from 'parsegraph-compileprogram';
import { WebGLBlockPainter } from 'parsegraph-blockpainter';
import Camera from 'parsegraph-camera';
import {
  makeTranslation3x3,
  matrixMultiply3x3,
  makeScale3x3
} from 'parsegraph-matrix';
import { tokenize } from 'parsegraph-anthonylisp';

const fontSize = 24;
const borderThickness = 3;
const borderRoundedness = 5;
const maxClickDelay = 1000;
const borderColor = new Color(0.7, 0.7, 0.7, 1);

const buildGraph = () => {
  try {
    const graphData = localStorage.getItem("parsegraph-graph");
    if (graphData) {
      return deserializeParsegraph(JSON.parse(graphData));
    }
  } catch (ex) {
    console.log(ex);
  }
  const widget = new DirectionNode();
  return widget;
};

const nodeHasValue = (node) => typeof node.value() === "string" || typeof node.value() === "number";

const nextAlignment = (alignment, childDir) => {
  if (getDirectionAxis(childDir) === Axis.Z) {
    if (alignment === Alignment.INWARD_VERTICAL) {
      return Alignment.INWARD_HORIZONTAL;
    }
    return Alignment.INWARD_VERTICAL;
  }
  switch (alignment) {
    case Alignment.NEGATIVE:
      return Alignment.CENTER;
    case Alignment.CENTER:
      return Alignment.POSITIVE;
    case Alignment.POSITIVE:
      return Alignment.NONE;
    default:
      return Alignment.NEGATIVE;
  }
};

function download(filename, text) {
  var element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);

  element.style.display = 'none';
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}

function graphLines(input) {
  const car = new DirectionCaret();

  input.split(/(\r\n|\n|\r)/g).forEach(line => {
    car.spawn('f', line)
    car.spawnMove('d');
  });

  return car.root();
}

function graphJsonObject(data) {
  const car = new DirectionCaret();
  car.spawnMove('i')
  let hasKeys = false;
  Object.keys(data).forEach(key => {
    hasKeys = true;
    const value = data[key];
    car.connect('b', graphJson(key));
    car.connect('f', graphJson(value));
    car.spawnMove('d');
  });
  if (!hasKeys) {
    car.spawn('b');
    car.spawn('f');
  }
  return car.root();
}

function graphJsonArray(data) {
  const car = new DirectionCaret();
  data.forEach((elem, index) => {
    car.connectMove(index === 0 ? 'i' : 'f', graphJson(elem));
  })
  return car.root();
}

function graphJson(data) {
  switch(typeof data) {
    case "object":
      if (data === null) {
        return new DirectionNode("null");
      }
      if (Array.isArray(data)) {
        return graphJsonArray(data);
      }
      return graphJsonObject(data);
      break;
      case "string":
      case "number":
      case "boolean":
        return new DirectionNode(JSON.stringify(data));
      default:
        throw new Error("Unsupported type: " + typeof data)
  }
}

function exportGraphToLines(root) {

};

function exportGraphToJson(root) {
  if (root.neighbors().hasNode(Direction.INWARD)) {
    let inner = root.neighbors().nodeAt(Direction.INWARD);
    if (inner.neighbors().hasNode(Direction.BACKWARD)) {
      // Object
      const obj = {};
      while (inner) {
        if (inner.neighbors().nodeAt(Direction.BACKWARD) && inner.neighbors().nodeAt(Direction.FORWARD)) {
          obj[exportGraphToJson(inner.neighbors().nodeAt(Direction.BACKWARD))] = exportGraphToJson(
            inner.neighbors().nodeAt(Direction.FORWARD)
          )
        }
        inner = inner.neighbors().nodeAt(Direction.DOWNWARD);
      }
      return obj;
    } else {
      // Array
      const arr = [];
      while (inner) {
        arr.push(exportGraphToJson(inner));
        inner = inner.neighbors().nodeAt(Direction.FORWARD);
      }
      return arr;
    }
  } else if (root.value() !== undefined) {
    return JSON.parse(root.value());
  }
  throw new Error("Unhandled empty node");
};

function ExportModal({onClose, graph}) {
  const [exportType, setExportType] = useState("parsegraph");

  const performExport = ()=> {
    switch(exportType) {
      case "json":
        download("parsegraph.json", JSON.stringify(exportGraphToJson(graph)));
        break;
      case "parsegraph":
        download("graph.parsegraph", serializeParsegraph(graph));
        break;
      case "lines":
        download("graph.txt", exportGraphToLines(graph));
        break;
      default:
        throw new Error("Unsupported export type: " + exportType)
    }
    onClose();
  };

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px'}}>
    <select value={exportType} onChange={e=>setExportType(e.target.value)}>
      <option value="words">Words</option>
      <option value="parsegraph">Parsegraph</option>
      <option value="lines">Lines</option>
      <option value="lisp">Lisp</option>
      <option value="json">JSON</option>
    </select>
      <button onClick={performExport}>Export</button>
  </div>
};

function graphLispTokens(tokens, given) {
  let token = tokens.shift();
  console.log("Token.val", token.val);
  if (token.val === "(") {
    const car = new DirectionCaret();
    car.spawnMove('i');
    car.shrink();
    let newLined = false;
    car.push();
    let first = true;
    while (tokens.length > 1 && tokens[0].val !== ")") {
      if (tokens[0].val === "\n") {
        tokens.shift();
        newLined = true;
        continue;
      }
      const child = graphLispTokens(tokens, first ? car.node() : null)
      first = false;
      if (newLined) {
        car.pop();
        car.spawnMove('d');
        car.push();
        car.connectMove('f', child);
        newLined = false;
      } else if (child !== car.node()) {
        car.connectMove('f', child);
      }
    }
    tokens.shift();
    //car.connectMove('f', new DirectionNode(endToken.val));
    return car.root();
  } else if (given) {
    given.setValue(token.val);
    return given;
  }
  return new DirectionNode(token.val)
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

function ImportModal({onClose, openGraph}) {
  const [importData, setImportData] = useState(null);
  const [importType, setImportType] = useState("words");

  const performImport = ()=> {
    switch(importType) {
      case "lisp":
        openGraph(graphLisp(importData));
        break;
      case "json":
        openGraph(graphJson(JSON.parse(importData)));
        break;
      case "parsegraph":
        openGraph(deserializeParsegraph(JSON.parse(importData)));
        break;
      case "lines":
        openGraph(graphLines(importData));
        break;
      default:
        throw new Error("Unsupported import type: " + importType)
    }
    onClose();
  };

  return <div style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch', flexDirection: 'column', alignItems: 'stretch', gap: '3px'}}>
    <label>File to import: <input type="file" onChange={e=>{
      for (const file of e.target.files) {
        file.text().then(content=>{
          setImportData(content);
        });
      }
    }}/>
    </label>
    <select value={importType} onChange={e=>setImportType(e.target.value)}>
      <option value="words">Words</option>
      <option value="parsegraph">Parsegraph</option>
      <option value="lines">Lines</option>
      <option value="lisp">Lisp</option>
      <option value="json">JSON</option>
    </select>
      <button onClick={performImport}>Import</button>
  </div>
}

function App() {
  const canvasRef = useRef();

  const [widget, setWidget] = useState(buildGraph());

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
      return;
    }
    if (!widget) {
      return;
    }

    // Remove all prior children.
    while (canvasRef.current.firstChild) {
      canvasRef.current.firstChild.remove();
    }

    // Create and restore the camera if possible
    const cam = new Camera();
    try {
      const camData = localStorage.getItem("parsegraph-camera");
      if (camData) {
        cam.restore(JSON.parse(camData))
      }
    } catch (ex) {
      console.log(ex);
    }

    // Input event callbacks
    let isDown = null;
    const canvas = canvasRef.current;
    canvas.tabIndex = '0';
    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.addEventListener('drop', drop)
    let [mouseX, mouseY] = [NaN, NaN];
    let userCaret = new DirectionCaret(widget);
    const spawnMove = (dir) => {
      if (userCaret.node().neighbors().hasNode(dir)) {
        userCaret.move(dir);
        refresh();
      } else {
        userCaret.spawnMove(dir);
        refresh();
      }
    };

    const refresh = () => {
      requestAnimationFrame(() => {
        paint();
      });
    };

    let showEditor = false;
    const toggleEditor = () => {
      showEditor = !showEditor;
      if (showEditor) {
        editor.style.display = 'block';
        editor.focus();
        if (nodeHasValue(userCaret.node())) {
          editor.value = userCaret.node().value();
        } else {
          editor.value = '';
        }
      } else {
        editor.style.display = 'none';
      }
    };

    canvas.addEventListener('mousedown', e => {
      isDown = Date.now();
      [mouseX, mouseY] = [e.clientX, e.clientY];
      refresh();
    });
    canvas.addEventListener('mouseup', e => {
      if (!isNaN(isDown) && Date.now() - isDown < maxClickDelay) {
        const size = [0, 0];
        const [worldX, worldY] = cam.transform(mouseX, mouseY);
        let selectedNode = widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
        if (selectedNode === userCaret.node()) {
          showEditor = false;
          toggleEditor();
        } else if (selectedNode) {
          console.log(selectedNode);
          userCaret.moveTo(selectedNode);
          refresh();
        }
      }
      isDown = null;
      [mouseX, mouseY] = [NaN, NaN];
      refresh();
    });
    canvas.addEventListener('mousemove', e => {
      const dx = e.clientX - mouseX;
      const dy = e.clientY - mouseY;
      if (isDown) {
        cam.adjustOrigin(dx / cam.scale(), dy / cam.scale());
        refresh();
      }
      [mouseX, mouseY] = [e.clientX, e.clientY];
    });

    let touchingNode = true;
    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        [mouseX, mouseY] = [touch.clientX, touch.clientY];
        const [worldX, worldY] = cam.transform(mouseX, mouseY);
        const size = [0, 0];
        let selectedNode = widget.layout().nodeUnderCoords(worldX, worldY, 1, size);
        if (selectedNode === userCaret.node()) {
          touchingNode = true;
          console.log("Touching node")
          isDown = Date.now();
        } else if (selectedNode) {
          console.log(selectedNode);
          userCaret.moveTo(selectedNode);
          refresh();
        } else {
          isDown = Date.now();
        }
      }
    });

    const distance = (x1, y1, x2, y2) => {
      return Math.sqrt(Math.pow(y2 - y1, 2) + Math.pow(x2 - x1, 2));
    }

    canvas.addEventListener('touchend', e => {
      if (touchingNode) {
        const layout = userCaret.node().layout();
        const [worldX, worldY] = cam.transform(mouseX, mouseY);
        const dist = distance(
          worldX, worldY,
          layout.absoluteX(),
          layout.absoluteY()
        );
        const bodySize = [0, 0];
        userCaret.node().layout().size(bodySize);

        const dy = Math.abs(worldY - layout.absoluteY());
        const dx = Math.abs(worldX - layout.absoluteX());

        touchingNode = false;

        if (worldX === layout.absoluteX() || dy > dx) {
          if (dist > bodySize[1]/2) {
            if (worldY > layout.absoluteY()) {
              spawnMove(Direction.DOWNWARD);
            } else {
              spawnMove(Direction.UPWARD);
            }
            isDown = NaN;
            return;
          }
        } else {
          if (dist > bodySize[0]/2) {
            if (worldX > layout.absoluteX()) {
              spawnMove(Direction.FORWARD);
            } else {
              spawnMove(Direction.BACKWARD);
            }
            isDown = NaN;
            return;
          }
        }

        console.log(isDown);
        if (!isNaN(isDown) && Date.now() - isDown < maxClickDelay) {
          showEditor = false;
          toggleEditor();
        }
      }
    });

    canvas.addEventListener('touchmove', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; ++i) {
        const touch = e.changedTouches[i];
        const dx = touch.clientX - mouseX;
        const dy = touch.clientY - mouseY;
        if (!touchingNode) {
          cam.adjustOrigin(dx / cam.scale(), dy / cam.scale());
          refresh();
        }
        [mouseX, mouseY] = [touch.clientX, touch.clientY];
      }
    });

    canvas.addEventListener('wheel', e => {
      if (!isNaN(mouseX)) {
        cam.zoomToPoint(Math.pow(1.1, e.deltaY > 0 ? -1 : 1), mouseX, mouseY);
        refresh();
      }
    });
    canvas.addEventListener('keydown', e => {
      if (showEditor) {
        return;
      }
      const pull = (dir) => {
        console.log("Pulling", nameDirection(dir), userCaret.node().value())
        userCaret.pull(dir);
        refresh();
        return;
      };

      const toggleAlignment = () => {
        const node = userCaret.node();
        if (node.neighbors().isRoot()) {
          return;
        }
        const childDir = reverseDirection(node.neighbors().parentDirection())
        const alignment = node.neighbors().parentNode().neighbors().getAlignment(childDir);
        node.neighbors().parentNode().neighbors().align(
          childDir,
          nextAlignment(alignment, childDir)
        )
        refresh();
      };

      console.log(e);
      switch (e.key) {
        case 'Escape':
          cam.setOrigin(cam.width()/2, cam.height()/2);
          cam.setScale(1);
          refresh();
          break;
        case 'x':
        case 'Backspace':
          if (userCaret.node().neighbors().isRoot()) {
            return;
          }
          const node = userCaret.node();
          userCaret.moveTo(node.neighbors().parentNode());
          node.disconnect();
          refresh();
          break;
        case 'o':
          if (userCaret.has(Direction.OUTWARD)) {
            userCaret.move(Direction.OUTWARD);
            refresh();
          } else if (!userCaret.node().neighbors().isRoot()) {
            userCaret.move(userCaret.node().neighbors().parentDirection());
            refresh();
          }
          break;
        case 'i':
          spawnMove(Direction.INWARD);
          break;
        case 'J':
          pull(Direction.DOWNWARD);
          break;
        case 'K':
          pull(Direction.UPWARD);
          break;
        case 'L':
          pull(Direction.FORWARD);
          break;
        case 'H':
          pull(Direction.BACKWARD);
          break;
        case 'v':
          toggleAlignment();
          break;
        case 'ArrowDown':
        case 'j':
          spawnMove(Direction.DOWNWARD);
          break;
        case 'ArrowUp':
        case 'k':
          spawnMove(Direction.UPWARD);
          break;
        case 'ArrowRight':
        case 'l':
          spawnMove(Direction.FORWARD);
          break;
        case 'ArrowLeft':
        case 'h':
          spawnMove(Direction.BACKWARD);
          break;
        case '`':
        case '~':
          if (userCaret.node().scale() !== 1) {
            userCaret.node().setScale(1);
          } else {
            userCaret.shrink();
          }
          refresh();
          break;
        case 'Enter':
          toggleEditor();
          refresh();
          break;
        default:
          console.log(e);
          return;
      }
      e.preventDefault();
    });

    new ResizeObserver(() => {
      cam.setSize(canvas.offsetWidth, canvas.offsetHeight);
      refresh();
    }).observe(canvas);


    canvas.style.background = 'black';
    canvas.style.overflow = 'hidden';

    const textCanvas = document.createElement('canvas');
    textCanvas.style.position = 'absolute';
    textCanvas.style.left = 0;
    textCanvas.style.right = 0;
    textCanvas.style.top = 0;
    textCanvas.style.bottom = 0;
    const ctx = textCanvas.getContext("2d");

    const glProvider = new BasicGLProvider();
    glProvider.container();
    glProvider.container().style.position = 'relative';
    glProvider.container().style.width = '100%';
    glProvider.container().style.height = '100%';
    canvas.appendChild(glProvider.container());
    canvas.appendChild(textCanvas);

    const editor = document.createElement('input');
    editor.style.position = 'absolute';
    editor.style.bottom = '32px';
    editor.style.left = '25%';
    editor.style.right = '25%';
    editor.style.fontSize = '24px';
    editor.style.display = 'none';
    editor.addEventListener('keypress', e => {
      if (e.key === 'Escape') {
        showEditor = false;
        editor.style.display = 'none';
        canvas.focus();
      } else if (e.key === 'Enter') {
        showEditor = false;
        userCaret.node().setValue(editor.value === '' ? undefined : editor.value);
        editor.style.display = 'none';
        canvas.focus();
        refresh();
      }
    })
    canvas.appendChild(editor);

    const painters = new WeakMap();

    let layout;
    const createLayout = () => {
      return new CommitLayout(widget, {
        size: (node, size) => {
          size[0] = fontSize;
          if (nodeHasValue(node)) {
            const { width } = ctx.measureText(node.value());
            size[0] = Math.max(size[0], width + 6*borderThickness);
          }
          size[1] = fontSize;

          if (node.neighbors().hasNode(Direction.INWARD)) {
            const child = node.neighbors().nodeAt(Direction.INWARD);
            const childSize = [0, 0];
            child.layout().extentSize(childSize);

            if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
              if (!nodeHasValue(node)) {
                size[0] = 4*borderThickness;
                size[1] = 4*borderThickness;
              }
              // Vertically aligned inward node.
              size[0] = Math.max(size[0], 2*borderThickness + child.scale() * childSize[0]);
              size[1] += childSize[1] * child.scale();
            } else {
              if (!nodeHasValue(node)) {
                size[0] = borderThickness;
                size[1] = borderThickness;
              }
              // Default is horizontal
              size[0] += childSize[0] * child.scale();
              size[1] = Math.max(size[1], borderThickness + child.scale() * childSize[1]);
            }
          }
        },
        getSeparation: (node, axis) => {
          if (axis === Axis.Z) {
            return borderThickness;
          }
          return fontSize/2;
        },
        paint: (pg) => {
          let painter = painters.get(pg);
          if (!painter) {
            painter = new WebGLBlockPainter(glProvider);
            painter.setBackgroundColor(new Color(1, 1, 1, 0.01));
            painter.setBorderColor(new Color(0.5, 0.5, 0.5, 0.1));
            painters.set(pg, painter);
          } else {
            painter.clear();
          }

          let numBlocks = 0;
          pg.siblings().forEach(node => {
            paintNodeLines(node, borderThickness, () => {
              ++numBlocks;
            });
            paintNodeBounds(node, () => {
              ++numBlocks;
            });
          });

          painter.initBuffer(numBlocks);

          pg.siblings().forEach(node => {
            paintNodeLines(node, borderThickness/2, (x, y, w, h) => {
              painter.setBackgroundColor(new Color(0.5, 0.5, 0.5, 0.5));
              painter.setBorderColor(borderColor);
              painter.drawBlock(x, y, w, h, 0, 0);
            });
            paintNodeBounds(node, (x, y, w, h) => {
              painter.setBackgroundColor(new Color(0, 0, 1, .1));
              painter.setBorderColor(borderColor);
              const scale = node.layout().groupScale();
              if (nodeHasValue(node) || node.neighbors().hasNode(Direction.INWARD)) {
                painter.drawBlock(x, y, w, h, borderRoundedness * scale, borderThickness * scale);
              } else {
                painter.drawBlock(x, y, w, h, w, 2 * borderThickness * scale);
              }
            });
          });
        }
      });
    }

    const paint = () => {
      try {
        localStorage.setItem("parsegraph-camera", JSON.stringify(cam.toJSON()))
        localStorage.setItem("parsegraph-graph", JSON.stringify(serializeParsegraph(widget)));
      } catch (ex) {
        //console.log(ex);
      }
      if (!layout || layout.startingNode() !== widget) {
        console.log("Creating new layout");
        layout = createLayout();
      }
      const start = Date.now();
      while (layout.crank()) {
        if (Date.now() - start > 1000/60) {
          console.log("Layout is timing out");
          refresh();
          break;
        }
      }
      /*console.log("Layout phase", layout.layoutPhase);
      if (!layout.crank()) {
        console.log("Layout complete", layout.layoutPhase);
        layout = null;
      } else {
        console.log("Layout timeout", layout.layoutPhase);
      }*/

      render();
    };

    const render = () => {
      if (!cam.canProject() || !glProvider.canProject()) {
        return;
      }
      const worldMatrix = cam.project();

      const gl = glProvider.gl();
      glProvider.render();
      gl.viewport(0, 0, cam.width(), cam.height());

      gl.clearColor(0.1, 0.1, 0.1, 1);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.DST_ALPHA);
      gl.clear(gl.COLOR_BUFFER_BIT);

      textCanvas.width = cam.width();
      textCanvas.height = cam.height();
      ctx.resetTransform();
      ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);

      ctx.scale(cam.scale(), cam.scale());
      ctx.translate(cam.x(), cam.y());

      let pg = widget;
      do {
        const painter = painters.get(pg);
        if (!painter) {
          continue;
        }

        painter.render(matrixMultiply3x3(
          makeScale3x3(
            pg.layout().absoluteScale()
          ),
          makeTranslation3x3(
            pg.layout().absoluteX(), pg.layout().absoluteY()
          ),
          worldMatrix
        ));

        ctx.save();
        ctx.translate(pg.layout().absoluteX(), pg.layout().absoluteY());
        ctx.scale(pg.layout().absoluteScale(), pg.layout().absoluteScale());
        pg.siblings().forEach(node => {
          if (node.layout().needsAbsolutePos()) {
            return;
          }
          if (!nodeHasValue(node)) {
            return;
          }
          ctx.fillStyle = borderColor.asRGBA();
          ctx.save();
          if (node.neighbors().hasNode(Direction.INWARD)) {
            const nodeSize = [0, 0]
            node.layout().size(nodeSize);
            const scale = node.layout().groupScale();
            if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.translate(node.layout().groupX(), node.layout().groupY() - scale * nodeSize[1]/2 + scale * 3);
            } else {
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.translate(node.layout().groupX() - scale * nodeSize[0]/2 + scale * 3/2, node.layout().groupY());
            }
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.translate(node.layout().groupX(), node.layout().groupY());
          }
          ctx.scale(node.layout().groupScale(), node.layout().groupScale());
          ctx.fillText(node.value(), 0, 0)
          ctx.restore();
        });
        ctx.restore();

        pg = pg.paintGroup().next();
      } while (pg !== widget);

      if (userCaret.node()) {
        const layout = userCaret.node().layout();
        /*ctx.fillStyle = 'none';
        ctx.strokeStyle = 'yellow';
        const extentSize = [0, 0];
        layout.extentSize(extentSize);
        ctx.strokeRect(
          layout.absoluteX() - layout.extentOffsetAt(Direction.DOWNWARD),
          layout.absoluteY() - layout.extentOffsetAt(Direction.FORWARD), extentSize[0], extentSize[1]
        );*/
        ctx.lineWidth = borderThickness/2 * layout.absoluteScale();
        ctx.lineJoin = "round";
        ctx.strokeStyle = "orange";
        const bodySize = [0, 0];
        layout.size(bodySize);
        if (nodeHasValue(userCaret.node()) || userCaret.node().neighbors().hasNode(Direction.INWARD)) {
          ctx.strokeRect(
            layout.absoluteX() - layout.absoluteScale() * bodySize[0]/2,
            layout.absoluteY() - layout.absoluteScale() * bodySize[1]/2, layout.absoluteScale() * bodySize[0], layout.absoluteScale() * bodySize[1]
          );
        } else {
          ctx.beginPath();
          ctx.arc(
            layout.absoluteX(),
            layout.absoluteY(),
            bodySize[0]/2 * layout.absoluteScale(),
            0,
            Math.PI * 2
          )
          ctx.stroke();
        }

        ctx.resetTransform();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(userCaret.node()?.value(), 0, 0);
      }
    };

      paint();
  }, [canvasRef, widget])

  const openFile = file => {
    return file.text().then(val => {
      setWidget(deserializeParsegraph(JSON.parse(val)));
    }).catch(ex => {
      console.log(ex);
    });
  }

  const fileChanged = e => {
    for (const file of e.target.files) {
      openFile(file);
    }
  };

  const drop = ev => {
    ev.preventDefault();
    if (ev.dataTransfer.items) {
      // Use DataTransferItemList interface to access the file(s)
      [...ev.dataTransfer.items].forEach((item, i) => {
        // If dropped items aren't files, reject them
        if (item.kind === "file") {
          openFile(item.getAsFile());
        }
      });
    } else {
      // Use DataTransfer interface to access the file(s)
      [...ev.dataTransfer.files].forEach((file, i) => {
        openFile(file);
      });
    }
  };

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const openImportModal = () => {
    setImportModalOpen(true);
  }

  const openExportModal = () => {
    setExportModalOpen(true);
  }

  return (
    <div className="App">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: "100%", height: "100%", overflow: "hidden"}} ref={canvasRef}/>
      <div style={{position: 'absolute', top: '3px', left: '3px', display: 'flex', gap: '3px'}}>
        <button onClick={openImportModal}>Import</button>
        <input type="file" onChange={fileChanged} accept='*.parsegraph'></input>
      </div>
      <div style={{position: 'absolute', top: '3px', right: '3px'}}>
        <button onClick={openExportModal}>Export</button>
        <button onClick={()=>download("graph.parsegraph", JSON.stringify(serializeParsegraph(widget)))}>Download</button>
      </div>
      {importModalOpen && <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'lightblue', padding: '24px', borderRadius: '6px'}}>
        <ImportModal onClose={() => setImportModalOpen(false)} openGraph={setWidget}/>
      </div>}
      {exportModalOpen && <div style={{position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'lightyellow', padding: '24px', borderRadius: '6px'}}>
        <ExportModal graph={widget} onClose={() => setExportModalOpen(false)}/>
      </div>}
    </div>
  );
}

export default App;
