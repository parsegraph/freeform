import { useState } from "react";

const offscreenPrompts = [
  "The parsegraph is off-screen.",
  "Nothing to be seen here",
  "Where are you going?",
  "You can't go there!",
  "Wait! Come back!",
  "Are you lost?",
];

const OffscreenModal = ({ onRecenter }) => {
  if (!onRecenter) {
    throw new Error("OffscreenModal needs an onRecenter callback");
  }

  const [message] = useState(
    offscreenPrompts[Math.floor(offscreenPrompts.length * Math.random())]
  );

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "20px 30px",
        borderRadius: "5px",
        fontSize: "18px",
        gap: "20px",
        background: "#9e29c4",
        color: "#f1f1f1",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        onRecenter();
      }}
    >
      <span>{message}</span>
      <button
        style={{ background: "#ffcd00", color: "#1f1f1f", cursor: "pointer" }}
        type="submit"
      >
        Re-center
      </button>
    </form>
  );
};
export default OffscreenModal;
