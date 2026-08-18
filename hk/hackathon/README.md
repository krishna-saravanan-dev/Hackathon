# INFINITY NEXUS PX

**Multi-objective dynamic workload orchestrator for edge–core cloud architectures.**

Two frontends live in this repo now:

- **`frontend/`** — the original vanilla Three.js twin (no build step, served
  directly by the Python backend, `./run.sh` from the repo root).
- **`frontend-react/`** — the new **Interactive Topology & Telemetry Platform**:
  React + React Three Fiber + Zustand, with the Topology Studio, Telemetry
  Override Panel, and live optimizer/migration wiring described below.
  **This one needs `npm install` — see "Running the React app" below.**

---

This is a **from-scratch rebuild** based on the original PS-S04 spec, not an edit
of a prior codebase — no earlier source was available to modify. Read the
"What's real here" section before you present this anywhere.

```
OBSERVE → UNDERSTAND → PREDICT → OPTIMIZE → ACT → VERIFY
```

## What's real here (read this first)

Every value carries a provenance label, same rule as before:

| Label | Meaning |
|---|---|
| `LIVE` | Measured from real infrastructure. **Nothing here carries it.** |
| `SIMULATED` | Produced by the telemetry simulator (`engines/telemetry.py`). |
| `PREDICTED` | Output of the OLS forecast (`engines/sla.py::simple_forecast`). |
| `ESTIMATED` | Power/cost from a transparent published-style model. |
| `DERIVED` | Computed from other state (SLA status, scores). |

City names on the map (Delhi, Bangalore, Chennai, Mumbai, Hyderabad, Pune,
Kolkata) are **labels on simulated nodes**, not live infrastructure in those
cities. Say that out loud when you demo it. The "Add Building" feature
provisions a real in-memory node the optimizer and SLA engine actually use —
but it explicitly warns that it breaks deterministic replay until `/api/reset`.

## Run it

```bash
./run.sh                                       # http://localhost:8000
docker compose up --build                      # container, same thing
```

Nothing needs configuring. `.env.example` lists every tunable. There is no
database in this build — state lives in memory, resets on restart or via
`POST /api/reset`. That's a deliberate honesty choice, not an oversight: no
fake persistence for infrastructure that isn't real.

## Architecture

```
Telemetry (causal sim) → SLA evaluation (OLS forecast) → Optimizer (5-objective
weighted sum + SLA ε-constraint) → Migration (real FSM) → WebSocket → 3D twin
```

```
backend/app/
  schemas.py           typed state
  state.py              WorldState: topology, golden loop, migrations
  engines/
    telemetry.py        causal demand -> cpu -> latency -> power chain
    sla.py               HEALTHY / AT_RISK / VIOLATION + OLS forecast
    optimizer.py         5-objective weighted sum, SLA epsilon-constraint
    migration.py         real state machine, computed transfer time, verify()
  main.py                FastAPI routes, WebSocket, rate limiting, API key
frontend/
  index.html, style.css, app.js    vanilla Three.js digital twin, no build step
```

**Frontend is vanilla JS + Three.js from a CDN, not React.** That's a
deliberate trade: this environment has no network access to `npm install` or
verify a React build compiles, so shipping React would mean handing you code
I couldn't confirm actually runs. Vanilla + CDN runs the moment you open the
page. If you want it rebuilt in React/R3F for a resume-facing repo, that's a
separate pass, and you'd need to `npm install` and build it yourself to
verify it compiles — I can write the source but can't compile-check it here.

## What's genuinely different from a template dashboard

1. **The optimizer is real arithmetic**, not decoration — `/api/optimize/{id}`
   returns the actual per-objective contribution matrix and excludes
   SLA-infeasible candidates with the reason why.
2. **Migration is a real FSM** with computed transfer time
   (`state_size_gb*8 / (bandwidth*0.55)` seconds) and an honest `verify()` —
   a migration that didn't measurably help is reported `NOT verified`.
3. **The 3D twin has no separate animation state.** Window colour, beacon
   pulse, and ring colour are all read directly from the SLA state in the
   WebSocket snapshot — the twin cannot show something the engine isn't
   actually computing.
4. **Add Building is functional, not cosmetic** — the new node is added to
   the real node dict the optimizer scores against, with a visible
   determinism warning.

## What I did NOT add, on purpose

- **No fake mTLS/zero-trust badges.** There's no real mTLS handshake anywhere
  in this build, so a badge claiming one would be exactly the kind of lie the
  provenance system exists to prevent. What's real instead: an in-memory
  rate limiter (20 req/10s per IP) and an optional `X-API-Key` header on
  every mutating route (`main.py::guard_mutating`) — set `NEXUS_API_KEY` in
  `.env` to turn it on.
- **No PII masking.** There is no PII anywhere in this system — all
  telemetry is synthetic infrastructure metrics. Adding a masking layer for
  data that doesn't exist would be theatre, not security.
- **84 unit tests / 21-point acceptance script** from the original README are
  **not reproduced** — those tested a codebase I never had access to. This
  build has been dry-run end-to-end instead (spike injection → SLA
  violation → optimizer ranking → migration → verified completion → reset
  determinism), and that run is reproducible — see below.

## Verifying it yourself

```bash
cd backend
python3 -c "
from app.state import WorldState
w = WorldState()
for _ in range(30): w.tick(1.0)
w.inject_spike(w.workloads['wl-checkout']['node_id'], 3.0)
for _ in range(20): w.tick(1.0)
cands = w.optimize('wl-checkout')
m = w.migrate('wl-checkout', cands[0]['node_id'])
for _ in range(80): w.tick(1.0)
snap = w.snapshot()
mig = next(x for x in snap['migrations'] if x['id'] == m['id'])
print(mig['state'], mig['verified'], mig['latency_before'], '->', mig['latency_after'])
"
```

