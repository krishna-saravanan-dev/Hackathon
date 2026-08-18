// Port of backend/app/engines/sla.py — same guards, not refactored.

export function simpleForecast(history) {
  const n = history.length;
  if (n < 3) return history[n - 1] ?? 0;
  const xs = Array.from({ length: n }, (_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = history.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (history[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const slope = num / (den || 1e-6);
  return history[n - 1] + slope * 3; // project 3 ticks ahead
}

export function evaluateSla(latencyMs, limitMs, predictedLatencyMs = null) {
  if (latencyMs > limitMs) return { state: "VIOLATION", risk: 1.0 };
  if (predictedLatencyMs !== null) {
    const projectedBreach = predictedLatencyMs > limitMs * 1.05;
    const material = latencyMs > limitMs * 0.30;
    if (projectedBreach && material) {
      const risk = Math.min(1.0, (predictedLatencyMs - limitMs) / limitMs + 0.5);
      return { state: "AT_RISK", risk: Number(risk.toFixed(3)) };
    }
  }
  const risk = Number(Math.min(0.4, latencyMs / limitMs).toFixed(3));
  return { state: "HEALTHY", risk };
}
