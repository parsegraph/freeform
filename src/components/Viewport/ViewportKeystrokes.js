import { SHOW_KEY_STROKES } from "../../settings";

export default class ViewportKeystrokes {
    constructor(viewport) {
        this._keyStrokeElem  = document.createElement("div");
        this._keyStrokeElem.style.position = 'fixed';
        this._keyStrokeElem.style.transform = 'translate(-50%, -50%)';
        this._keyStrokeElem.style.left = '50%';
        this._keyStrokeElem.style.bottom = '5px';
        this._keyStrokeElem.style.fontFamily = '"Consolas", "Inconsolata", monospace';
        this._keyStrokeElem.style.fontSize = '36px';
        this._keyStrokeElem.style.background = 'white';
        this._keyStrokeElem.style.color = 'black';
        this._keyStrokeElem.style.padding = '5px';
        this._keyStrokeElem.style.display = 'none';
        viewport.container().appendChild(this._keyStrokeElem);

        this._keyStrokeTime = NaN;
    }

    refreshKeystrokes() {
        if (!SHOW_KEY_STROKES || !this._keyStrokeElem) {
            return;
        }
        if (Date.now() - this._keyStrokeTime > 1000) {
            this._keyStrokeElem.style.display = 'none';

            this._keyStrokeElem.innerText = '';
        }
    }

    handleKey(key) {
        if (!SHOW_KEY_STROKES) {
            return;
        }
        let text = this._keyStrokeElem.innerText;
        if (text === "") {
            text = key;
        } else {
            if (text.endsWith(' ' + key) || text === key) {
                text += "(x2)"
            }
            else if (text.match(/\(x([^\)]+)\)$/)) {
                const m = text.match(/\(x([^\)]+)\)$/);
                const textPart = text.substring(0, text.length - m[0].length);
                console.log('"' + textPart + '"', '"' + m[0] + '"');
                if (textPart.endsWith(key)) {
                    console.log("ends with " + key);
                    const times = Number.parseInt(m[1]);
                    console.log(m[1], times, m, m[0]);
                    text = textPart + "(x" + (times + 1) + ")";
                } else {
                    console.log("does not end with " + key);
                    text += " " + key;
                }
            } else {
                console.log("ubsted");
                text += " " + key;
            }
        }
        this._keyStrokeElem.innerText = text;
        this._keyStrokeTime = Date.now();
        this._keyStrokeElem.style.display = 'block';
    }
}