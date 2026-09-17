import type { AgentEvent } from "./events.ts";
import type { Verdict } from "./verdict.ts";

// The orchestrator. Everything that decides "what happens next" in a pipeline
// run lives in this file, as deterministic code. Agents are consulted for
// verdicts; they never choose transitions, never call tools that write, and
// never see this state machine. In production this module runs server-side
// unchanged; it has no browser and no Netlify dependencies, which is why the
// demo can also execute it headless under plain Node.

export type StageDef = {
  id: string;
  label: string;
  // null = a marker stage with no agent (e.g. "complete", or every stage of a
  // template that hasn't been activated yet).
  agentId: string | null;
};

export type LaneDef = {
  id: string;
  label: string;
  inputKind: string; // "order" | "remittance"
  stages: StageDef[];
};

export type WorkflowTemplate = {
  id: string;
  label: string;
  description: string;
  lanes: LaneDef[];
};

export type RunStatus =
  | "running" // an agent stage is eligible to execute
  | "awaiting_approval" // held at the human gate; only applyApproval moves it
  | "complete"
  | "rejected"
  | "failed";

export type Run = {
  id: string;
  templateId: string;
  laneId: string;
  entityId: string; // ORD-xxxx / REM-xxxx, used to key replay fixtures
  input: unknown; // the original order or remittance, verbatim
  stageIndex: number;
  status: RunStatus;
  verdicts: Record<string, Verdict>; // by stage id
  error?: string;
};

// ---------------------------------------------------------------------------
// Pure state transitions. Every rule that governs a run is one of the five
// small functions below; there is deliberately nowhere else for control flow
// to hide.

export function createRun(
  template: WorkflowTemplate,
  laneId: string,
  entityId: string,
  input: unknown,
): Run {
  const lane = laneById(template, laneId);
  if (lane.stages.length === 0) throw new Error(`Lane ${laneId} has no stages`);
  return {
    id: `run-${entityId}`,
    templateId: template.id,
    laneId,
    entityId,
    input,
    stageIndex: 0,
    status: "running",
    verdicts: {},
  };
}

export function currentStage(template: WorkflowTemplate, run: Run): StageDef {
  return laneById(template, run.laneId).stages[run.stageIndex];
}

// Rule 1: a "pass" verdict advances automatically. Rule 2: an "exception"
// verdict ALWAYS stops at the human gate. There is no confidence score, dollar
// amount, or agent phrasing that bypasses rule 2.
export function applyVerdict(
  template: WorkflowTemplate,
  run: Run,
  stageId: string,
  verdict: Verdict,
): Run {
  const next: Run = { ...run, verdicts: { ...run.verdicts, [stageId]: verdict } };
  if (verdict.status === "pass") return advance(template, adoptPatch(next, verdict));
  return { ...next, status: "awaiting_approval" };
}

// Rule 3: only a human decision moves a gated run. Approve resumes the
// pipeline (the deterministic write action the human authorized happens in
// application code, outside any agent); reject closes the run.
export function applyApproval(template: WorkflowTemplate, run: Run, approve: boolean): Run {
  if (run.status !== "awaiting_approval") {
    throw new Error(`applyApproval on run ${run.id} in status ${run.status}`);
  }
  if (!approve) return { ...run, status: "rejected" };
  const gatingVerdict = run.verdicts[currentStage(template, run).id];
  return advance(template, adoptPatch({ ...run, status: "running" }, gatingVerdict));
}

// Rule 6: a verdict's proposed patch (a parsed email order, a corrected line)
// is applied to the run's working entity by THIS code, on advance only, so
// downstream stages see the corrected order. Agents propose; the orchestrator
// applies. A patch behind a gate takes effect only after human approval.
function adoptPatch(run: Run, verdict: Verdict | undefined): Run {
  const patch = verdict?.proposed_fix?.patch;
  if (typeof patch !== "string") return run;
  try {
    const parsed: unknown = JSON.parse(patch);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return run;
    // notes are advice for the human at the gate; they are consumed there and
    // never travel to downstream agents.
    const { notes: _notes, ...entity } = parsed as Record<string, unknown>;
    const base = typeof run.input === "object" && run.input !== null ? run.input : {};
    return { ...run, input: { ...base, ...entity } };
  } catch {
    return run; // an unparseable patch is advice, not data; ignore it
  }
}

// Rule 4: agent failures fail loudly and hold the run for a human retry; a
// failed stage never advances and never fakes a verdict.
export function applyFailure(run: Run, message: string): Run {
  return { ...run, status: "failed", error: message };
}

function advance(template: WorkflowTemplate, run: Run): Run {
  const lane = laneById(template, run.laneId);
  const nextIndex = run.stageIndex + 1;
  // Reaching a stage with no agent (or the end of the lane) completes the run.
  if (nextIndex >= lane.stages.length || lane.stages[nextIndex].agentId === null) {
    const finalIndex = Math.min(nextIndex, lane.stages.length - 1);
    return { ...run, stageIndex: finalIndex, status: "complete" };
  }
  return { ...run, stageIndex: nextIndex, status: "running" };
}

function laneById(template: WorkflowTemplate, laneId: string): LaneDef {
  const lane = template.lanes.find((l) => l.id === laneId);
  if (!lane) throw new Error(`Unknown lane ${laneId} in template ${template.id}`);
  return lane;
}

// ---------------------------------------------------------------------------
// Driver. Executes one run against a Transport until it completes, gates,
// fails, or the pipeline is paused. The transport is the ONLY place the
// outside world (live API or replay fixtures) enters; the driver cannot tell
// which one it is talking to, so live mode and replay mode exercise identical
// orchestration code.

export type StageRequest = {
  agentId: string;
  input: unknown;
  runId: string;
  stageId: string;
  entityId: string;
};

export type Transport = (
  req: StageRequest,
  signal?: AbortSignal,
) => AsyncIterable<AgentEvent>;

export type DriveOptions = {
  template: WorkflowTemplate;
  run: Run;
  transport: Transport;
  // Read before every stage; flipping it is the kill switch. Rule 5: a paused
  // pipeline dispatches nothing, with no exceptions.
  isPaused?: () => boolean;
  onEvent?: (run: Run, stageId: string, event: AgentEvent) => void;
  onRunUpdate?: (run: Run) => void;
  signal?: AbortSignal;
};

export async function driveRun(opts: DriveOptions): Promise<Run> {
  let run = opts.run;
  while (run.status === "running") {
    if (opts.isPaused?.() || opts.signal?.aborted) return run;
    const stage = currentStage(opts.template, run);
    if (stage.agentId === null) {
      run = { ...run, status: "complete" };
      break;
    }

    let verdict: Verdict | undefined;
    let failure: string | undefined;
    try {
      const events = opts.transport(
        {
          agentId: stage.agentId,
          input: run.input,
          runId: run.id,
          stageId: stage.id,
          entityId: run.entityId,
        },
        opts.signal,
      );
      for await (const event of events) {
        opts.onEvent?.(run, stage.id, event);
        if (event.type === "verdict") verdict = event.verdict;
        if (event.type === "error") failure = event.message;
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : "Transport error";
    }

    run = verdict
      ? applyVerdict(opts.template, run, stage.id, verdict)
      : applyFailure(run, failure ?? "Stream ended without a verdict");
    opts.onRunUpdate?.(run);
  }
  return run;
}
