import asyncio
import os
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .state import WorldState

API_KEY = os.environ.get("NEXUS_API_KEY", "")  # empty = auth disabled (dev default)
CORS_ORIGINS = ["http://localhost:8000", "http://localhost:5173"]

app = FastAPI(title="NEXUS EDGE")
app.add_middleware(
    CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"],
)

world = WorldState()
_ws_clients: set[WebSocket] = set()

# --- simple in-memory rate limiter for mutating routes -----------------
_rate_bucket: dict[str, list[float]] = {}
RATE_LIMIT = 20        # requests
RATE_WINDOW_S = 10.0


def check_rate_limit(client_ip: str):
    now = time.time()
    bucket = _rate_bucket.setdefault(client_ip, [])
    bucket[:] = [t for t in bucket if now - t < RATE_WINDOW_S]
    if len(bucket) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="rate limit exceeded, slow down")
    bucket.append(now)


def check_api_key(x_api_key: str | None):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid or missing X-API-Key")


def guard_mutating(request: Request, x_api_key: str | None):
    check_rate_limit(request.client.host if request.client else "unknown")
    check_api_key(x_api_key)


# ---------------- read routes ------------------------------------------
@app.get("/api/system/snapshot")
def snapshot():
    return world.snapshot()


@app.get("/api/system/architecture")
def architecture():
    """Judge mode: every algorithm, weight and formula, in one place."""
    from .engines.optimizer import WEIGHTS
    return {
        "objective_weights": WEIGHTS,
        "queueing_model": "compute_ms = base_service_ms / gpu_speedup * (1 + u^2/(1-u) * 0.35)",
        "forecast_model": "OLS trend over last 30 samples, projected 3 ticks ahead",
        "sla_at_risk_guards": {
            "projected_breach_margin": "predicted > limit * 1.05",
            "materiality_floor": "current_latency > limit * 0.30",
        },
        "migration_transfer_formula": "state_size_gb*8 / (narrowest_capacity_gbps * 0.55) seconds",
        "verification_rule": "verified if latency improved >2%, or SLA state improved, or risk fell >0.03",
        "data_labels": ["LIVE (unused in this build)", "SIMULATED", "PREDICTED", "ESTIMATED", "DERIVED"],
    }


@app.get("/api/nodes")
def get_nodes():
    return world.snapshot()["nodes"]


@app.get("/api/workloads")
def get_workloads():
    return world.snapshot()["workloads"]


@app.get("/api/migrations")
def get_migrations():
    return world.snapshot()["migrations"]


@app.get("/api/optimize/{workload_id}")
def get_optimize(workload_id: str):
    if workload_id not in world.workloads:
        raise HTTPException(404, "unknown workload")
    return world.optimize(workload_id)


# ---------------- mutating routes ---------------------------------------
class AddNodeBody(BaseModel):
    name: str
    city: str
    lat: float
    lon: float
    kind: str = "edge"


@app.post("/api/nodes")
def add_node(body: AddNodeBody, request: Request, x_api_key: str | None = Header(default=None)):
    guard_mutating(request, x_api_key)
    nid = world.add_node(body.name, body.city, body.lat, body.lon, body.kind)
    return {
        "id": nid,
        "warning": "Node added at runtime. This breaks byte-identical demo replay until /api/reset.",
        "provenance": "SIMULATED",
    }


@app.delete("/api/nodes/{node_id}")
def delete_node(node_id: str, request: Request, x_api_key: str | None = Header(default=None)):
    guard_mutating(request, x_api_key)
    world.remove_node(node_id)
    return {"ok": True}


class MigrateBody(BaseModel):
    workload_id: str
    to_node: str


@app.post("/api/migrate")
def migrate(body: MigrateBody, request: Request, x_api_key: str | None = Header(default=None)):
    guard_mutating(request, x_api_key)
    if body.workload_id not in world.workloads or body.to_node not in world.nodes:
        raise HTTPException(404, "unknown workload or node")
    return world.migrate(body.workload_id, body.to_node)


class ScenarioBody(BaseModel):
    node_id: str
    multiplier: float = 2.4


@app.post("/api/scenarios/spike")
def scenario_spike(body: ScenarioBody, request: Request, x_api_key: str | None = Header(default=None)):
    guard_mutating(request, x_api_key)
    world.inject_spike(body.node_id, body.multiplier)
    return {"ok": True}


@app.post("/api/scenarios/clear")
def scenario_clear(request: Request, x_api_key: str | None = Header(default=None)):
    guard_mutating(request, x_api_key)
    world.clear_faults()
    return {"ok": True}


@app.post("/api/reset")
def reset(request: Request, x_api_key: str | None = Header(default=None)):
    guard_mutating(request, x_api_key)
    world.reset()
    return {"ok": True}


# ---------------- websocket ---------------------------------------------
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        _ws_clients.discard(ws)


async def _tick_loop():
    while True:
        world.tick(1.0)
        dead = set()
        payload = world.snapshot()
        for ws in list(_ws_clients):
            try:
                await ws.send_json({"type": "snapshot", "payload": payload})
            except Exception:
                dead.add(ws)
        _ws_clients.difference_update(dead)
        await asyncio.sleep(1.0)


@app.on_event("startup")
async def startup():
    asyncio.create_task(_tick_loop())


# ---------------- static frontend ----------------------------------------
FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIR)), name="assets")

    @app.get("/")
    def index():
        return FileResponse(str(FRONTEND_DIR / "index.html"))
