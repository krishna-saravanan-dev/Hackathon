import React, { useState } from "react";
import { useStore, NODE_CLASSES } from "../store/useStore";

export default function TopologyStudio({ open, onClose }) {
  const addNode = useStore((s) => s.addNode);
  const [form, setForm] = useState({
    name: "", nodeClass: "REGIONAL_EDGE", x: 0, z: 0,
    maxCpu: "", totalRam: "", baseLatencyMs: 2.0, pue: 1.4,
  });

  if (!open) return null;

  const cls = NODE_CLASSES[form.nodeClass];

  const submit = () => {
    addNode({
      name: form.name.trim() || undefined,
      nodeClass: form.nodeClass,
      x: Number(form.x) || 0,
      z: Number(form.z) || 0,
      maxCpu: form.maxCpu ? Number(form.maxCpu) : undefined,
      totalRam: form.totalRam ? Number(form.totalRam) : undefined,
      baseLatencyMs: Number(form.baseLatencyMs) || 2.0,
      pue: Number(form.pue) || 1.4,
    });
    setForm({ ...form, name: "", x: 0, z: 0, maxCpu: "", totalRam: "" });
    onClose();
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Topology Studio</h3>
        <p className="muted">Provision a custom node. It renders instantly on the canvas, wires into the optimizer, and connects to the nearest hub.</p>

        <label>Node Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ahmedabad Micro Gateway" />
        </label>

        <label>Node Class
          <select value={form.nodeClass} onChange={(e) => setForm({ ...form, nodeClass: e.target.value })}>
            {Object.entries(NODE_CLASSES).map(([key, c]) => (
              <option key={key} value={key}>{c.label}</option>
            ))}
          </select>
        </label>
        <div className="hint">Determines 3D shape: Core Hyperscale = tall wide tower, Regional Edge = mid tower, Micro Gateway = small antenna mast.</div>

        <div className="row2">
          <label>Grid X <input type="number" value={form.x} onChange={(e) => setForm({ ...form, x: e.target.value })} /></label>
          <label>Grid Z <input type="number" value={form.z} onChange={(e) => setForm({ ...form, z: e.target.value })} /></label>
        </div>

        <div className="row2">
          <label>Max CPU (vCPU) <input type="number" value={form.maxCpu} onChange={(e) => setForm({ ...form, maxCpu: e.target.value })} placeholder={String(cls.cpu)} /></label>
          <label>Total RAM (GB) <input type="number" value={form.totalRam} onChange={(e) => setForm({ ...form, totalRam: e.target.value })} placeholder={String(cls.ram)} /></label>
        </div>
        <div className="row2">
          <label>Base Latency (ms) <input type="number" step="0.1" value={form.baseLatencyMs} onChange={(e) => setForm({ ...form, baseLatencyMs: e.target.value })} /></label>
          <label>Power Efficiency (PUE) <input type="number" step="0.1" value={form.pue} onChange={(e) => setForm({ ...form, pue: e.target.value })} /></label>
        </div>

        <div className="drawer-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit}>Provision Node</button>
        </div>
      </div>
    </div>
  );
}
