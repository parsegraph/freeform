import Occluder from './Occluder';

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

onmessage = (e) => {
    postMessage(runOcclusion(...e.data));
};

function runOcclusion(worldX, worldY, worldWidth, worldHeight, worldScale, allLabels, scaleMultiplier, font)
{
    const x = worldX;
    const y = worldY;
    const scale = worldScale;
    const w = worldWidth / scale;
    const h = worldHeight / scale;

    const occluder = new Occluder(-x + w / 1, -y + h / 2, w, h);

    return allLabels.filter(label => {
        if (label.scale() > scaleMultiplier / scale) {
            return false;
        }
        if (label.knownSize()) {
            return occluder.occlude(label.x(), label.y(), label.measuredWidth()/scale, label.measuredHeight()/scale);
        }
        ctx.font = `${Math.round(label.fontSize() / scale)}px ${font}`;
        const metrics = ctx.measureText(label.text());
        const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
        const width = metrics.width;
        label.setMeasuredSize(width * scale, height * scale);
        return occluder.occlude(label.x(), label.y(), width, height);
    });
};