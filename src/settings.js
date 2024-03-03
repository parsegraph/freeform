import Color from "parsegraph-color";

const USE_LOCAL_STORAGE = false;

const PUBLIC_SERVERS = false;
const HIDE_PUBLIC_SERVERS_TAB = true;
const POST_RENDER_TIMEOUT_MS = 15;
const LABEL_IS_VISIBLE_SCALE = 0.8;
const TEXT_IS_VISIBLE_SCALE = 0.2;
const DEFAULT_NODE_STYLE = {
    backgroundColor: new Color(0.5, 1, 0.5, 0.1),
    borderColor: new Color(0, 0, 0, 0.5),
    textColor: new Color(0, 0, 0, 1),
    lineColor: new Color(.9, .9, .9, .8)
};
const SHOW_KEY_STROKES = false;
const PAGE_BACKGROUND_COLOR = new Color(
    .2, .2, .9, 1
);

export {
    PAGE_BACKGROUND_COLOR,
    SHOW_KEY_STROKES,
    DEFAULT_NODE_STYLE,
    USE_LOCAL_STORAGE,
    PUBLIC_SERVERS,
    HIDE_PUBLIC_SERVERS_TAB,
    TEXT_IS_VISIBLE_SCALE,
    LABEL_IS_VISIBLE_SCALE,
    POST_RENDER_TIMEOUT_MS
}