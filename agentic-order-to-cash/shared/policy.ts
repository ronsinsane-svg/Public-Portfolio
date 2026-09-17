// The single source of truth for agent-call guardrails. The function enforces
// these; the guardrails panel displays these same values, so the panel is
// provably the policy, not a picture of it.
export const AGENT_CALL_POLICY = {
  timeoutMs: 25_000, // per model round; Netlify hard-kills streaming at 30s
  maxRetries: 1, // network-level retries inside the SDK client
  maxRoundsPerStage: 6, // orchestrator round cap before a stage errors out
} as const;
