// Port of backend/app/engines/telemetry.py — same formulas, not refactored.
// compute_ms = base_service_ms / gpu_speedup * queue(u)
// queue(u) = 1 + u^2/(1-u) * 0.35
// link_latency = base * (1 + 3.6 * congestion^2)   [kept for parity, unused directly here]

export function queueFactor(u) {
  const util = Math.min(u, 0.985);
  return 1 + (util ** 2 / Math.max(1 - util, 0.015)) * 0.35;
}

export function computeLatencyMs({ cpuUsed, cpuCapacity, pathLatencyMs = 2.0, baseServiceMs = 6.0, gpuSpeedup = 1.0 }) {
  const util = cpuUsed / Math.max(cpuCapacity, 1e-6);
  const computeMs = (baseServiceMs / Math.max(gpuSpeedup, 0.1)) * queueFactor(util);
  return 2 * pathLatencyMs + computeMs;
}

// transparent power model: idle draw + dynamic draw scaled by utilisation^1.3
export function computePowerW({ cpuUsed, cpuCapacity, idleW, dynW, pue = 1.4 }) {
  const util = cpuUsed / Math.max(cpuCapacity, 1e-6);
  return (idleW + dynW * util ** 1.3) * pue;
}
