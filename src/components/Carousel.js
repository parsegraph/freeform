import { Direction } from "parsegraph";
import './Carousel.css';

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
        onClick={() => viewport.spawnMove(Direction.INWARD)}
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
        onClick={() => viewport.spawnMove(Direction.BACKWARD)}
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
        onClick={() => viewport.spawnMove(Direction.UPWARD)}
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
        onClick={() => viewport.spawnMove(Direction.DOWNWARD)}
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
        onClick={() => viewport.spawnMove(Direction.FORWARD)}
      >
        +
      </button>
    </>
  );
}
