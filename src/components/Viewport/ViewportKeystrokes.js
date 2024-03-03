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
    }

    handleKey(key) {
        if (!SHOW_KEY_STROKES) {
            return;
        }
        if (this._keyStrokeElem.innerText === "") {
            this._keyStrokeElem.innerText += key;
        } else {
            this._keyStrokeElem.innerText += " " + key;
        }
        this._keyStrokeTime = Date.now();
        this._keyStrokeElem.style.display = 'block';
    }
}