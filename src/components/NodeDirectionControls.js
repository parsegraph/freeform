import { useId } from "react";
import { Bidi } from "parsegraph";
import { resolveNodeDirection } from "../graphDirection";

const directionName = (direction) =>
  direction === Bidi.RTL ? "Right to left" : "Left to right";

export default function NodeDirectionControls({ node, onChange }) {
  const descriptionId = useId();
  if (!node) return null;
  const declaration = node.bidi();
  const inherited = declaration === Bidi.INHERIT;
  const source = node.neighbors().isRoot() ? "Freeform default" : "parent";

  return (
    <section className="inspector-section node-direction-controls">
      <label>
        <span>Layout direction</span>
        <select
          value={declaration}
          aria-describedby={descriptionId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value={Bidi.INHERIT}>Inherit</option>
          <option value={Bidi.LTR}>Left to right</option>
          <option value={Bidi.RTL}>Right to left</option>
        </select>
      </label>
      <p id={descriptionId}>
        {directionName(resolveNodeDirection(node))}
        {inherited ? ` · inherited from ${source}.` : " · set on this node."}
        <br />
        Sets horizontal flow for this node and descendants that inherit it.
      </p>
    </section>
  );
}
