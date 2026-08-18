import random
import time
import uuid
from .engines import telemetry, sla, optimizer, migration

SEED = 20260817

DEFAULT_NODES = [
    # id, name, city, kind, lat, lon, cpu_cap, mem_gb, idle_w, dyn_w, cost/hr, reliability
    ("edge-del", "Delhi Edge", "Delhi", "edge", 28.6139, 77.2090, 64, 128, 90, 260, 0.42, 0.991),
    ("edge-blr", "Bangalore Edge", "Bangalore", "edge", 12.9716, 77.5946, 64, 128, 90, 260, 0.44, 0.992),
    ("edge-maa", "Chennai Edge", "Chennai", "edge", 13.0827, 80.2707, 48, 96, 75, 220, 0.40, 0.990),
    ("edge-bom", "Mumbai Edge", "Mumbai", "edge", 19.0760, 72.8777, 64, 128, 90, 260, 0.45, 0.991),
    ("edge-hyd", "Hyderabad Edge", "Hyderabad", "edge", 17.3850, 78.4867, 48, 96, 75, 220, 0.41, 0.989),
    ("core-pnq", "Pune Core", "Pune", "core", 18.5204, 73.8567, 192, 512, 240, 700, 0.30, 0.996),
    ("core-ccu", "Kolkata Core", "Kolkata", "core", 22.5726, 88.3639, 160, 384, 210, 620, 0.32, 0.995),
]

WORKLOADS = [
    ("wl-checkout", "Checkout API", "edge-del", 220, 20),
    ("wl-video", "Video Transcode", "edge-blr", 90, 60),
    ("wl-inference", "Fraud Inference", "edge-maa", 140, 15),
    ("wl-analytics", "Realtime Analytics", "edge-bom", 60, 80),
    ("wl-ads", "Ad Ranking", "edge-hyd", 300, 25),
    ("wl-batch", "Batch ETL", "core-pnq", 20, 500),
]

BASE_SERVICE_MS = 6.0
GPU_SPEEDUP = 1.0


