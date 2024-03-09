import { Direction, serializeParsegraph } from 'parsegraph';
import PrimesWidget from './PrimesWidget';

const widget = new PrimesWidget();

onmessage = (e) => {
    const { numSteps, key } = e.data;
    postMessage({
        key,
        graph: runSteps(numSteps, key)
    });
};

function runSteps(numSteps, key)
{
    numSteps = Math.max(numSteps, 1);
    let root;
    let last;
    for (let step = 0; step < numSteps; ++step) {
        const node = widget.step();
        if (step === 0) {
            root = node;
            last = node;
        } else {
            last.connect(Direction.FORWARD, node);
            last = node;
        }
        postMessage({
            key,
            progress: step / numSteps
        });
    }

    return serializeParsegraph(root);
};