Expect `COMPLETED True <higher-ms> -> <lower-ms>`. That's the whole golden
loop running for real, no mocked output.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/system/snapshot` | whole world state |
| GET | `/api/system/architecture` | every weight/formula, for judges |
| GET | `/api/nodes`, `/api/workloads`, `/api/migrations` | |
| GET | `/api/optimize/{workload_id}` | ranked candidates + contribution matrix |
| POST | `/api/nodes` | Add Building (rate-limited, optional API key) |
| DELETE | `/api/nodes/{id}` | |
| POST | `/api/migrate`, `/api/scenarios/spike`, `/api/scenarios/clear`, `/api/reset` | |
| WS | `/ws` | `{type:"snapshot", payload: WorldSnapshot}`, 1s tick |

## The Interactive Topology & Telemetry Platform (`frontend-react/`)

### Running the React app

```bash
cd frontend-react
npm install
npm run dev        # http://localhost:5173
```

**This has not been compile-checked.** My sandbox has no network access to
`npm install` anything, so I could not run `npm run dev`, actually render
the R3F canvas, or catch a runtime error in the browser. What I *did* verify:
every plain `.js` file (the ported engines, the Zustand store) passes
`node --check` — real syntax validation. The `.jsx` component files only got
a brace/paren balance check, which catches typos but not JSX or React
mistakes. **Run `npm run dev` yourself before you present this. If it
throws, send me the exact error and I'll fix it — don't assume it works
because it's in a zip.**

### What was ported vs. what's new

The core math — M/M/1-flavoured queueing, the 5-objective weighted-sum
optimizer with the SLA epsilon-constraint, the migration FSM with its honest
`verify()` — is **the same formulas as `backend/app/engines/`**, ported to
JS in `frontend-react/src/engines/`, not refactored or reinvented. That was
a deliberate call: reacting instantly to a slider drag needs the math
running client-side, not round-tripping to FastAPI every tick. The Python
backend is untouched.

### Feature 1 — Topology Studio (`components/TopologyStudio.jsx`)

A drawer for provisioning nodes: name, Node Class (Core Hyperscale / Regional
Edge / Micro Gateway — each maps to a distinct building geometry and default
capacity profile in `store/useStore.js::NODE_CLASSES`), grid X/Z, max CPU,
RAM, base latency, PUE. On submit, `useStore.addNode()` pushes the node into
the Zustand array, computes its nearest hub and adds a connection line, and
the canvas renders it immediately with a drop-in animation
(`Canvas3D.jsx::Building`, `_justAdded` flag).

### Feature 2 — Telemetry Override Panel (`components/TelemetryPanel.jsx`)

Select a node on the canvas, drag CPU/latency/throughput/temperature. These
write into `node._override` in the store — nothing recalculates until you
click **Advance 15 Minutes**, which calls `advanceTime()` → `_tick()`. That's
the "Tick Simulator": it locks in your override, pushes the resulting
latency into each workload's forecast history array, and re-evaluates SLA.

### Feature 3 — Live engine integration (`store/useStore.js::_tick`)

Inside `_tick()`: every workload's SLA state is evaluated against the (possibly
overridden) latency. Any workload that goes `AT_RISK` or `VIOLATION` — including
on a node you just built in Topology Studio — triggers `rankCandidates()` over
every online node, and if a better candidate exists, a migration is created and
advanced through the same FSM stages as the backend, ending in an honest
`verify()` call. Push a custom node's CPU to 90%+ and advance time — this is
the actual path that fires, not a scripted demo.

### Guardrails followed

- **Zustand handles dynamic node add/remove** via array spread, not mutation
  (`set((s) => ({ nodes: [...s.nodes, node] }))`) — no stale-closure bugs on
  fast repeated adds.
- **`React.key`** on every mapped node is `node.id`, generated with a counter +
  timestamp so it's stable and unique even across rapid successive adds.
- **`useMemo`** on building geometry (`Canvas3D.jsx::useBuildingGeometry`),
  keyed on `nodeClass` — adding a tenth node doesn't regenerate geometry for
  the other nine. I have **not** benchmarked actual FPS (no browser access
  here) — verify this yourself with the R3F devtools if you're pushing past
  ~20 nodes.
- Obsidian dark theme + neon HEALTHY/AT_RISK/VIOLATION colors carried over
  from the original vanilla frontend's palette, same hex values.

### What I didn't do

- Didn't touch `backend/app/engines/*.py` — untouched, as instructed.
- Didn't wire `frontend-react` to the FastAPI backend at all. It's fully
  client-side and self-contained; the Python backend and `frontend/` twin
  still exist as their own working thing, unrelated to this one. If you
  want the two unified — one source of truth instead of two parallel
  simulations — that's a real architecture decision (probably: move the
  engines to a shared package, or make FastAPI the source of truth and have
  React subscribe over WebSocket) and worth discussing before I build it,
  not something to silently pick for you.

---

## Known limits (say these before a judge finds them)

- No physical infrastructure attached — everything is `SIMULATED`/`ESTIMATED`.
- No persistence layer — state is in-memory by design (see above).
- Frontend is vanilla Three.js, not the React/R3F stack described in earlier
  drafts — functionally equivalent 3D twin, different implementation.
- Original 84-test/21-check suite not reproduced (different codebase).
- 7 default nodes matches the original demo-scale topology; Add Building
  extends it but explicitly costs you deterministic replay until reset.
- `frontend-react/` is untested end-to-end (no network access to `npm
  install` in the build sandbox) — see "Running the React app" above.
  Two parallel telemetry engines now exist (Python `backend/`, JS
  `frontend-react/src/engines/`) with matching formulas but no shared
  source of truth — a real thing to fix if this goes past demo stage.
