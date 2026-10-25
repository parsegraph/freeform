const { drawGlyphText } = require('../../src/glyphText');

const Camera = require('parsegraph-camera').default;

let ctx, cam, canvas;

onmessage = (e) => {
    switch(e.data.event) {
    case "init":
        init(e.data.camera);
        break;
    case "text":
        drawGlyphText(ctx, e.data);
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

function render(key) {
    if (!canvas) {
        throw new Error("Not initialized");
    }
    postMessage({
        key, 
        image: canvas.transferToImageBitmap()
    });
}
