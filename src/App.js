import { useEffect, useRef } from 'react';
import './App.css';

import { 
  Direction,
  CommitLayout,
  paintNodeBounds,
  paintNodeLines,
  Alignment,
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

import PrimesWidget from './PrimesWidget';

const fontSize = 36;

function App() {
  const canvasRef = useRef();

  useEffect(() => {
    if (!canvasRef.current) {
      return;
    }
    while (canvasRef.current.firstChild) {
      canvasRef.current.firstChild.remove();
    }

    const cam = new Camera();

    // Render the graph.
    let isDown = false;
    const canvas = canvasRef.current;

    let [mouseX, mouseY] = [NaN, NaN];
    canvas.addEventListener('mousedown', e => {
      isDown = true;
      [mouseX, mouseY] = [e.clientX, e.clientY];
      refresh();
    });
    canvas.addEventListener('mouseup', e => {
      isDown = false;
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
      console.log(e);
      if (!isNaN(mouseX)) {
        cam.zoomToPoint(Math.pow(1.1, e.deltaY > 0 ? -1 : 1), mouseX, mouseY);
        refresh();
      }
    });

    new ResizeObserver(() => {
      cam.setSize(canvas.offsetWidth, canvas.offsetHeight);
      refresh();
    }).observe(canvas);

    canvas.style.background = 'black';
    canvas.style.overflow = 'hidden';

    const refresh = () => {
      requestAnimationFrame(() => {
        paint();
      });
    };

    const widget = new PrimesWidget();

    const glProvider = new BasicGLProvider();

    const textCanvas = document.createElement('canvas');
    textCanvas.style.position = 'absolute';
    textCanvas.style.left = 0;
    textCanvas.style.right = 0;
    textCanvas.style.top = 0;
    textCanvas.style.bottom = 0;
    const ctx = textCanvas.getContext("2d");

    glProvider.container();
    glProvider.container().style.position = 'relative';
    glProvider.container().style.width = '100%';
    glProvider.container().style.height = '100%';
    canvas.appendChild(glProvider.container());
    canvas.appendChild(textCanvas);

    const painters = new WeakMap();

    let layout;
    const createLayout = () => {
      return new CommitLayout(widget.node(), {
        size: (node, size) => {
          size[0] = fontSize;
          size[1] = fontSize;
        },
        getSeparation: () => {
          return 3;
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
            paintNodeLines(node, 1, () => {
              ++numBlocks;
            });
            paintNodeBounds(node, () => {
              ++numBlocks;
            });
          });

          painter.initBuffer(numBlocks);

          pg.siblings().forEachNode(node => {
            paintNodeLines(node, 1, (x, y, w, h) => {
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
                painter.setBackgroundColor(new Color(0, 0, 1, 1));
                painter.setBorderColor(new Color(1, 1, 1, 1));
              }
              const scale = node.layout().groupScale();
              painter.drawBlock(x, y, w, h, 5 * scale, 3 * scale);
            });
          });
        }
      });
    }

    let timer;
    const paint = () => {
      if (!layout || layout.startingNode() !== widget.node()) {
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
      const MAX_PRIME = 180;
      if (widget.position <= MAX_PRIME) {
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(() => {
          let start = Date.now();
          while (Date.now() - start < 10 && widget.position <= MAX_PRIME) {
            widget.step();
          }
          refresh();
        }, 500)
      }
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

      let pg = widget.node();
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
            if (node.neighbors().getAlignment(Direction.INWARD) === Alignment.INWARD_HORIZONTAL) {
              ctx.textAlign = 'left';
              ctx.textBaseline = 'middle';
              ctx.translate(node.layout().groupX() - scale * nodeSize[0]/2 + scale * 3/2, node.layout().groupY());
            } else {
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              ctx.translate(node.layout().groupX(), node.layout().groupY() - scale * nodeSize[1]/2 + scale * 3);
            }
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.translate(node.layout().groupX(), node.layout().groupY());
          }
          ctx.scale(node.layout().groupScale(), node.layout().groupScale());
              console.log(ctx.textAlign, ctx.textBaseline);
          ctx.fillText(node.value(), 0, 0)
          ctx.restore();
        });
        ctx.restore();

        pg = pg.paintGroup().next();
      } while (pg !== widget.node());
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
