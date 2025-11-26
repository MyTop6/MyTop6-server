// utils/cgviMatrix.js
const ADMIN_CODES = new Set(["997","998","999"]);

const IRN_ROUTES = {
  privacy_violation: "Legal",
  ip_infringement:  "Legal",
  child_safety:     "Trust & Safety",
  self_harm:        "Trust & Safety",
  violent_threats:  "Trust & Safety",
  fraud:            "Risk",
  spam_scam:        "Risk",
};

function severityFromCode(code) {
  if (ADMIN_CODES.has(code)) return 1;
  const maj = Number(String(code).split(".")[0][0] || 1);
  return Math.min(Math.max(maj, 1), 4);
}

function computeCMO(codes) {
  const set = new Set(codes.map(String));
  const nonAdmin = codes.filter(c => !ADMIN_CODES.has(String(c)));

  // Admin-only cases
  if (nonAdmin.length === 0) {
    if (set.has("997")) {
      return { action: "no_action", tag: "reporter_abuse", reason: "Reporter abused reporting", computedAt: new Date() };
    }
    if (set.has("998")) {
      return { action: "no_action", tag: "test_case", reason: "Testing/QA", computedAt: new Date() };
    }
    // 999 or (998+999), etc.
    return { action: "no_action", tag: "no_action_needed", reason: "No action needed", computedAt: new Date() };
  }

  // Real violations: ignore admin codes during outcome calc
  const sev = Math.max(...nonAdmin.map(severityFromCode));
  if (sev >= 4) return { action: "account_suspend", reason: "High severity", computedAt: new Date() };
  if (sev === 3) return { action: "temp_restrict", durationHours: 24, reason: "Medium severity", computedAt: new Date() };
  if (sev === 2) return { action: "content_remove", reason: "Low-mid severity", computedAt: new Date() };
  return { action: "educational_notice", reason: "Low severity", computedAt: new Date() };
}

function defaultEscalation({ irn, cmo, codes }) {
  const has = (code) => codes?.includes?.(code);
  // Optional queue if you want eyes on reporter-abuse reports
  if (has("997")) return "Reporter Quality";
  if (cmo.action === "escalate_legal") return "Legal";
  if (cmo.action === "escalate_trust_safety") return "Trust & Safety";
  return IRN_ROUTES[irn] || null;
}

module.exports = { ADMIN_CODES, computeCMO, defaultEscalation, severityFromCode };