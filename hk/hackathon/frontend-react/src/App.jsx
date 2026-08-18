import React, { useState } from "react";
import Canvas3D from "./components/Canvas3D";
import TopologyStudio from "./components/TopologyStudio";
import TelemetryPanel from "./components/TelemetryPanel";
import StatusPanel from "./components/StatusPanel";
import { useStore } from "./store/useStore";

export default function App() {
  const [studioOpen, setStudioOpen] = useState(false);
  const reset = useStore((s) => s.reset);
  const t = useStore((s) => s.t);

  return (
    <div id="app">
      <header id="topbar">
        <div className="brand">INFINITY <span>NEXUS PX</span></div>
        <span className="badge sim">SIMULATED estate — t+{t * 5}min since seed</span>
        <div className="actions">
          <button className="primary" onClick={() => setStudioOpen(true)}>+ Topology Studio</button>
          <button onClick={reset}>Reset</button>
        </div>
      </header>

      <main>
        <div id="twin-wrap">
          <Canvas3D />
          <div id="twin-hint">Drag to orbit · Scroll to zoom · Click a building to control it</div>
        </div>
        <aside id="sidebar">
          <TelemetryPanel />
          <StatusPanel />
        </aside>
      </main>

      <TopologyStudio open={studioOpen} onClose={() => setStudioOpen(false)} />
    </div>
  );
}
