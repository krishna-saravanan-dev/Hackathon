"""Deterministic weighted-sum optimizer over 5 objectives (trimmed from the
7 described in the README's full spec: latency, cost, energy, capacity,
reliability). SLA acts as a hard epsilon-constraint, not just a scored
objective -- a breaching candidate can never outrank a satisfying one.
"""

WEIGHTS = {"latency": 0.30, "cost": 0.20, "energy": 0.15, "capacity": 0.20, "reliability": 0.15}


def normalize(values: dict, higher_is_better: bool) -> dict:
    lo, hi = min(values.values()), max(values.values())
    span = (hi - lo) or 1e-6
    out = {}
    for k, v in values.items():
        score = (v - lo) / span
        out[k] = score if higher_is_better else 1 - score
    return out


def rank_candidates(nodes: list[dict], predicted_latency: dict, sla_limit_ms: float) -> list[dict]:
    lat_norm = normalize({n["id"]: predicted_latency[n["id"]] for n in nodes}, higher_is_better=False)
    cost_norm = normalize({n["id"]: n["cost_per_hr"] for n in nodes}, higher_is_better=False)
    energy_norm = normalize({n["id"]: n["power_w"] for n in nodes}, higher_is_better=False)
    cap_norm = normalize({n["id"]: n["cpu_capacity"] - n["cpu_used"] for n in nodes}, higher_is_better=True)
    rel_norm = normalize({n["id"]: n["reliability"] for n in nodes}, higher_is_better=True)

    results = []
    for n in nodes:
        nid = n["id"]
        feasible = predicted_latency[nid] <= sla_limit_ms
        scores = {
            "latency": lat_norm[nid], "cost": cost_norm[nid], "energy": energy_norm[nid],
            "capacity": cap_norm[nid], "reliability": rel_norm[nid],
        }
        contributions = {k: round(scores[k] * WEIGHTS[k], 4) for k in scores}
        total = sum(contributions.values())
        results.append({
            "node_id": nid,
            "scores": contributions,
            "total": round(total, 4),
            "feasible": feasible,
            "reason_excluded": None if feasible else f"predicted {predicted_latency[nid]:.1f}ms exceeds SLA limit {sla_limit_ms:.0f}ms",
        })
    # feasible candidates always outrank infeasible ones, ties broken by total score
    results.sort(key=lambda r: (not r["feasible"], -r["total"]))
    return results
