r"""Migration FSM.
REQUESTED -> VALIDATING -> PREPARING -> TRANSFERRING -> SWITCHING -> VERIFYING -> COMPLETED
                                                       \-> FAILED -> ROLLED_BACK
Transfer duration is computed from state size / narrowest free capacity on
the path, rate-limited to 55% so migrations don't starve user traffic.
"""

STAGE_ORDER = ["REQUESTED", "VALIDATING", "PREPARING", "TRANSFERRING", "SWITCHING", "VERIFYING", "COMPLETED"]
STAGE_DURATIONS_S = {"VALIDATING": 1, "PREPARING": 2, "SWITCHING": 1, "VERIFYING": 1}


def transfer_seconds(state_size_gb: float, narrowest_capacity_gbps: float) -> float:
    usable = max(narrowest_capacity_gbps * 0.55, 0.05)
    return round((state_size_gb * 8) / usable, 1)


def next_stage(current: str) -> str:
    if current not in STAGE_ORDER:
        return current
    i = STAGE_ORDER.index(current)
    return STAGE_ORDER[i + 1] if i + 1 < len(STAGE_ORDER) else current


def verify(latency_before: float, latency_after: float, sla_before: str, sla_after: str, risk_delta: float) -> bool:
    improved_latency = (latency_before - latency_after) / max(latency_before, 1e-6) > 0.02
    improved_sla = sla_after != sla_before and sla_after in ("HEALTHY", "AT_RISK") and sla_before == "VIOLATION"
    improved_risk = risk_delta < -0.03
    return improved_latency or improved_sla or improved_risk
