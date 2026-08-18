// Port of backend/app/engines/migration.py — same FSM, same verify() rule.

export const STAGE_ORDER = ["REQUESTED", "VALIDATING", "PREPARING", "TRANSFERRING", "SWITCHING", "VERIFYING", "COMPLETED"];
export const STAGE_DURATIONS_S = { VALIDATING: 1, PREPARING: 2, SWITCHING: 1, VERIFYING: 1 };

export function transferSeconds(stateSizeGb, narrowestCapacityGbps) {
  const usable = Math.max(narrowestCapacityGbps * 0.55, 0.05);
  return Number(((stateSizeGb * 8) / usable).toFixed(1));
}

export function nextStage(current) {
  const i = STAGE_ORDER.indexOf(current);
  if (i === -1) return current;
  return i + 1 < STAGE_ORDER.length ? STAGE_ORDER[i + 1] : current;
}

// A migration is verified only if it measurably helped — "no change" is not success.
export function verify(latencyBefore, latencyAfter, slaBefore, slaAfter, riskDelta) {
  const improvedLatency = (latencyBefore - latencyAfter) / Math.max(latencyBefore, 1e-6) > 0.02;
  const improvedSla = slaAfter !== slaBefore && (slaAfter === "HEALTHY" || slaAfter === "AT_RISK") && slaBefore === "VIOLATION";
  const improvedRisk = riskDelta < -0.03;
  return improvedLatency || improvedSla || improvedRisk;
}
