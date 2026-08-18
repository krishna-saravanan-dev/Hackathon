from pydantic import BaseModel
from typing import Literal, Optional

Provenance = Literal["LIVE", "SIMULATED", "PREDICTED", "ESTIMATED", "DERIVED"]
SLAState = Literal["HEALTHY", "AT_RISK", "VIOLATION"]
MigrationState = Literal[
    "REQUESTED", "VALIDATING", "PREPARING", "TRANSFERRING",
    "SWITCHING", "VERIFYING", "COMPLETED", "FAILED", "ROLLED_BACK"
]


class Node(BaseModel):
    id: str
    name: str
    city: str
    kind: Literal["edge", "core"]
    lat: float
    lon: float
    cpu_capacity: float
    cpu_used: float
    mem_capacity_gb: float
    mem_used_gb: float
    power_w: float
    cost_per_hr: float
    reliability: float          # e.g. 0.993
    status: Literal["ONLINE", "DEGRADED", "OFFLINE"]
    provenance: Provenance = "SIMULATED"
    user_added: bool = False


class Workload(BaseModel):
    id: str
    name: str
    node_id: str
    rps: float
    sla_limit_ms: float
    latency_ms: float
    sla_state: SLAState
    sla_risk: float              # 0..1 predictive risk
    provenance: Provenance = "DERIVED"


class TelemetryPoint(BaseModel):
    t: float
    node_id: str
    cpu_util: float
    latency_ms: float
    power_w: float
    provenance: Provenance = "SIMULATED"


class Migration(BaseModel):
    id: str
    workload_id: str
    from_node: str
    to_node: str
    state: MigrationState
    started_t: float
    eta_s: float
    verified: Optional[bool] = None
    latency_before: Optional[float] = None
    latency_after: Optional[float] = None


class OptimizationCandidate(BaseModel):
    node_id: str
    scores: dict
    total: float
    feasible: bool
    reason_excluded: Optional[str] = None


class WorldSnapshot(BaseModel):
    t: float
    seed: int
    nodes: list[Node]
    workloads: list[Workload]
    migrations: list[Migration]
    demo_running: bool
