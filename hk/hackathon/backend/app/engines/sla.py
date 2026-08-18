"""SLA state machine: HEALTHY / AT_RISK / VIOLATION.
AT_RISK is reachable from a forecast alone, gated by two guards so a cold
baseline can't be extrapolated into false alarms.
"""


def evaluate_sla(latency_ms: float, limit_ms: float, predicted_latency_ms: float | None = None):
    if latency_ms > limit_ms:
        return "VIOLATION", 1.0
    if predicted_latency_ms is not None:
        projected_breach = predicted_latency_ms > limit_ms * 1.05
        material = latency_ms > limit_ms * 0.30
        if projected_breach and material:
            risk = min(1.0, (predicted_latency_ms - limit_ms) / limit_ms + 0.5)
            return "AT_RISK", round(risk, 3)
    risk = round(min(0.4, latency_ms / limit_ms), 3)
    return "HEALTHY", risk


def simple_forecast(history: list[float]) -> float:
    """OLS trend over the last N samples -> next-tick projection."""
    n = len(history)
    if n < 3:
        return history[-1] if history else 0.0
    xs = list(range(n))
    mean_x = sum(xs) / n
    mean_y = sum(history) / n
    num = sum((xs[i] - mean_x) * (history[i] - mean_y) for i in range(n))
    den = sum((xs[i] - mean_x) ** 2 for i in range(n)) or 1e-6
    slope = num / den
    return history[-1] + slope * 3  # project 3 ticks ahead
