import { useState } from "react";
import { useStore, type AuditEntry } from "../store.ts";

type KindFilter = "all" | "tool_call" | "verdict" | "decision" | "error";

export default function AuditLog() {
  const state = useStore();
  const [agent, setAgent] = useState<string>("all");
  const [kind, setKind] = useState<KindFilter>("all");

  const agentIds = [...new Set(state.audit.map((e) => e.agentId).filter(Boolean))] as string[];

  const rows = state.audit
    .filter((e) => (agent === "all" ? true : e.agentId === agent))
    .filter((e) => (kind === "all" ? true : e.kind === kind))
    .slice()
    .reverse();

  if (state.audit.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: "var(--fs-h3)", marginBottom: 8 }}>The record is empty</div>
        Every agent start, tool call, verdict, and human decision lands here as it happens. Ingest a
        batch to populate it.
      </div>
    );
  }

  return (
    <div>
      <div className="audit-filters">
        <FilterGroup
          label="Agent"
          value={agent}
          onChange={setAgent}
          options={["all", ...agentIds]}
        />
        <FilterGroup
          label="Event"
          value={kind}
          onChange={(v) => setKind(v as KindFilter)}
          options={["all", "tool_call", "verdict", "decision", "error"]}
        />
        <span className="audit-count mono">{rows.length} events</span>
      </div>

      <div className="audit-table">
        <div className="audit-head">
          <span>Time</span>
          <span>Entity</span>
          <span>Agent</span>
          <span>Model</span>
          <span>Event</span>
          <span>Tokens</span>
          <span>Latency</span>
          <span>Decision</span>
        </div>
        {rows.map((e) => (
          <AuditRow key={e.id} e={e} />
        ))}
      </div>
    </div>
  );
}

function AuditRow({ e }: { e: AuditEntry }) {
  return (
    <div className="audit-row">
      <span className="mono dim">{new Date(e.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
      <span className="mono">{e.entityId}</span>
      <span className="mono">{e.agentId ?? "—"}</span>
      <span className="mono dim">{e.model ?? "—"}</span>
      <span className="audit-event">
        <span className={`ev-kind ev-${e.kind}`}>{e.kind}</span>
        <span className="ev-detail">{e.detail}</span>
      </span>
      <span className="mono dim">{e.tokens ? `${e.tokens.in}/${e.tokens.out}` : "—"}</span>
      <span className="mono dim">
        {e.latencyMs != null ? `${(e.latencyMs / 1000).toFixed(1)}s` : "—"}
      </span>
      <span>{e.decision ? <DecisionBadge decision={e.decision} /> : null}</span>
    </div>
  );
}

function DecisionBadge({ decision }: { decision: NonNullable<AuditEntry["decision"]> }) {
  const cls =
    decision === "rejected" || decision === "failed"
      ? "fail"
      : decision === "approved" || decision === "auto-complete" || decision === "auto-pass"
        ? "pass"
        : "running";
  return <span className={`badge ${cls}`}>{decision}</span>;
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="filter-group">
      <span className="filter-label">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button key={o} aria-pressed={value === o} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
