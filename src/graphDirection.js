import { Bidi } from "parsegraph";
import { DEFAULT_LAYOUT_DIRECTION } from "./settings";

// Resolve authored declarations without consulting the previous layout's
// effectiveBidi(), which may be stale while a new layout is being prepared.
export function resolveNodeDirection(
  node,
  defaultDirection = DEFAULT_LAYOUT_DIRECTION
) {
  if (!node) return undefined;
  if (defaultDirection !== Bidi.LTR && defaultDirection !== Bidi.RTL)
    throw new Error("The surrounding layout direction must be ltr or rtl.");
  let current = node;
  while (current.bidi() === Bidi.INHERIT) {
    if (current.neighbors().isRoot()) return defaultDirection;
    current = current.neighbors().parentNode();
  }
  return current.bidi();
}
