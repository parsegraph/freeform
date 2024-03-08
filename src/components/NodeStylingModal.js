import { useEffect, useRef, useState } from 'react';

import './modal.css';
import { DEFAULT_NODE_STYLE } from '../settings';

const ColorField = ({name, label, style, setStyle}) => {
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

    return <><label style={{display: 'flex', justifyContent: 'space-between', gap: '5px', alignItems: 'center'}}>Color:&nbsp;
        <span style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
            <canvas ref={boxRef} style={{height: '1.5em', width: '2.5em', border: '1px solid black', borderRadius: '3px'}}/>
            <input type="color" value={style[name + "Color"]} onChange={e => {
                setStyle({...style, [name + "Color"]: e.target.value});
            }}/>
        </span>
    </label>
    {style[name + "Alpha"] !== undefined && (<label style={{display: 'flex', justifyContent: 'space-between', gap: '5px', alignItems: 'center'}}>Alpha:&nbsp;
        <input type="range" min="0" max="1" step="0.01" value={style[name + "Alpha"]} onChange={e => {
            setStyle({...style, [name + "Alpha"]: e.target.value});
        }}/>
    </label>)}
    </>;
};

export default function NodeStylingModal({viewport, style: givenStyle, updateStyle, onClose}) {
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
        updateStyle(style);
    }
    if (updateDefault) {
        viewport.updateDefaultNodeStyle(newStyle);
    }
  };

  const resetStyle = () => {
    setStyle(viewport.defaultNodeStyle());
  }

  const Tab = ({name, label}) => {
    return <button className={activeTab === name ? "active" : null} onClick={e=>{
        e.preventDefault();
        setActiveTab(name);
    }}>{label}</button>
  };

  return <form onSubmit={applyStyle} style={{width: '100%', height: '100%', display: 'flex', justifyContent: 'stretch',
  flexDirection: 'column', alignItems: 'stretch', gap: '3px', padding: '12px', boxSizing: 'border-box'}}>
    <h3 style={{margin: '0', marginBottom: '.5em', userSelect: 'none'}}>Node Styling</h3>
    <div className="tabs" style={{display: 'flex', gap:'5px'}}>
        <Tab name="page" label="Page"/>
        <Tab name="background" label="Node"/>
        <Tab name="border" label="Border"/>
        <Tab name="text" label="Text"/>
        <Tab name="line" label="Line"/>
    </div>
    {activeTab === "page" && <ColorField style={style} setStyle={update} name="pageBackground" label="Background"/>}
    {activeTab === "background" && <ColorField style={style} setStyle={update} name="background" label="Background"/>}
    {activeTab === "border" && <ColorField style={style} setStyle={update} name="border" label="Border"/>}
    {activeTab === "line" && <ColorField style={style} setStyle={update} name="line" label="Line"/>}
    {activeTab === "text" && <ColorField style={style} setStyle={update} name="text" label="Text"/>}

    <label style={{display: 'flex', justifyContent: 'space-between'}}>Live: <input type="checkbox" checked={isLive} onChange={e=>setIsLive(e.target.checked)}/></label>
    <label style={{display: 'flex', justifyContent: 'space-between'}}>Update default node style: <input type="checkbox" checked={updateDefault} onChange={e=>setUpdateDefault(e.target.checked)}/></label>
    <div className="buttons">
        <button onClick={e=>{
            e.preventDefault();
            setStyle(viewport.getNodeStyle());
        }}>Copy</button>
        <input type="submit" style={{flexGrow:'1'}} value="Apply"/>
        <button onClick={e=>{
            e.preventDefault();
            resetStyle();
        }}>Use Default</button>
        <button onClick={e=>{
            e.preventDefault();
            onClose();
        }}>Close</button>
    </div>
  </form>
}