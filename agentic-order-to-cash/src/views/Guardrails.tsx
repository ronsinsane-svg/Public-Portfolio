import { useStore, actions } from "../store.ts";
import { AGENT_CALL_POLICY } from "../../shared/policy.ts";
import { usd } from "../format.ts";

export default function Guardrails() {
  const state = useStore();
  const agents = Object.values(state.agents);
  const allTools = [...new Set(agents.flatMap((a) => a.tools))].sort();

  return (
    <div className="guard-stack">
      {/* Kill switch */}
      <div className="card">
        <div className="card-head">
          <h3>Kill switch</h3>
          {state.paused ? (
            <span className="badge gate">Paused</span>
          ) : (
            <span className="badge pass">Agents live</span>
          )}
        </div>
        <p className="guard-note">
          Pausing halts all agent dispatch immediately. Nothing in flight can call a tool or reach
          the API while paused; the pipeline resumes exactly where it stopped.
        </p>
        <button
          className={`btn${state.paused ? " btn-primary" : ""}`}
          onClick={() => actions.setPaused(!state.paused)}
        >
          {state.paused ? "▶ Resume all agents" : "⏸ Pause all agents"}
        </button>
      </div>

      {/* Mandatory human gate */}
      <div className="card">
        <div className="card-head">
          <h3>Mandatory human gate on writes</h3>
        </div>
        <p className="guard-note">
          Every write action, approving an order, posting a correction, sending a dispute, requires
          a human click and runs as deterministic code. No agent has a tool that can write, so an
          agent physically cannot mutate anything on its own.
        </p>
        <div className="guard-facts">
          <div className="guard-fact">
            <span className="guard-fact-num mono">{allTools.length}</span>
            <span>read-only tools</span>
          </div>
          <div className="guard-fact">
            <span className="guard-fact-num mono">0</span>
            <span>write tools across all agents</span>
          </div>
        </div>
      </div>

      {/* Per-agent allowlist */}
      <div className="card">
        <div className="card-head">
          <h3>Per-agent tool allowlist</h3>
        </div>
        <p className="guard-note">
          Each agent may call only the tools below. The allowlist is enforced server-side in the
          agent-run function; a call to anything else is rejected before it runs.
        </p>
        {agents.map((a) => (
          <div className="allow-row" key={a.id}>
            <div className="allow-head">
              <span className="allow-name">{a.name}</span>
              <span className="mono allow-meta">
                {a.id} · {a.model}
              </span>
            </div>
            <div className="chip-row">
              {a.tools.map((t) => (
                <span className="chip" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Approval threshold + policy, side by side */}
      <div className="guard-2col">
        <div className="card">
          <div className="card-head">
            <h3>Approval threshold</h3>
          </div>
          <p className="guard-note">
            Any exception with a variance at or above this amount requires human approval.
          </p>
          <div className="policy-line">
            <span>Threshold</span>
            <span className="mono">
              {state.approvalThresholdUsd === 0
                ? `${usd(0)} (all variances gate)`
                : usd(state.approvalThresholdUsd)}
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Timeout &amp; retry policy</h3>
          </div>
          <p className="guard-note">Enforced on every agent call in the function.</p>
          <div className="policy-line">
            <span>Per-round timeout</span>
            <span className="mono">{AGENT_CALL_POLICY.timeoutMs / 1000}s</span>
          </div>
          <div className="policy-line">
            <span>Network retries</span>
            <span className="mono">{AGENT_CALL_POLICY.maxRetries}</span>
          </div>
          <div className="policy-line">
            <span>Max rounds / stage</span>
            <span className="mono">{AGENT_CALL_POLICY.maxRoundsPerStage}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
