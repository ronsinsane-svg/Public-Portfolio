import { useState } from "react";
import { useStore } from "../store.ts";
import type { WorkflowTemplate, LaneDef, StageDef } from "../../shared/engine.ts";
import { AGENTS } from "../../shared/agents.ts";
import { AGENT_CALL_POLICY } from "../../shared/policy.ts";

// The decision each agent stage evaluates, phrased as the if/then a reader of
// a process-flow diagram would recognize. Derived per stage id; unknown stages
// fall back to a generic gate. Nothing here is hardcoded per template — the
// tree's structure comes from the template JSON, and the pass/exception branch
// is the orchestrator's one universal rule applied to every agent stage.
const DECISION: Record<string, string> = {
  intake: "Order valid? Items active, unit prices match the contract, quantities and ship date OK.",
  fulfillment: "Feasible by the requested ship date, given inventory and true lead time?",
  deduction: "Does the settlement reconcile within the contract's deduction terms?",
};

type SelectedNode =
  | { kind: "agent"; agentId: string; stageLabel: string }
  | { kind: "gate"; stageLabel: string }
  | { kind: "terminal" }
  | { kind: "input"; inputKind: string }
  | { kind: "planned"; stageLabel: string }
  | null;

export default function LogicTree() {
  const state = useStore();
  const [selected, setSelected] = useState<SelectedNode>(null);

  return (
    <div className="tree-page">
      <div className="tree-banner">
        <span className="tree-banner-dot" />
        <p>
          The orchestrator that runs this workflow is <strong>deterministic code, plain rules, not
          AI</strong>. Agents (in blue) only advise. Every decision gate and every write is decided
          by the orchestrator, and every write waits for a human at an amber gate.
        </p>
      </div>

      <div className="tree-layout">
        <div className="tree-canvas">
          {state.templates.map((t) => (
            <TemplateTree key={t.id} template={t} onSelect={setSelected} selected={selected} />
          ))}
        </div>
        <NodeDetail selected={selected} />
      </div>
    </div>
  );
}

function TemplateTree({
  template,
  onSelect,
  selected,
}: {
  template: WorkflowTemplate;
  onSelect: (n: SelectedNode) => void;
  selected: SelectedNode;
}) {
  const wired = template.lanes.some((l) => l.stages.some((s) => s.agentId !== null));
  return (
    <section className="tree-template">
      <div className="tree-template-head">
        <h3>{template.label}</h3>
        {wired ? (
          <span className="badge pass">Active</span>
        ) : (
          <span className="badge gate">Defined, agents not yet wired</span>
        )}
      </div>
      <div className="tree-lanes">
        {template.lanes.map((lane) => (
          <LaneTree
            key={lane.id}
            lane={lane}
            onSelect={onSelect}
            selected={selected}
          />
        ))}
      </div>
    </section>
  );
}

