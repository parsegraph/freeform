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
const PRINT_PAINT_STATS = true;
const ENABLE_EXTENT_VIEWING = true;

const CREASE_ROUNDS = 4;

const MAX_ROUNDS = 14;

const MAX_RENDER_ATTEMPTS = 1000;

const nodeHasValue = (node) => typeof node.value() === "string" || typeof node.value() === "number";

const FONT_SIZE = 10;
const LINE_HEIGHT = FONT_SIZE;
const BORDER_THICKNESS = 1;
const LINE_THICKNESS = 3;
const BORDER_ROUNDEDNESS = 5;
const MAX_CLICK_DELAY_MS = 1000;
const MOVE_SPEED = FONT_SIZE;
const BUD_SIZE = .75;
const INWARD_SEPARATION = LINE_THICKNESS * 4;
const MAX_PAINT_TIME_MS = 1000/60;

const CRANK_SPEED_MS = 1000;
const SLOW_RENDER = true;

export {
    SLOW_RENDER,
    MAX_RENDER_ATTEMPTS,
    CRANK_SPEED_MS,
    MAX_PAINT_TIME_MS,
    FONT_SIZE,
    LINE_HEIGHT,
    LINE_THICKNESS,
    BORDER_ROUNDEDNESS,
    BORDER_THICKNESS,
    MOVE_SPEED,
    BUD_SIZE,
    INWARD_SEPARATION,
    MAX_CLICK_DELAY_MS,
    nodeHasValue,
    MAX_ROUNDS,
    ENABLE_EXTENT_VIEWING,
    PRINT_PAINT_STATS,
    CREASE_ROUNDS,
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
