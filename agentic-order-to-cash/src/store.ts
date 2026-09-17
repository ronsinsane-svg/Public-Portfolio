import { useSyncExternalStore } from "react";
import {
  createRun,
  driveRun,
  applyApproval,
  type Run,
  type WorkflowTemplate,
  type StageDef,
} from "../shared/engine.ts";
import type { AgentEvent } from "../shared/events.ts";
import type { Verdict } from "../shared/verdict.ts";
import { AGENTS } from "../shared/agents.ts";
import { liveTransport, replayTransport, type FixtureSet } from "../shared/transport.ts";
import orderToCash from "../shared/templates/order-to-cash.json" with { type: "json" };
import purchaseToPayment from "../shared/templates/purchase-to-payment.json" with { type: "json" };
import orders from "../shared/data/orders.json" with { type: "json" };
import remittances from "../shared/data/remittances.json" with { type: "json" };

// --- fixtures, bundled for network-free replay (acceptance criterion 7) ------
// Every fixtures/<entityId>.<agentId>.json is compiled into the app, so replay
// mode never touches the network.
const fixtureModules = import.meta.glob("../fixtures/*.json", { eager: true }) as Record<
  string,
  { default: AgentEvent[] }
>;
const FIXTURES: FixtureSet = {};
for (const [filePath, mod] of Object.entries(fixtureModules)) {
  const file = filePath.split("/").pop()!;
  if (file === "index.json") continue;
  const [entityId, agentId] = file.replace(/\.json$/, "").split(".");
  FIXTURES[`${entityId}:${agentId}`] = mod.default;
}

const TEMPLATES = [orderToCash, purchaseToPayment] as unknown as WorkflowTemplate[];
const ORDER_TEMPLATE = TEMPLATES[0];

// --- view model -------------------------------------------------------------

export type StageStatus = "idle" | "running" | "pass" | "gate" | "fail";

export type ToolCallView = { name: string; args: unknown; summary?: string };

export type StageView = {
  stageId: string;
  label: string;
  agentId: string | null;
  status: StageStatus;
  model?: string;
  reasoning: string;
  toolCalls: ToolCallView[];
  verdict?: Verdict;
  usage?: { inputTokens: number; outputTokens: number; latencyMs: number };
};

export type RunView = {
  entityId: string;
  laneId: string;
  entity: unknown;
  run: Run;
  stages: StageView[];
  activeStageId?: string;
};

export type AuditEntry = {
  id: number;
  ts: number;
  entityId: string;
  stageId: string;
  agentId: string | null;
  model?: string;
  kind: "stage_start" | "tool_call" | "verdict" | "decision" | "error";
  detail: string;
  tokens?: { in: number; out: number };
  latencyMs?: number;
  decision?: "auto-pass" | "auto-complete" | "approved" | "rejected" | "failed";
};

export type TransportMode = "live" | "replay";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  tools?: string[];
  error?: boolean;
};

// Per-session cap on the always-live chat, protecting the unpaid demo budget.
export const CHAT_LIMIT = 15;

export type State = {
  template: WorkflowTemplate;
  templates: WorkflowTemplate[];
  runs: RunView[];
  audit: AuditEntry[];
  chat: ChatMessage[];
  paused: boolean;
  mode: TransportMode;
  // Guardrail config, shown in the panel. Default 0 = every variance requires
  // approval — the brief explicitly blesses this default.
  // ponytail: threshold is display + policy statement; the engine gates ALL
  // exceptions regardless, so there is no dollar-parsing here. Add variance
  // extraction only if a "small variance auto-approves" beat is ever requested.
  approvalThresholdUsd: number;
  agents: typeof AGENTS;
};

// --- seed -------------------------------------------------------------------

function seedRuns(): RunView[] {
  const orderRuns = (orders as Array<Record<string, unknown>>)
    .filter((o) => o.status === "new")
    .map((o) => makeRunView(ORDER_TEMPLATE, "orders", o.id as string, o));
  const remitRuns = (remittances as Array<Record<string, unknown>>).map((r) =>
    makeRunView(ORDER_TEMPLATE, "payments", r.remittance_id as string, r),
  );
  // Scenario order makes the demo script readable in the pipeline view.
  return [...orderRuns, ...remitRuns].sort(byScenario);
}

function byScenario(a: RunView, b: RunView): number {
  const sa = (a.entity as { scenario?: number }).scenario ?? 99;
  const sb = (b.entity as { scenario?: number }).scenario ?? 99;
  return sa - sb;
}

function stagesFor(template: WorkflowTemplate, laneId: string): StageView[] {
  const lane = template.lanes.find((l) => l.id === laneId)!;
  return lane.stages
    .filter((s: StageDef) => s.agentId !== null)
    .map((s: StageDef) => ({
      stageId: s.id,
      label: s.label,
      agentId: s.agentId,
      status: "idle" as StageStatus,
      reasoning: "",
      toolCalls: [],
    }));
}

