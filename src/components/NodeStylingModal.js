import { useEffect, useRef, useState } from "react";

import "./modal.css";

const ColorField = ({ name, label, style, setStyle }) => {
  const boxRef = useRef();

  useEffect(() => {
    if (!boxRef.current) {
      return;
    }
    if (!style) {
      return;
    }
    const canvas = boxRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = style[name + "Color"];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [boxRef, name, style]);

  return (
    <fieldset className="appearance-fields">
      <legend>{label}</legend>
      <label className="appearance-field">
        Color:&nbsp;
        <span className="appearance-color-input">
          <canvas
            ref={boxRef}
            className="appearance-swatch"
            aria-hidden="true"
          />
          <input
            type="color"
            value={style[name + "Color"]}
            onChange={(e) => {
              setStyle({ ...style, [name + "Color"]: e.target.value });
            }}
          />
        </span>
      </label>
      {style[name + "Alpha"] !== undefined && (
        <label className="appearance-field">
          Alpha:&nbsp;
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={style[name + "Alpha"]}
            onChange={(e) => {
              setStyle({ ...style, [name + "Alpha"]: Number(e.target.value) });
            }}
          />
        </label>
      )}
    </fieldset>
  );
};

export default function NodeStylingModal({
  viewport,
  style: givenStyle,
  updateStyle,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState("background");

  const [style, setStyle] = useState(givenStyle);

  const [isLive, setIsLive] = useState(true);

  const [updateDefault, setUpdateDefault] = useState(false);

  const applyStyle = (e) => {
    e.preventDefault();
    updateStyle(style);
  };

  const update = (newStyle) => {
    setStyle(newStyle);
    if (isLive) {
      updateStyle(newStyle);
    }
    if (updateDefault) {
      viewport.updateDefaultNodeStyle(newStyle);
    }
  };

  const resetStyle = () => {
    setStyle(viewport.defaultNodeStyle());
  };

  const Tab = ({ name, label }) => {
    return (
      <button
        type="button"
        className={activeTab === name ? "active" : null}
        aria-pressed={activeTab === name}
        onClick={(e) => {
          e.preventDefault();
          setActiveTab(name);
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <form
      onSubmit={applyStyle}
      className="document-dialog document-form document-appearance"
    >
      <div className="document-dialog-heading">
        <div>
          <p className="document-eyebrow">APPEARANCE</p>
          <h2>Node appearance</h2>
        </div>
        <button
          className="document-close"
          type="button"
          aria-label="Close appearance"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="document-description">
        Set the page and selected node’s colors.
      </p>
      <div className="tabs" aria-label="Appearance properties">
        <Tab name="page" label="Page" />
        <Tab name="background" label="Node" />
        <Tab name="border" label="Border" />
        <Tab name="text" label="Text" />
        <Tab name="line" label="Line" />
      </div>
      {activeTab === "page" && (
        <ColorField
          style={style}
          setStyle={update}
          name="pageBackground"
          label="Background"
        />
      )}
      {activeTab === "background" && (
        <ColorField
          style={style}
          setStyle={update}
          name="background"
          label="Background"
        />
      )}
      {activeTab === "border" && (
        <ColorField
          style={style}
          setStyle={update}
          name="border"
          label="Border"
        />
      )}
      {activeTab === "line" && (
        <ColorField style={style} setStyle={update} name="line" label="Line" />
      )}
      {activeTab === "text" && (
        <ColorField style={style} setStyle={update} name="text" label="Text" />
      )}

      <label className="appearance-field appearance-option">
        Live:{" "}
        <input
          type="checkbox"
          checked={isLive}
          onChange={(e) => setIsLive(e.target.checked)}
        />
      </label>
      <label className="appearance-field appearance-option">
        Update default node style:{" "}
        <input
          type="checkbox"
          checked={updateDefault}
          onChange={(e) => setUpdateDefault(e.target.checked)}
        />
      </label>
      <div className="buttons">
        <button
          onClick={(e) => {
            e.preventDefault();
            setStyle(viewport.getNodeStyle());
          }}
        >
          Copy
        </button>
        <input className="document-primary" type="submit" value="Apply" />
        <button
          onClick={(e) => {
            e.preventDefault();
            resetStyle();
          }}
        >
          Use Default
        </button>
        <button
          onClick={(e) => {
            e.preventDefault();
            onClose();
          }}
        >
          Close
        </button>
      </div>
    </form>
  );
}
