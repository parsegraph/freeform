import { Direction } from "parsegraph";
import "./Carousel.css";
import { DONT_TOUCH_CAMERA } from "../settings";
import { isStructuredDocument } from "../structuredDocument";

export default function Carousel({ viewport }) {
  if (isStructuredDocument(viewport.widget())) return null;
  return (
    <>
      <button
        className="dir"
        aria-label="Add inner node"
        title="Add inner node"
        style={{
          position: "absolute",
          right: "50%",
          top: "50%",
          transform: "translate(50%, -50%)",
        }}
        onClick={() =>
          viewport.spawnMove(Direction.INWARD, false, DONT_TOUCH_CAMERA)
        }
      >
        +
      </button>
      <button
        className="dir"
        aria-label="Add node to the left"
        title="Add node to the left"
        style={{
          position: "absolute",
          right: "100%",
          top: "50%",
          transform: "translate(0, -50%)",
        }}
        onClick={() =>
          viewport.spawnMove(Direction.BACKWARD, false, DONT_TOUCH_CAMERA)
        }
      >
        +
      </button>
      <button
        className="dir"
        aria-label="Add node above"
        title="Add node above"
        style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translate(-50%, 0)",
        }}
        onClick={() =>
          viewport.spawnMove(Direction.UPWARD, false, DONT_TOUCH_CAMERA)
        }
      >
        +
      </button>
      <button
        className="dir"
        aria-label="Add node below"
        title="Add node below"
        style={{
          position: "absolute",
          left: "50%",
          top: "100%",
          transform: "translate(-50%, 0)",
        }}
        onClick={() =>
          viewport.spawnMove(Direction.DOWNWARD, false, DONT_TOUCH_CAMERA)
        }
      >
        +
      </button>
      <button
        className="dir"
        aria-label="Add node to the right"
        title="Add node to the right"
        style={{
          position: "absolute",
          left: "100%",
          top: "50%",
          transform: "translate(0, -50%)",
        }}
        onClick={() =>
          viewport.spawnMove(Direction.FORWARD, false, DONT_TOUCH_CAMERA)
        }
      >
        +
      </button>
    </>
  );
}