function LaneTree({
  lane,
  onSelect,
  selected,
}: {
  lane: LaneDef;
  onSelect: (n: SelectedNode) => void;
  selected: SelectedNode;
}) {
  const agentStages = lane.stages.filter((s) => s.agentId !== null);
  return (
    <div className="lane-tree">
      <div className="lane-tree-head">
        <span className="lane-title">{lane.label}</span>
        <span className="lane-kind mono">{lane.inputKind}</span>
      </div>

      <button
        className="flow-node input"
        onClick={() => onSelect({ kind: "input", inputKind: lane.inputKind })}
      >
        <span className="node-label">{lane.inputKind} received</span>
      </button>

      {lane.stages.map((stage, i) => {
        if (stage.agentId !== null) {
          const nextAgent = agentStages[agentStages.indexOf(stage) + 1];
          const nextLabel = nextAgent ? nextAgent.label : "Complete";
          return (
            <StageBlock
              key={stage.id}
              stage={stage}
              nextLabel={nextLabel}
              onSelect={onSelect}
              selected={selected}
            />
          );
        }
        if (stage.id === "complete") {
          return (
            <div key={stage.id}>
              <Connector />
              <button
                className={`flow-node terminal${sel(selected, "terminal") ? " on" : ""}`}
                onClick={() => onSelect({ kind: "terminal" })}
              >
                <span className="node-label">Complete</span>
                <span className="node-sub">auto-completed, no human sign-off</span>
              </button>
            </div>
          );
        }
        // planned marker stage (purchase-to-payment)
        return (
          <div key={stage.id}>
            <Connector />
            <button
              className={`flow-node planned${
                selected?.kind === "planned" && selected.stageLabel === stage.label ? " on" : ""
              }`}
              onClick={() => onSelect({ kind: "planned", stageLabel: stage.label })}
            >
              <span className="node-label">{stage.label}</span>
              <span className="node-sub">step {i + 1}, not yet wired</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function StageBlock({
  stage,
  nextLabel,
  onSelect,
  selected,
}: {
  stage: StageDef;
  nextLabel: string;
  onSelect: (n: SelectedNode) => void;
  selected: SelectedNode;
}) {
  const agent = AGENTS[stage.agentId!];
  const isAgentSel =
    selected?.kind === "agent" && selected.agentId === stage.agentId;
  const isGateSel = selected?.kind === "gate" && selected.stageLabel === stage.label;
  return (
    <div>
      <Connector />
      <button
        className={`flow-node agent${isAgentSel ? " on" : ""}`}
        onClick={() =>
          onSelect({ kind: "agent", agentId: stage.agentId!, stageLabel: stage.label })
        }
      >
        <span className="node-badge">AI agent</span>
        <span className="node-label">{stage.label}</span>
        <span className="node-sub mono">{agent?.model}</span>
      </button>

      <Connector />
      <div className="decision-row">
        <span className="decision-diamond">◇ {DECISION[stage.agentId!] ?? "Passes validation?"}</span>
        <div className="decision-arms">
          <span className="branch pass">pass → {nextLabel}</span>
          <button
            className={`branch gate${isGateSel ? " on" : ""}`}
            onClick={() => onSelect({ kind: "gate", stageLabel: stage.label })}
          >
            exception → Approval queue (human sign-off)
          </button>
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return <div className="flow-connector" aria-hidden="true" />;
}

function sel(selected: SelectedNode, kind: string) {
  return selected?.kind === kind;
}

// --- detail panel -----------------------------------------------------------

function NodeDetail({ selected }: { selected: SelectedNode }) {
  if (!selected) {
    return (
      <div className="tree-detail">
        <div className="spot-label">Node detail</div>
        <div className="detail-empty">
          Click any node to see what runs there, the tools it may use, and the guardrails that apply.
        </div>
      </div>
    );
  }

  if (selected.kind === "agent") {
    const agent = AGENTS[selected.agentId];
    return (
      <div className="tree-detail">
        <div className="spot-label">AI agent</div>
        <div className="card-head">
          <span className="run-id">{agent.name}</span>
        </div>
        <div className="detail-row">
          <span className="detail-k">Model</span>
          <span className="mono">{agent.model}</span>
        </div>
        <div className="detail-k" style={{ marginTop: 12 }}>Read-only tools</div>
        <div className="chip-row" style={{ marginTop: 6 }}>
          {agent.tools.map((t) => (
            <span className="chip" key={t}>{t}</span>
          ))}
        </div>
        <div className="detail-k" style={{ marginTop: 14 }}>Decision</div>
        <p className="detail-p">
          A <strong>pass</strong> advances automatically. An <strong>exception</strong> always stops
          at the human gate, no confidence score or dollar amount overrides that.
        </p>
        <div className="detail-k" style={{ marginTop: 4 }}>Guardrails at this step</div>
        <ul className="detail-list">
          <li>Only the tools above, enforced server-side. There are no write tools.</li>
          <li>
            Timeout {AGENT_CALL_POLICY.timeoutMs / 1000}s · {AGENT_CALL_POLICY.maxRetries} retry ·
            max {AGENT_CALL_POLICY.maxRoundsPerStage} rounds.
          </li>
          <li>The orchestrator decides what happens with the verdict; the agent cannot.</li>
        </ul>
      </div>
    );
  }

  if (selected.kind === "gate") {
    return (
      <div className="tree-detail">
        <div className="spot-label">Human approval gate</div>
        <div className="card-head">
          <span className="badge gate">Human sign-off</span>
        </div>
        <p className="detail-p">
          A person reviews the agent's cited evidence and proposed fix in the approval queue, then
          approves or rejects.
        </p>
        <ul className="detail-list">
          <li>Approve applies the correction as deterministic code and resumes the pipeline.</li>
          <li>Reject closes the run.</li>
          <li>No agent can perform this write. It executes only on a human click.</li>
        </ul>
      </div>
    );
  }

  if (selected.kind === "terminal") {
    return (
      <div className="tree-detail">
        <div className="spot-label">Terminal</div>
        <div className="card-head">
          <span className="badge pass">Complete</span>
        </div>
        <p className="detail-p">
          The run finished with no exceptions and needed no human sign-off. This is the
          zero-touch path.
        </p>
      </div>
    );
  }

  if (selected.kind === "input") {
    return (
      <div className="tree-detail">
        <div className="spot-label">Entry point</div>
        <p className="detail-p">
          A new {selected.inputKind} enters the pipeline here, as structured EDI, an email, or a
          Scenario Builder case.
        </p>
      </div>
    );
  }

  return (
    <div className="tree-detail">
      <div className="spot-label">Planned step</div>
      <div className="card-head">
        <span className="run-id">{selected.stageLabel}</span>
      </div>
      <p className="detail-p">
        Defined in the template but not yet wired to an agent. The same orchestrator runs it once an
        agent is bound, no new engine code. Scoping this is what the paid discovery phase maps.
      </p>
    </div>
  );
}
