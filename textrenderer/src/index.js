const { LINE_HEIGHT, BORDER_THICKNESS, INWARD_SEPARATION, LINE_SPACING, FONT_UPSCALE } = require('../../src/settings');

const Camera = require('parsegraph-camera').default;

let ctx, cam, canvas;

onmessage = (e) => {
    switch(e.data.event) {
    case "init":
        init(e.data.camera);
        break;
    case "text":
        text(e.data)
        break;
    case "render":
        render(e.data.key);
        break;
    }
};

function init(camData) {
    cam = new Camera();
    cam.restore(camData);
    cam.setSize(camData.width, camData.height);
    if (!cam.canProject()) {
        throw new Error("Camera cannot project");
    }
    canvas = new OffscreenCanvas(cam.width(), cam.height());
    ctx = canvas.getContext("2d");
    ctx.scale(cam.scale(), cam.scale());
    ctx.translate(cam.x(), cam.y());
}

function text({worldX, worldY, worldScale, text, font, fillStyle, hasInward, nodeSize, inwardVertical}) {
    if (!ctx) {
        throw new Error("Not initialized");
    }
    const lines = text.toString().split(/\n/g);
    ctx.font = font;
    ctx.fillStyle = fillStyle;
    ctx.save();
    let textWidth = 0;
    let lastDescent;
    const textHeight = lines.reduce((total, line) => {
      const metrics = ctx.measureText(line);
      textWidth += metrics.width;
      lastDescent = metrics.actualBoundingBoxDescent;
      return total + 
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    }, 0);

    if (hasInward) {
        if (inwardVertical) {
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.translate(
            worldX, worldY - (worldScale * nodeSize[1]) / 2 + worldScale*INWARD_SEPARATION/4
          );
        } else {
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.translate(
            worldX - (worldScale * nodeSize[0]) / 2 + worldScale*INWARD_SEPARATION/4,
            worldY
          );
          ctx.translate(
            0,
            -textHeight*worldScale/2
          );
        }
    } else {
        ctx.textAlign = "left";
        ctx.textBaseline = "hanging";
        ctx.translate(
          worldX - (worldScale * nodeSize[0]) / 2 + worldScale*INWARD_SEPARATION/4,
          worldY - worldScale * textHeight/2
        );
    }
    ctx.scale(worldScale, worldScale);
    lines.forEach((line) => {
        ctx.fillText(line, 0, 0);
        const metrics = ctx.measureText(line);
        const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        ctx.translate(0, height + worldScale * Math.min((nodeSize[1] - (textHeight - lastDescent) - INWARD_SEPARATION) / lines.length, 16/FONT_UPSCALE));
    });
    ctx.restore();
}

function render(key) {
    if (!canvas) {
        throw new Error("Not initialized");
    }
    postMessage({
        key, 
        image: canvas.transferToImageBitmap()
    });
}