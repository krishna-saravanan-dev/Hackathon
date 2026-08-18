import { create } from "zustand";
import { computeLatencyMs, computePowerW } from "../engines/queueing";
import { simpleForecast, evaluateSla } from "../engines/sla";
import { rankCandidates } from "../engines/optimizer";
import { nextStage, transferSeconds, verify, STAGE_DURATIONS_S } from "../engines/migration";

const SEED = 20260817;

// Node classes -> 3D geometry + default capacity profile (Topology Studio spec)
export const NODE_CLASSES = {
  CORE_HYPERSCALE: { label: "Core Hyperscale", cpu: 192, ram: 512, idleW: 240, dynW: 700, cost: 0.30, reliability: 0.996, shape: "hyperscale" },
  REGIONAL_EDGE: { label: "Regional Edge", cpu: 64, ram: 128, idleW: 90, dynW: 260, cost: 0.42, reliability: 0.991, shape: "edge" },
  MICRO_GATEWAY: { label: "Micro Gateway", cpu: 24, ram: 48, idleW: 45, dynW: 120, cost: 0.55, reliability: 0.985, shape: "gateway" },
};

const DEFAULT_NODES = [
  { id: "core-pnq", name: "Pune Core", nodeClass: "CORE_HYPERSCALE", x: 10, z: -10, baseLatencyMs: 2.0, pue: 1.3 },
  { id: "edge-del", name: "Delhi Edge", nodeClass: "REGIONAL_EDGE", x: -30, z: -40, baseLatencyMs: 1.5, pue: 1.5 },
  { id: "edge-blr", name: "Bangalore Edge", nodeClass: "REGIONAL_EDGE", x: -15, z: 35, baseLatencyMs: 1.5, pue: 1.5 },
  { id: "edge-maa", name: "Chennai Edge", nodeClass: "REGIONAL_EDGE", x: 5, z: 45, baseLatencyMs: 1.5, pue: 1.5 },
  { id: "gw-hyd", name: "Hyderabad Gateway", nodeClass: "MICRO_GATEWAY", x: -5, z: 20, baseLatencyMs: 1.0, pue: 1.6 },
];

const DEFAULT_WORKLOADS = [
  { id: "wl-checkout", name: "Checkout API", nodeId: "edge-del", slaLimitMs: 20 },
  { id: "wl-inference", name: "Fraud Inference", nodeId: "edge-maa", slaLimitMs: 15 },
  { id: "wl-ads", name: "Ad Ranking", nodeId: "gw-hyd", slaLimitMs: 25 },
  { id: "wl-batch", name: "Batch ETL", nodeId: "core-pnq", slaLimitMs: 500 },
];

function buildInitialNode(def) {
  const cls = NODE_CLASSES[def.nodeClass];
  return {
    id: def.id,
    name: def.name,
    nodeClass: def.nodeClass,
    x: def.x, z: def.z,
    cpuCapacity: cls.cpu,
    cpuUsed: cls.cpu * 0.3,
    ramCapacity: cls.ram,
    ramUsed: cls.ram * 0.3,
    baseLatencyMs: def.baseLatencyMs,
    pue: def.pue,
    costPerHr: cls.cost,
    reliability: cls.reliability,
    powerW: cls.idleW,
    temperatureC: 42,
    provenance: "SIMULATED",
    userAdded: false,
    status: "ONLINE",
    _idleW: cls.idleW,
    _dynW: cls.dynW,
    _override: null, // { cpuPct, latencyMs, throughputMbps, tempC } when user overrides
  };
}

function buildInitialWorkload(def) {
  return {
    id: def.id, name: def.name, nodeId: def.nodeId, slaLimitMs: def.slaLimitMs,
    latencyMs: 0, slaState: "HEALTHY", slaRisk: 0, history: [],
  };
}

function nearestHub(node, allNodes) {
  const hubs = allNodes.filter((n) => n.id !== node.id && (n.nodeClass === "CORE_HYPERSCALE" || n.nodeClass === "REGIONAL_EDGE"));
  if (!hubs.length) return null;
  let best = null, bestD = Infinity;
  for (const h of hubs) {
    const d = (h.x - node.x) ** 2 + (h.z - node.z) ** 2;
    if (d < bestD) { bestD = d; best = h; }
  }
  return best?.id ?? null;
}

let nodeCounter = 0;