function makeRunView(
  template: WorkflowTemplate,
  laneId: string,
  entityId: string,
  entity: unknown,
): RunView {
  return {
    entityId,
    laneId,
    entity,
    run: createRun(template, laneId, entityId, entity),
    stages: stagesFor(template, laneId),
  };
}

function initialState(mode: TransportMode = "replay"): State {
  return {
    template: ORDER_TEMPLATE,
    templates: TEMPLATES,
    runs: seedRuns(),
    audit: [],
    chat: [],
    paused: false,
    mode,
    approvalThresholdUsd: 0,
    agents: AGENTS,
  };
}

// --- store ------------------------------------------------------------------

let state: State = initialState();
const listeners = new Set<() => void>();
let auditSeq = 0;
let abort: AbortController | null = null;
// Custom Scenario Builder runs: their injected tool data, keyed by entityId.
// A run listed here always executes live (it has no recorded fixture).
let customOverrides: Record<string, unknown> = {};
let customSeq = 0;

function emit() {
  for (const l of listeners) l();
}
function set(next: Partial<State>) {
  state = { ...state, ...next };
  emit();
}
function patchRun(entityId: string, fn: (rv: RunView) => RunView) {
  set({ runs: state.runs.map((rv) => (rv.entityId === entityId ? fn(rv) : rv)) });
}
function patchStage(entityId: string, stageId: string, fn: (s: StageView) => StageView) {
  patchRun(entityId, (rv) => ({
    ...rv,
    stages: rv.stages.map((s) => (s.stageId === stageId ? fn(s) : s)),
  }));
}
function addAudit(e: Omit<AuditEntry, "id" | "ts">) {
  const entry: AuditEntry = { ...e, id: ++auditSeq, ts: Date.now() };
  set({ audit: [...state.audit, entry] });
}
// Usage arrives after the verdict in the stream, so token/latency totals land
// on the verdict row by patching it once the stage's usage is final.
function attachUsageToVerdict(
  entityId: string,
  stageId: string,
  usage: { inputTokens: number; outputTokens: number; latencyMs: number },
) {
  let patched = false;
  const audit = [...state.audit];
  for (let i = audit.length - 1; i >= 0 && !patched; i--) {
    const a = audit[i];
    if (a.entityId === entityId && a.stageId === stageId && a.kind === "verdict") {
      audit[i] = {
        ...a,
        tokens: { in: usage.inputTokens, out: usage.outputTokens },
        latencyMs: usage.latencyMs,
      };
      patched = true;
    }
  }
  if (patched) set({ audit });
}

function transportFor(entityId: string) {
  // Custom runs always go live (no fixture exists); seed runs follow the mode.
  if (entityId in customOverrides) {
    return liveTransport("", customOverrides[entityId]);
  }
  return state.mode === "replay"
    ? replayTransport(FIXTURES, { speed: 1 })
    : liveTransport("");
}

// Translate the raw event stream of one stage into view + audit updates.
function onEvent(entityId: string, stageId: string, ev: AgentEvent) {
  switch (ev.type) {
    case "stage_start":
      patchRun(entityId, (rv) => ({ ...rv, activeStageId: stageId }));
      patchStage(entityId, stageId, (s) => ({
        ...s,
        status: "running",
        model: ev.model,
        reasoning: "",
        toolCalls: [],
      }));
      addAudit({
        entityId,
        stageId,
        agentId: ev.agentId,
        model: ev.model,
        kind: "stage_start",
        detail: `Agent ${ev.agentId} started`,
      });
      break;
    case "token":
      patchStage(entityId, stageId, (s) => ({ ...s, reasoning: s.reasoning + ev.text }));
      break;
    case "tool_call":
      patchStage(entityId, stageId, (s) => ({
        ...s,
        toolCalls: [...s.toolCalls, { name: ev.name, args: ev.args }],
      }));
      addAudit({
        entityId,
        stageId,
        agentId: agentOf(stageId),
        kind: "tool_call",
        detail: `${ev.name}(${truncate(JSON.stringify(ev.args), 80)})`,
      });
      break;
    case "tool_result":
      patchStage(entityId, stageId, (s) => ({
        ...s,
        toolCalls: s.toolCalls.map((t, i) =>
          i === s.toolCalls.length - 1 && t.name === ev.name ? { ...t, summary: ev.summary } : t,
        ),
      }));
      break;
    case "verdict":
      patchStage(entityId, stageId, (s) => ({
        ...s,
        verdict: ev.verdict,
        status: ev.verdict.status === "pass" ? "pass" : "gate",
      }));
      addAudit({
        entityId,
        stageId,
        agentId: agentOf(stageId),
        kind: "verdict",
        detail: ev.verdict.explanation || ev.verdict.status,
        decision: ev.verdict.status === "pass" ? "auto-pass" : undefined,
      });
      break;
    case "usage": {
      const rv = state.runs.find((r) => r.entityId === entityId);
      const prev = rv?.stages.find((s) => s.stageId === stageId)?.usage;
      const total = {
        inputTokens: (prev?.inputTokens ?? 0) + ev.inputTokens,
        outputTokens: (prev?.outputTokens ?? 0) + ev.outputTokens,
        latencyMs: (prev?.latencyMs ?? 0) + ev.latencyMs,
      };
      patchStage(entityId, stageId, (s) => ({ ...s, usage: total }));
      attachUsageToVerdict(entityId, stageId, total);
      break;
    }
    case "error":
      patchStage(entityId, stageId, (s) => ({ ...s, status: "fail" }));
      addAudit({
        entityId,
        stageId,
        agentId: agentOf(stageId),
        kind: "error",
        detail: ev.message,
        decision: "failed",
      });
      break;
    // "continue" / "done" are transport-internal; the engine never sees them.
  }
}

