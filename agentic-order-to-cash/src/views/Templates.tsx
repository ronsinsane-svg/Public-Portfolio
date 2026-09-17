import { useStore } from "../store.ts";
import type { WorkflowTemplate } from "../../shared/engine.ts";

export default function Templates() {
  const state = useStore();
  return (
    <div>
      <p className="guard-note" style={{ maxWidth: "70ch", marginBottom: 20 }}>
        Each workflow is defined as a reusable template, configuration, not code. The pipeline below
        renders straight from that definition with no workflow-specific code, so stamping the pattern
        onto the next process is a new template, not a new app.
      </p>
      {state.templates.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  );
}

function TemplateCard({ template }: { template: WorkflowTemplate }) {
  const wired = template.lanes.some((l) => l.stages.some((s) => s.agentId !== null));
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>{template.label}</h3>
        {wired ? (
          <span className="badge pass">Active</span>
        ) : (
          <span className="badge gate">Defined, agents not yet wired</span>
        )}
        <span className="mono" style={{ color: "var(--ink-faint)", fontSize: "var(--fs-micro)" }}>
          {template.id}
        </span>
      </div>
      <p className="guard-note">{template.description}</p>
      {template.lanes.map((lane) => (
        <div className="lane" key={lane.id} style={{ marginBottom: 14 }}>
          <div className="lane-head">
            <span className="lane-title" style={{ fontSize: "var(--fs-body)" }}>
              {lane.label}
            </span>
            <span className="lane-kind mono">{lane.inputKind}</span>
          </div>
          <div className="node-flow">
            {lane.stages.map((s, i) => (
              <span key={s.id} style={{ display: "contents" }}>
                {i > 0 && <span className="node-arrow">→</span>}
                <span className={`node${s.agentId === null ? " node-marker" : ""}`}>
                  <span className="dot" />
                  <span>
                    {s.label}
                    {s.agentId && (
                      <span className="mono node-agent"> {s.agentId}</span>
                    )}
                  </span>
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
