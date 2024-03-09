import { Direction } from "parsegraph";
import "./Carousel.css";
import { DONT_TOUCH_CAMERA } from "../settings";

export default function Carousel({ viewport }) {
  return (
    <>
      <button
        className="dir"
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
