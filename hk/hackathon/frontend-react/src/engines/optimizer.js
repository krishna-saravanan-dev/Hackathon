// Port of backend/app/engines/optimizer.py — same 5 objectives, same weights,
// same SLA epsilon-constraint rule. Not refactored, not reinvented.

export const WEIGHTS = { latency: 0.30, cost: 0.20, energy: 0.15, capacity: 0.20, reliability: 0.15 };

function normalize(valuesById, higherIsBetter) {
  const vals = Object.values(valuesById);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = (hi - lo) || 1e-6;
  const out = {};
  for (const [id, v] of Object.entries(valuesById)) {
    const score = (v - lo) / span;
    out[id] = higherIsBetter ? score : 1 - score;
  }
  return out;
}

/**
 * nodes: array of { id, cost_per_hr, power_w, cpu_capacity, cpu_used, reliability }
 * predictedLatency: { [nodeId]: ms }
 * slaLimitMs: number
 * Returns candidates ranked feasible-first, then by total score descending —
 * a candidate predicted to breach the SLA can never outrank one that satisfies it.
 */
export function rankCandidates(nodes, predictedLatency, slaLimitMs) {
  const latById = {}, costById = {}, energyById = {}, capById = {}, relById = {};
  for (const n of nodes) {
    latById[n.id] = predictedLatency[n.id];
    costById[n.id] = n.cost_per_hr;
    energyById[n.id] = n.power_w;
    capById[n.id] = n.cpu_capacity - n.cpu_used;
    relById[n.id] = n.reliability;
  }
  const latNorm = normalize(latById, false);
  const costNorm = normalize(costById, false);
  const energyNorm = normalize(energyById, false);
  const capNorm = normalize(capById, true);
  const relNorm = normalize(relById, true);

  const results = nodes.map((n) => {
    const id = n.id;
    const feasible = predictedLatency[id] <= slaLimitMs;
    const scores = {
      latency: latNorm[id], cost: costNorm[id], energy: energyNorm[id],
      capacity: capNorm[id], reliability: relNorm[id],
    };
    const contributions = {};
    for (const k of Object.keys(scores)) contributions[k] = Number((scores[k] * WEIGHTS[k]).toFixed(4));
    const total = Number(Object.values(contributions).reduce((a, b) => a + b, 0).toFixed(4));
    return {
      node_id: id,
      scores: contributions,
      total,
      feasible,
      reason_excluded: feasible ? null : `predicted ${predictedLatency[id].toFixed(1)}ms exceeds SLA limit ${slaLimitMs.toFixed(0)}ms`,
    };
  });

  results.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1;
    return b.total - a.total;
  });
  return results;
}