class WorldState:
    def __init__(self, seed: int = SEED):
        self.seed = seed
        self.rng = random.Random(seed)
        self.t = 0.0
        self.demo_running = False
        self.migrations: list[dict] = []
        self.history: dict[str, list[float]] = {}
        self._build_topology()

    def _build_topology(self):
        self.nodes: dict[str, dict] = {}
        for nid, name, city, kind, lat, lon, cpu, mem, idle_w, dyn_w, cost, rel in DEFAULT_NODES:
            base_util = 0.35 if kind == "edge" else 0.20
            self.nodes[nid] = {
                "id": nid, "name": name, "city": city, "kind": kind,
                "lat": lat, "lon": lon,
                "cpu_capacity": cpu, "cpu_used": cpu * base_util,
                "mem_capacity_gb": mem, "mem_used_gb": mem * base_util,
                "power_w": idle_w, "cost_per_hr": cost, "reliability": rel,
                "status": "ONLINE", "provenance": "SIMULATED", "user_added": False,
                "_base_util": base_util, "_idle_w": idle_w, "_dyn_w": dyn_w,
                "_path_latency_ms": 3.0 if kind == "core" else 1.5,
            }
        self.workloads: dict[str, dict] = {}
        for wid, name, node_id, rps, limit in WORKLOADS:
            self.workloads[wid] = {
                "id": wid, "name": name, "node_id": node_id, "rps": rps,
                "sla_limit_ms": limit, "latency_ms": 0.0, "sla_state": "HEALTHY",
                "sla_risk": 0.0, "provenance": "DERIVED",
                "_demand_mult": 1.0,
            }

    def add_node(self, name: str, city: str, lat: float, lon: float, kind: str = "edge"):
        nid = f"user-{uuid.uuid4().hex[:6]}"
        self.nodes[nid] = {
            "id": nid, "name": name, "city": city, "kind": kind, "lat": lat, "lon": lon,
            "cpu_capacity": 48, "cpu_used": 48 * 0.25, "mem_capacity_gb": 96, "mem_used_gb": 24,
            "power_w": 75, "cost_per_hr": 0.40, "reliability": 0.988, "status": "ONLINE",
            "provenance": "SIMULATED", "user_added": True,
            "_base_util": 0.25, "_idle_w": 75, "_dyn_w": 220, "_path_latency_ms": 2.0,
        }
        return nid

    def remove_node(self, node_id: str):
        self.nodes.pop(node_id, None)

    def inject_spike(self, node_id: str, multiplier: float = 2.4):
        for w in self.workloads.values():
            if w["node_id"] == node_id:
                w["_demand_mult"] = multiplier

    def clear_faults(self):
        for w in self.workloads.values():
            w["_demand_mult"] = 1.0
        for n in self.nodes.values():
            n["status"] = "ONLINE"

    def tick(self, dt: float = 1.0):
        self.t += dt
        for n in self.nodes.values():
            if n["status"] == "OFFLINE":
                continue
            demand = 1.0
            for w in self.workloads.values():
                if w["node_id"] == n["id"]:
                    demand = max(demand, w.get("_demand_mult", 1.0))
            telemetry.step_node(n, demand, dt, self.rng)

        for w in self.workloads.values():
            node = self.nodes.get(w["node_id"])
            if node is None or node["status"] == "OFFLINE":
                continue
            lat = telemetry.compute_latency_ms(node, w, BASE_SERVICE_MS, GPU_SPEEDUP)
            w["latency_ms"] = round(lat, 2)
            hist = self.history.setdefault(f"lat:{w['id']}", [])
            hist.append(lat)
            if len(hist) > 30:
                hist.pop(0)
            predicted = sla.simple_forecast(hist)
            state, risk = sla.evaluate_sla(lat, w["sla_limit_ms"], predicted)
            w["sla_state"] = state
            w["sla_risk"] = risk

        self._advance_migrations(dt)

    def _advance_migrations(self, dt: float):
        for m in self.migrations:
            if m["state"] in ("COMPLETED", "FAILED", "ROLLED_BACK"):
                continue
            if self.t - m["_stage_started"] >= m.get("_stage_len", 1):
                nxt = migration.next_stage(m["state"])
                m["state"] = nxt
                m["_stage_started"] = self.t
                m["_stage_len"] = migration.STAGE_DURATIONS_S.get(nxt, m.get("eta_s", 2))
                if nxt == "COMPLETED":
                    w = self.workloads.get(m["workload_id"])
                    if w:
                        m["latency_after"] = w["latency_ms"]
                        m["verified"] = migration.verify(
                            m["latency_before"], m["latency_after"],
                            "VIOLATION", w["sla_state"], w["sla_risk"] - 0.5,
                        )

    def optimize(self, workload_id: str):
        w = self.workloads[workload_id]
        candidates = [n for n in self.nodes.values() if n["status"] == "ONLINE"]
        predicted = {}
        for n in candidates:
            predicted[n["id"]] = telemetry.compute_latency_ms(n, w, BASE_SERVICE_MS, GPU_SPEEDUP)
        return optimizer.rank_candidates(candidates, predicted, w["sla_limit_ms"])

    def migrate(self, workload_id: str, to_node: str):
        w = self.workloads[workload_id]
        from_node = w["node_id"]
        state_size_gb = 4.0
        eta = migration.transfer_seconds(state_size_gb, narrowest_capacity_gbps=1.0)
        m = {
            "id": f"mig-{uuid.uuid4().hex[:8]}", "workload_id": workload_id,
            "from_node": from_node, "to_node": to_node, "state": "REQUESTED",
            "started_t": self.t, "eta_s": eta, "verified": None,
            "latency_before": w["latency_ms"], "latency_after": None,
            "_stage_started": self.t, "_stage_len": 0.5,
        }
        self.migrations.append(m)
        w["node_id"] = to_node
        w["_demand_mult"] = 1.0
        return m

    def snapshot(self):
        return {
            "t": self.t, "seed": self.seed,
            "nodes": [{k: v for k, v in n.items() if not k.startswith("_")} for n in self.nodes.values()],
            "workloads": [{k: v for k, v in w.items() if not k.startswith("_")} for w in self.workloads.values()],
            "migrations": [{k: v for k, v in m.items() if not k.startswith("_")} for m in self.migrations],
            "demo_running": self.demo_running,
        }

    def reset(self):
        self.__init__(self.seed)
