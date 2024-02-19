import { useCallback, useEffect, useRef } from 'react';
import './App.css';

import { 
  Direction,
  DirectionNode,
  CommitLayout,
  paintNodeBounds,
  paintNodeLines,
  Alignment,
  DirectionCaret,
  Axis,
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

const fontSize = 36;
const borderThickness = 3;
const borderRoundedness = 5;
const maxClickDelay = 1000;

function App() {
  const canvasRef = useRef();

  useEffect(() => {
    if (!canvasRef.current) {
      // No canvas yet.
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

    // Build the graph
    const widget = new DirectionNode("hey it widget root node");
    widget.connect(Direction.FORWARD, new DirectionNode("its forward node"));
    widget.neighbors().nodeAt(Direction.FORWARD).connect(Direction.FORWARD, new DirectionNode("its another forward node"));

    // Input event callbacks
    let isDown = null;
    const canvas = canvasRef.current;
    canvas.tabIndex = '0';
    let [mouseX, mouseY] = [NaN, NaN];
    let userCaret = new DirectionCaret(widget);
    let showEditor = false;
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
        if (selectedNode) {
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
      const spawnMove = (dir) => {
        if (userCaret.node().neighbors().hasNode(dir)) {
          userCaret.move(dir);
          refresh();
        } else {
          userCaret.spawnMove(dir);
          refresh();
        }
      }
      console.log(e);
      switch (e.key) {
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
          }
          break;
        case 'i':
          spawnMove(Direction.INWARD);
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
          showEditor = !showEditor;
          if (showEditor) {
            editor.style.display = 'block';
            editor.focus();
            const val = userCaret.node().value();
            if (typeof val === "string" && val !== '') {
              editor.value = userCaret.node().value();
            } else {
              editor.value = '';
            }
          } else {
            editor.style.display = 'none';
          }
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


    const refresh = () => {
      requestAnimationFrame(() => {
        paint();
      });
    };

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
        userCaret.node().setValue(editor.value);
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
          const hasValue = typeof node.value() === "string" || typeof node.value() === "number";
          if (hasValue) {
            const { width } = ctx.measureText(node.value());
            size[0] = Math.max(size[0], width + 6*borderThickness);
          }
          size[1] = fontSize;

          if (node.neighbors().hasNode(Direction.INWARD)) {
            const child = node.neighbors().nodeAt(Direction.INWARD);
            const childSize = [0, 0];
            child.layout().extentSize(childSize);

            if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_VERTICAL) {
              if (!hasValue) {
                size[0] = 4*borderThickness;
                size[1] = 4*borderThickness;
              }
              // Vertically aligned inward node.
              size[0] = Math.max(size[0], 2*borderThickness + childSize[0]);
              size[1] += childSize[1];
            } else {
              if (!hasValue) {
                size[0] = borderThickness;
                size[1] = borderThickness;
              }
              // Default is horizontal
              size[0] += childSize[0];
              size[1] = Math.max(size[1], borderThickness + childSize[1]);
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
          pg.siblings().forEachNode(node => {
            paintNodeLines(node, borderThickness, () => {
              ++numBlocks;
            });
            paintNodeBounds(node, () => {
              ++numBlocks;
            });
          });

          painter.initBuffer(numBlocks);

          pg.siblings().forEachNode(node => {
            paintNodeLines(node, borderThickness/2, (x, y, w, h) => {
              painter.setBackgroundColor(new Color(0.5, 0.5, 0.5, 0.5));
              painter.setBorderColor(new Color(1, 1, 1, 1));
              painter.drawBlock(x, y, w, h, 0, 0);
            });
            paintNodeBounds(node, (x, y, w, h) => {
              if (node.value() === "s") {
                painter.setBackgroundColor(new Color(0.2, 0.2, 0.2, 0.5));
                painter.setBorderColor(new Color(0.5, 0.5, 0.5, 0.5));
              } else if (node.value() === "b") {
                painter.setBackgroundColor(new Color(0, 0, 0, 1));
                painter.setBorderColor(new Color(1, 1, 1, 1));
              }
              else {
                painter.setBackgroundColor(new Color(0, 0, 1, .1));
                painter.setBorderColor(new Color(1, 1, 1, 1));
              }
              const scale = node.layout().groupScale();
              painter.drawBlock(x, y, w, h, borderRoundedness * scale, borderThickness * scale);
            });
          });
        }
      });
    }

    const paint = () => {
      localStorage.setItem("parsegraph-camera", JSON.stringify(cam.toJSON()))
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
        pg.siblings().forEachNode(node => {
          if (node.layout().needsAbsolutePos()) {
            return;
          }
          if (typeof node.value() !== "string" && typeof node.value() !== "number") {
            return;
          }
          if (node.value() === "s" || node.value() === "b") {
            return;
          }
          ctx.fillStyle = 'white';
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
        ctx.strokeStyle = 'orange';
        const bodySize = [0, 0];
        layout.size(bodySize);
        ctx.strokeRect(
          layout.absoluteX() - layout.absoluteScale() * bodySize[0]/2,
          layout.absoluteY() - layout.absoluteScale() * bodySize[1]/2, layout.absoluteScale() * bodySize[0], layout.absoluteScale() * bodySize[1]
        );

        ctx.resetTransform();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(userCaret.node()?.value(), 0, 0);
      }
    };

    paint();
}, [canvasRef])

  return (
    <div className="App">
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', width: "100%", height: "100%", overflow: "hidden"}} ref={canvasRef}/>
    </div>
  );
}

export default App;