export const useStore = create((set, get) => ({
  seed: SEED,
  t: 0,
  nodes: DEFAULT_NODES.map(buildInitialNode),
  workloads: DEFAULT_WORKLOADS.map(buildInitialWorkload),
  migrations: [],
  connections: [], // { fromId, toId } glowing lines, recomputed on node add
  selectedNodeId: null,
  eventLog: [],

  // ---------------- Topology Studio: Feature 1 -------------------------
  addNode: (form) => {
    const cls = NODE_CLASSES[form.nodeClass];
    nodeCounter += 1;
    const id = `user-${Date.now().toString(36)}-${nodeCounter}`;
    const node = {
      id,
      name: form.name || `${cls.label} ${nodeCounter}`,
      nodeClass: form.nodeClass,
      x: form.x, z: form.z,
      cpuCapacity: form.maxCpu ?? cls.cpu,
      cpuUsed: (form.maxCpu ?? cls.cpu) * 0.2,
      ramCapacity: form.totalRam ?? cls.ram,
      ramUsed: (form.totalRam ?? cls.ram) * 0.2,
      baseLatencyMs: form.baseLatencyMs ?? 2.0,
      pue: form.pue ?? 1.4,
      costPerHr: cls.cost,
      reliability: cls.reliability,
      powerW: cls.idleW,
      temperatureC: 40,
      provenance: "SIMULATED",
      userAdded: true,
      status: "ONLINE",
      _idleW: cls.idleW,
      _dynW: cls.dynW,
      _override: null,
      _justAdded: true, // drives the drop-in animation, cleared after mount
    };
    set((s) => {
      const nodes = [...s.nodes, node];
      const hubId = nearestHub(node, nodes);
      const connections = hubId ? [...s.connections, { fromId: node.id, toId: hubId }] : s.connections;
      return {
        nodes,
        connections,
        eventLog: [`Provisioned ${node.name} (${cls.label}) — connected to ${hubId ?? "no hub found"}`, ...s.eventLog].slice(0, 20),
      };
    });
    return id;
  },

  removeNode: (nodeId) => set((s) => ({
    nodes: s.nodes.filter((n) => n.id !== nodeId),
    connections: s.connections.filter((c) => c.fromId !== nodeId && c.toId !== nodeId),
    selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
  })),

  clearJustAdded: (nodeId) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, _justAdded: false } : n)),
  })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  // ---------------- Telemetry Override Panel: Feature 2 -----------------
  setOverride: (nodeId, override) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, _override: { ...n._override, ...override } } : n)),
  })),

  clearOverride: (nodeId) => set((s) => ({
    nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, _override: null } : n)),
  })),

  // ---------------- Tick Simulator / Advance Time -----------------------
  // Locks in manual overrides, pushes into the forecast history, evaluates
  // SLA, and — if a breach risk appears — runs the optimizer and triggers
  // a migration automatically. This is the actual orchestration wiring.
  advanceTime: (minutes = 15) => {
    const ticks = Math.max(1, Math.round(minutes / 5)); // 1 tick ~= 5 simulated minutes
    for (let i = 0; i < ticks; i++) get()._tick();
  },

  _tick: () => set((s) => {
    const t = s.t + 1;

    // 1. apply overrides or natural drift to each node's cpuUsed/power/temp
    const nodes = s.nodes.map((n) => {
      if (n.status === "OFFLINE") return n;
      let cpuUsed = n.cpuUsed;
      let temperatureC = n.temperatureC;
      if (n._override && n._override.cpuPct != null) {
        cpuUsed = (n._override.cpuPct / 100) * n.cpuCapacity;
      } else {
        // gentle natural drift so untouched nodes aren't perfectly static
        const drift = (Math.random() - 0.5) * 0.03 * n.cpuCapacity;
        cpuUsed = Math.min(n.cpuCapacity * 0.97, Math.max(0, cpuUsed + drift));
      }
      const powerW = computePowerW({ cpuUsed, cpuCapacity: n.cpuCapacity, idleW: n._idleW, dynW: n._dynW, pue: n.pue });
      if (n._override && n._override.tempC != null) {
        temperatureC = n._override.tempC;
      } else {
        temperatureC = 35 + (cpuUsed / n.cpuCapacity) * 40;
      }
      return { ...n, cpuUsed, powerW, temperatureC };
    });

    // 2. compute latency per workload (override wins if set on its node)
    const workloads = s.workloads.map((w) => {
      const node = nodes.find((n) => n.id === w.nodeId);
      if (!node) return w;
      let latencyMs;
      if (node._override && node._override.latencyMs != null) {
        latencyMs = node._override.latencyMs;
      } else {
        latencyMs = computeLatencyMs({
          cpuUsed: node.cpuUsed, cpuCapacity: node.cpuCapacity, pathLatencyMs: node.baseLatencyMs,
        });
      }
      const history = [...w.history, latencyMs].slice(-30);
      const predicted = simpleForecast(history);
      const { state, risk } = evaluateSla(latencyMs, w.slaLimitMs, predicted);
      return { ...w, latencyMs: Number(latencyMs.toFixed(2)), history, slaState: state, slaRisk: risk };
    });

    let migrations = s.migrations;
    let eventLog = s.eventLog;

    // 3. Feature 3: if any workload is AT_RISK or VIOLATION, run the optimizer
    //    and auto-trigger a migration to the top feasible candidate.
    const breaching = workloads.filter((w) => w.slaState === "VIOLATION" || w.slaState === "AT_RISK");
    for (const w of breaching) {
      const alreadyMigrating = migrations.some((m) => m.workloadId === w.id && !["COMPLETED", "FAILED", "ROLLED_BACK"].includes(m.state));
      if (alreadyMigrating) continue;
      const candidates = nodes.filter((n) => n.status === "ONLINE" && n.id !== w.nodeId);
      if (!candidates.length) continue;
      const predictedLatency = {};
      for (const n of candidates) {
        predictedLatency[n.id] = n._override?.latencyMs ?? computeLatencyMs({ cpuUsed: n.cpuUsed, cpuCapacity: n.cpuCapacity, pathLatencyMs: n.baseLatencyMs });
      }
      const ranked = rankCandidates(candidates, predictedLatency, w.slaLimitMs);
      const best = ranked[0];
      if (best && best.node_id !== w.nodeId) {
        const eta = transferSeconds(4.0, 1.0);
        migrations = [...migrations, {
          id: `mig-${t}-${w.id}`, workloadId: w.id, fromNode: w.nodeId, toNode: best.node_id,
          state: "REQUESTED", startedT: t, etaS: eta, verified: null,
          latencyBefore: w.latencyMs, latencyAfter: null, slaBefore: w.slaState,
          stageStartedT: t, stageLenTicks: 1,
          feasible: best.feasible, total: best.total,
        }];
        eventLog = [`⚠ ${w.name} ${w.slaState} (${w.latencyMs.toFixed(1)}ms) → optimizer selected ${best.node_id}, migration started`, ...eventLog].slice(0, 20);
      }
    }

    // 4. advance any in-flight migrations one stage per tick (simplified for interactivity)
    let workloadsAfterMigration = workloads;
    migrations = migrations.map((m) => {
      if (["COMPLETED", "FAILED", "ROLLED_BACK"].includes(m.state)) return m;
      if (t - m.stageStartedT < m.stageLenTicks) return m;
      const nxt = nextStage(m.state);
      const updated = { ...m, state: nxt, stageStartedT: t, stageLenTicks: STAGE_DURATIONS_S[nxt] ?? 1 };
      if (nxt === "COMPLETED") {
        workloadsAfterMigration = workloadsAfterMigration.map((w) => {
          if (w.id !== m.workloadId) return w;
          const moved = { ...w, nodeId: m.toNode };
          const node = nodes.find((n) => n.id === m.toNode);
          const latencyAfter = node
            ? (node._override?.latencyMs ?? computeLatencyMs({ cpuUsed: node.cpuUsed, cpuCapacity: node.cpuCapacity, pathLatencyMs: node.baseLatencyMs }))
            : w.latencyMs;
          moved.latencyMs = Number(latencyAfter.toFixed(2));
          const { state, risk } = evaluateSla(latencyAfter, w.slaLimitMs, latencyAfter);
          moved.slaState = state;
          moved.slaRisk = risk;
          updated.latencyAfter = moved.latencyMs;
          updated.verified = verify(m.latencyBefore, moved.latencyMs, m.slaBefore, state, risk - w.slaRisk);
          return moved;
        });
        eventLog = [`✓ Migration ${m.id} completed — ${updated.verified ? "VERIFIED" : "NOT verified"} (${m.latencyBefore.toFixed(1)}ms → ${updated.latencyAfter?.toFixed(1)}ms)`, ...eventLog].slice(0, 20);
      }
      return updated;
    });

    return { t, nodes, workloads: workloadsAfterMigration, migrations, eventLog };
  }),

  reset: () => {
    nodeCounter = 0;
    set({
      t: 0,
      nodes: DEFAULT_NODES.map(buildInitialNode),
      workloads: DEFAULT_WORKLOADS.map(buildInitialWorkload),
      migrations: [],
      connections: [],
      selectedNodeId: null,
      eventLog: [],
    });
  },
}));