function agentOf(stageId: string): string | null {
  const lane = state.template.lanes.find((l) => l.stages.some((s) => s.id === stageId));
  return lane?.stages.find((s) => s.id === stageId)?.agentId ?? null;
}

function onRunUpdate(entityId: string, run: Run) {
  patchRun(entityId, (rv) => ({ ...rv, run }));
  if (run.status === "complete") {
    addAudit({
      entityId,
      stageId: "complete",
      agentId: null,
      kind: "decision",
      detail: "Run completed",
      decision: "auto-complete",
    });
  }
}

async function drive(entityId: string, attempt = 0): Promise<void> {
  const rv = state.runs.find((r) => r.entityId === entityId);
  if (!rv) return;
  abort ??= new AbortController();
  const finalRun = await driveRun({
    template: state.template,
    run: rv.run,
    transport: transportFor(entityId),
    isPaused: () => state.paused,
    signal: abort.signal,
    onEvent: (r, stageId, ev) => onEvent(entityId, stageId, ev),
    onRunUpdate: (r) => onRunUpdate(entityId, r),
  });
  patchRun(entityId, (r) => ({ ...r, run: finalRun }));

  // Netlify can drop a streaming invocation on a cold start: the stage sends
  // stage_start then the connection cuts with no verdict. That is not a real
  // agent failure, so auto-retry the stage once (live only; HTTP/tool errors
  // carry a different message and are left for the human retry affordance).
  const streamCut =
    finalRun.status === "failed" && /stream ended|body missing/i.test(finalRun.error ?? "");
  if (streamCut && attempt === 0 && !state.paused && !abort.signal.aborted) {
    const stageId = currentStageId(finalRun);
    patchStage(entityId, stageId, (s) => ({
      ...s,
      status: "idle",
      reasoning: "",
      toolCalls: [],
      verdict: undefined,
    }));
    patchRun(entityId, (r) => ({
      ...r,
      run: { ...finalRun, status: "running", error: undefined },
    }));
    await drive(entityId, 1);
  }
}

// --- actions ----------------------------------------------------------------

