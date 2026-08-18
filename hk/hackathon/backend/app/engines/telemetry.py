"""Correlated telemetry simulator.
Causal chain: demand -> cpu -> queueing delay -> latency -> power -> cost.
Nothing here is LIVE. Every value is SIMULATED and labelled as such upstream.
"""
import math
import random


def queue_factor(u: float) -> float:
    """M/M/1-flavoured queueing curve, capped so latency stays finite."""
    u = min(u, 0.985)
    return 1 + (u ** 2 / max(1 - u, 0.015)) * 0.35


def step_node(node: dict, demand_multiplier: float, dt: float, rng: random.Random) -> None:
    """Advance one node's simulated CPU/power one tick, driven by demand."""
    target_util = min(0.95, node["_base_util"] * demand_multiplier)
    noise = rng.uniform(-0.015, 0.015)
    node["cpu_used"] = max(
        0.0,
        node["cpu_used"] + (target_util * node["cpu_capacity"] - node["cpu_used"]) * 0.35 + noise * node["cpu_capacity"],
    )
    util = node["cpu_used"] / max(node["cpu_capacity"], 1e-6)
    # power model: idle draw + dynamic draw scaled by utilisation^1.3 (transparent, ESTIMATED)
    node["power_w"] = node["_idle_w"] + node["_dyn_w"] * (util ** 1.3)


def compute_latency_ms(node: dict, workload: dict, base_service_ms: float, gpu_speedup: float) -> float:
    util = node["cpu_used"] / max(node["cpu_capacity"], 1e-6)
    compute_ms = (base_service_ms / max(gpu_speedup, 0.1)) * queue_factor(util)
    path_latency = node.get("_path_latency_ms", 4.0)
    return 2 * path_latency + compute_ms
