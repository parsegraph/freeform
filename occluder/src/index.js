import Occluder from './Occluder';

onmessage = (e) => {
    postMessage({
        key: e.data[e.data.length - 1],
        labels: runOcclusion(...e.data)
    });
};

function runOcclusion(worldX, worldY, worldWidth, worldHeight, worldScale, allLabels)
{
    const x = worldX;
    const y = worldY;
    const scale = worldScale;
    const w = worldWidth / scale;
    const h = worldHeight / scale;

    const occluder = new Occluder(-x + w / 2, -y + h / 2, w, h);

    const drawnLabels = [];

    let markTime = Date.now();
    allLabels.forEach((label, index) => {
        if (occluder.occlude(label.x, label.y, label.width, label.height)) {
            drawnLabels.push(index);
        }
        if (Date.now() - markTime > 1000) {
            postMessage(index / allLabels.length);
            markTime = Date.now();
        }
    });
    return drawnLabels;
};