export const actions = {
  ingestAll() {
    for (const rv of state.runs) {
      if (rv.run.status === "running" && rv.run.stageIndex === 0 && rv.stages[0].status === "idle") {
        void drive(rv.entityId);
      }
    }
  },
  ingest(entityId: string) {
    void drive(entityId);
  },
  approve(entityId: string) {
    const rv = state.runs.find((r) => r.entityId === entityId);
    if (!rv || rv.run.status !== "awaiting_approval") return;
    addAudit({
      entityId,
      stageId: currentStageId(rv.run),
      agentId: agentOf(currentStageId(rv.run)),
      kind: "decision",
      detail: "Human approved the agent's proposed correction",
      decision: "approved",
    });
    const resumed = applyApproval(state.template, rv.run, true);
    patchRun(entityId, (r) => ({ ...r, run: resumed }));
    void drive(entityId);
  },
  reject(entityId: string) {
    const rv = state.runs.find((r) => r.entityId === entityId);
    if (!rv || rv.run.status !== "awaiting_approval") return;
    const rejected = applyApproval(state.template, rv.run, false);
    patchRun(entityId, (r) => ({ ...r, run: rejected }));
    addAudit({
      entityId,
      stageId: currentStageId(rv.run),
      agentId: agentOf(currentStageId(rv.run)),
      kind: "decision",
      detail: "Human rejected the agent's proposed correction",
      decision: "rejected",
    });
  },
  // Graceful recovery: re-run the stage that failed (e.g. a live API hiccup)
  // without losing prior progress. The run resumes exactly where it stopped.
  retry(entityId: string) {
    const rv = state.runs.find((r) => r.entityId === entityId);
    if (!rv || rv.run.status !== "failed") return;
    const stageId = currentStageId(rv.run);
    patchStage(entityId, stageId, (s) => ({
      ...s,
      status: "idle",
      reasoning: "",
      toolCalls: [],
      verdict: undefined,
    }));
    patchRun(entityId, (r) => ({ ...r, run: { ...r.run, status: "running", error: undefined } }));
    void drive(entityId);
  },
  // Inject a Scenario Builder run and drive it live. `overrides` carries any
  // invented entity the read-only tools must resolve (custom remittance);
  // custom orders pass {} since they reference real SKUs and retailers.
  runCustom(entity: { id: string }, laneId: string, overrides: unknown): string {
    const entityId = entity.id;
    const rv = makeRunView(state.template, laneId, entityId, entity);
    customOverrides[entityId] = overrides;
    set({ runs: [...state.runs, rv] });
    void drive(entityId);
    return entityId;
  },
  nextCustomId(prefix: string): string {
    return `${prefix}-CUSTOM-${++customSeq}`;
  },
  // Thin real chat: one read-only Haiku agent over the synthetic dataset,
  // always live (no fixture), bounded by CHAT_LIMIT questions per session.
  sendChat(question: string) {
    const q = question.trim().slice(0, 500);
    if (!q) return;
    const asked = state.chat.filter((m) => m.role === "user").length;
    if (asked >= CHAT_LIMIT) return;
    if (state.chat.some((m) => m.streaming)) return; // one at a time

    const chat: ChatMessage[] = [
      ...state.chat,
      { role: "user", text: q },
      { role: "assistant", text: "", streaming: true, tools: [] },
    ];
    set({ chat });
    const aIdx = chat.length - 1;
    const patchA = (fn: (m: ChatMessage) => ChatMessage) => {
      set({ chat: state.chat.map((m, i) => (i === aIdx ? fn(m) : m)) });
    };

    void (async () => {
      abort ??= new AbortController();
      const transport = liveTransport("");
      let inTok = 0;
      let outTok = 0;
      try {
        for await (const ev of transport(
          { agentId: "assistant", input: q, runId: "chat", stageId: "chat", entityId: "chat" },
          abort.signal,
        )) {
          if (ev.type === "token") {
            patchA((m) => ({ ...m, text: m.text + ev.text }));
          } else if (ev.type === "tool_call") {
            patchA((m) => ({ ...m, tools: [...(m.tools ?? []), ev.name] }));
            // Chat is on the record too — same audit trail as the pipeline.
            addAudit({
              entityId: "chat",
              stageId: "chat",
              agentId: "assistant",
              kind: "tool_call",
              detail: `${ev.name}(${truncate(JSON.stringify(ev.args), 80)})`,
            });
          } else if (ev.type === "usage") {
            inTok += ev.inputTokens;
            outTok += ev.outputTokens;
          } else if (ev.type === "error") {
            patchA((m) => ({
              ...m,
              error: true,
              streaming: false,
              text: m.text || "The assistant call failed. Please try again.",
            }));
            addAudit({
              entityId: "chat",
              stageId: "chat",
              agentId: "assistant",
              kind: "error",
              detail: ev.message,
              decision: "failed",
            });
            return;
          }
        }
        patchA((m) => ({
          ...m,
          streaming: false,
          text: m.text || "(no answer returned, please try again)",
        }));
        addAudit({
          entityId: "chat",
          stageId: "chat",
          agentId: "assistant",
          model: AGENTS.assistant.model,
          kind: "decision",
          detail: `Answered: "${q.slice(0, 70)}"`,
          tokens: { in: inTok, out: outTok },
        });
      } catch {
        patchA((m) => ({
          ...m,
          error: true,
          streaming: false,
          text: m.text || "The assistant call failed. Please try again.",
        }));
      }
    })();
  },
  setPaused(paused: boolean) {
    set({ paused });
  },
  setMode(mode: TransportMode) {
    actions.reset(mode);
  },
  reset(mode: TransportMode = state.mode) {
    abort?.abort();
    abort = null;
    auditSeq = 0;
    customOverrides = {};
    customSeq = 0;
    state = initialState(mode);
    emit();
  },
};

function currentStageId(run: Run): string {
  const lane = state.template.lanes.find((l) => l.id === run.laneId)!;
  return lane.stages[run.stageIndex].id;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

// --- React binding ----------------------------------------------------------

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Dev-only debug handle (stripped from production builds).
if (import.meta.env.DEV) {
  (globalThis as unknown as { __debug?: unknown }).__debug = {
    fixtureKeys: () => Object.keys(FIXTURES),
    state: () => state,
    actions,
  };
}
export function useStore(): State {
  return useSyncExternalStore(subscribe, () => state);
}
