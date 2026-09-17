import type { Verdict } from "./verdict.ts";

export type AgentEvent =
  | { type: "stage_start"; runId?: string; stageId?: string; agentId: string; model: string }
  | { type: "token"; text: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; summary: string }
  | { type: "verdict"; verdict: Verdict }
  | { type: "usage"; inputTokens: number; outputTokens: number; latencyMs: number }
  | { type: "error"; message: string; retryable: boolean }
  // Netlify kills streaming invocations at a hard 30s (measured on this plan),
  // so a stage runs as one invocation per model round. "continue" carries the
  // conversation state to the next invocation; the live transport consumes it
  // internally and never surfaces it to the engine or UI.
  | { type: "continue"; messages: unknown[]; round: number; forceVerdict: boolean }
  | { type: "done" };
