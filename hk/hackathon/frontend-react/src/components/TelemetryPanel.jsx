import React from "react";
import { useStore } from "../store/useStore";

export default function TelemetryPanel() {
  const nodes = useStore((s) => s.nodes);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const setOverride = useStore((s) => s.setOverride);
  const clearOverride = useStore((s) => s.clearOverride);
  const advanceTime = useStore((s) => s.advanceTime);
  const removeNode = useStore((s) => s.removeNode);

  const node = nodes.find((n) => n.id === selectedNodeId);

  if (!node) {
    return (
      <div className="panel">
        <h2>Telemetry Override</h2>
        <p className="muted">Click a building on the canvas to control its live metrics.</p>
        <div className="advance-row">
          <button onClick={() => advanceTime(15)}>Advance 15 Minutes (Trigger Load)</button>
        </div>
      </div>
    );
  }

  const ov = node._override || {};
  const cpuPct = ov.cpuPct ?? Math.round((node.cpuUsed / node.cpuCapacity) * 100);
  const latencyMs = ov.latencyMs ?? "";
  const throughput = ov.throughputMbps ?? 500;
  const tempC = ov.tempC ?? Math.round(node.temperatureC);

  return (
    <div className="panel">
      <h2>Manual Telemetry Override — {node.name}</h2>
      <p className="muted">Manual values lock in on "Advance Time" and feed straight into the SLA forecast and optimizer.</p>

      <label>Current CPU Load: {cpuPct}%
        <input type="range" min="0" max="100" value={cpuPct}
          onChange={(e) => setOverride(node.id, { cpuPct: Number(e.target.value) })} />
      </label>

      <label>Active Network Latency (ms)
        <input type="number" placeholder="auto (queueing model)" value={latencyMs}
          onChange={(e) => setOverride(node.id, { latencyMs: e.target.value === "" ? null : Number(e.target.value) })} />
      </label>

      <label>Rate Efficiency (Mbps): {throughput}
        <input type="range" min="10" max="2000" value={throughput}
          onChange={(e) => setOverride(node.id, { throughputMbps: Number(e.target.value) })} />
      </label>

      <label>Hardware Temperature (°C): {tempC}
        <input type="range" min="20" max="95" value={tempC}
          onChange={(e) => setOverride(node.id, { tempC: Number(e.target.value) })} />
      </label>

      <div className="advance-row">
        <button onClick={() => clearOverride(node.id)}>Clear Overrides</button>
        <button className="primary" onClick={() => advanceTime(15)}>Advance 15 Minutes (Trigger Load)</button>
      </div>

      {cpuPct >= 90 && (
        <div className="warn-note">CPU is at or above 90%. Advancing time will likely trigger an SLA breach and an automatic migration.</div>
      )}

      {node.userAdded && (
        <button className="danger" onClick={() => removeNode(node.id)}>Decommission Node</button>
      )}
    </div>
  );
}
