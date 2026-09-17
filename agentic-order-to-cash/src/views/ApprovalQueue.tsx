import { useStore, actions, type RunView } from "../store.ts";
import type { Verdict } from "../../shared/verdict.ts";
import { SCENARIO_LABEL, scenarioOf } from "../format.ts";

export default function ApprovalQueue() {
  const state = useStore();
  const queued = state.runs.filter((r) => r.run.status === "awaiting_approval");

  if (queued.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: "var(--fs-h3)", marginBottom: 8 }}>No items at the gate</div>
        Everything the agents cleared advanced automatically. Flagged exceptions land here for a
        human decision.
      </div>
    );
  }

  return (
    <div>
      {queued.map((rv) => (
        <ApprovalCard key={rv.entityId} rv={rv} />
      ))}
    </div>
  );
}

function gatingStage(rv: RunView) {
  // The stage whose verdict stopped the run is the last one with an exception.
  return [...rv.stages].reverse().find((s) => s.verdict?.status === "exception");
}

function ApprovalCard({ rv }: { rv: RunView }) {
  const stage = gatingStage(rv);
  const verdict: Verdict | undefined = stage?.verdict;
  if (!stage || !verdict) return null;
  const scenario = scenarioOf(rv.entity);

  return (
    <div className="card gate">
      <div className="card-head">
        <span className="run-id">{rv.entityId}</span>
        <span className="badge gate">At human gate</span>
        <span style={{ fontSize: "var(--fs-micro)", color: "var(--ink-faint)" }}>
          {stage.label}
          {scenario ? ` · ${SCENARIO_LABEL[scenario]}` : ""}
        </span>
      </div>

      <div className="explain">{verdict.explanation}</div>

      {verdict.issues.map((issue, i) => (
        <div key={i} style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, fontSize: "var(--fs-data)" }}>
            <span className="mono" style={{ color: "var(--gate-ink)" }}>
              {issue.code}
            </span>{" "}
            — {issue.summary}
          </div>
          {issue.evidence.map((ev, j) => (
            <div className="evidence" key={j}>
              <div className="ev-ref">
                {ev.source} · {ev.ref}
              </div>
              <div className="ev-quote">{ev.quote}</div>
            </div>
          ))}
        </div>
      ))}

      {verdict.proposed_fix && (
        <div className="fix">
          <div className="fix-label">Proposed fix — drafted, not applied</div>
          {verdict.proposed_fix.description}
        </div>
      )}

      <div className="approve-actions">
        <button className="btn btn-pass" onClick={() => actions.approve(rv.entityId)}>
          Approve &amp; apply
        </button>
        <button className="btn btn-danger" onClick={() => actions.reject(rv.entityId)}>
          Reject
        </button>
      </div>

      <div className="meta-row">
        <span>agent {stage.agentId}</span>
        {stage.model && <span>{stage.model}</span>}
        {stage.usage && <span>{(stage.usage.latencyMs / 1000).toFixed(1)}s</span>}
        <span>conf {Math.round((verdict.confidence ?? 0) * 100)}%</span>
      </div>
    </div>
  );
}
