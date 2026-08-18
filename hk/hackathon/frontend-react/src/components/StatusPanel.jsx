import React from "react";
import { useStore } from "../store/useStore";

const DOT = { HEALTHY: "#35e0c0", AT_RISK: "#ffb454", VIOLATION: "#ff5c72" };

export default function StatusPanel() {
  const workloads = useStore((s) => s.workloads);
  const migrations = useStore((s) => s.migrations);
  const eventLog = useStore((s) => s.eventLog);

  return (
    <>
      <div className="panel">
        <h2>SLA Status</h2>
        {workloads.map((w) => (
          <div className="sla-row" key={w.id}>
            <span><span className="dot" style={{ background: DOT[w.slaState] }} />{w.name}</span>
            <span>{w.latencyMs.toFixed(1)}ms / {w.slaLimitMs}ms</span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Migrations</h2>
        {migrations.length === 0 && <div className="muted">No migrations yet.</div>}
        {migrations.slice(-6).reverse().map((m) => (
          <div className="mig-row" key={m.id}>
            {m.workloadId} → {m.toNode} <span className="state">{m.state}</span>
            {m.verified !== null && (
              <span className={m.verified ? "ver-true" : "ver-false"}>
                {m.verified ? " ✓ verified" : " ✗ not verified"}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Event Log</h2>
        <div className="event-log">
          {eventLog.length === 0 && <div className="muted">Nothing yet — provision a node or advance time.</div>}
          {eventLog.map((e, i) => <div key={i} className="event-row">{e}</div>)}
        </div>
      </div>
    </>
  );
}
