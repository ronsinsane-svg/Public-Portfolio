import { useEffect, useRef, useState } from "react";
import { useStore, actions, type RunView, type StageView } from "../store.ts";
import { runLabel, usd } from "../format.ts";

export default function Pipeline() {
  const state = useStore();
  const [selected, setSelected] = useState<string | null>(null);

  // Follow the newest active run into the spotlight unless the user pinned one.
  const [pinned, setPinned] = useState(false);
  const active = state.runs.find((r) => r.run.status === "running" && r.activeStageId);
  const spotlightId = pinned && selected ? selected : (active?.entityId ?? selected);
  const spotlight = state.runs.find((r) => r.entityId === spotlightId) ?? null;

  const lanes = state.template.lanes;

  return (
    <div className="pipe-layout">
      <div>
        {lanes.map((lane) => {
          const runs = state.runs.filter((r) => r.laneId === lane.id);
          if (runs.length === 0) return null;
          return (
            <section className="lane" key={lane.id}>
              <div className="lane-head">
                <span className="lane-title">{lane.label}</span>
                <span className="lane-kind mono">{lane.inputKind}</span>
              </div>
              {runs.map((rv) => (
                <RunRow
                  key={rv.entityId}
                  rv={rv}
                  selected={rv.entityId === spotlightId}
                  onSelect={() => {
                    setSelected(rv.entityId);
                    setPinned(true);
                    // Clicking an un-started item runs just that one, so the
                    // operator can narrate each scenario in isolation.
                    if (isUnstarted(rv)) actions.ingest(rv.entityId);
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>
      <Spotlight rv={spotlight} />
    </div>
  );
}

function stageStatusClass(s: StageView): string {
  return s.status;
}

function isUnstarted(rv: RunView): boolean {
  return (
    rv.run.status === "running" &&
    rv.run.stageIndex === 0 &&
    rv.stages[0]?.status === "idle"
  );
}

function RunRow({
  rv,
  selected,
  onSelect,
}: {
  rv: RunView;
  selected: boolean;
  onSelect: () => void;
}) {
  const custom = (rv.entity as { custom?: boolean }).custom;
  const terminal = rv.run.status;
  return (
    <button className={`run-row${selected ? " selected" : ""}`} onClick={onSelect}>
      <div className="run-head">
        <span className="run-id">
          {rv.entityId}
          {custom && <span className="custom-tag">CUSTOM</span>}
        </span>
        <span className="run-scenario">{runLabel(rv.entity)}</span>
      </div>
      <div className="node-flow">
        {rv.stages.map((s, i) => (
          <span key={s.stageId} style={{ display: "contents" }}>
            {i > 0 && <span className="node-arrow">→</span>}
            <span className={`node ${stageStatusClass(s)}`}>
              <span className="dot" />
              {s.label}
            </span>
          </span>
        ))}
        <span className="node-arrow">→</span>
        <span className={`node ${terminal === "complete" ? "pass" : ""}`}>
          <span className="dot" />
          {terminal === "complete"
            ? "Complete"
            : terminal === "rejected"
              ? "Rejected"
              : terminal === "failed"
                ? "Failed"
                : "Complete"}
        </span>
      </div>
    </button>
  );
}

function Spotlight({ rv }: { rv: RunView | null }) {
  if (!rv) {
    return (
      <div className="spotlight">
        <div className="spot-label">Live agent reasoning</div>
        <div className="spotlight-empty">
          Ingest a batch, or select an item,
          <br />
          to watch its agent reason in real time.
        </div>
      </div>
    );
  }

  // Show the active stage, else the last stage that has any activity.
  const activeStage =
    rv.stages.find((s) => s.stageId === rv.activeStageId) ??
    [...rv.stages].reverse().find((s) => s.reasoning || s.verdict) ??
    rv.stages[0];

  return (
    <div className="spotlight">
      <div className="spot-label">Live agent reasoning</div>
      <div className="spotlight-head">
        <span className="run-id">{rv.entityId}</span>
        <StageBadge stage={activeStage} runStatus={rv.run.status} />
      </div>
      <div style={{ fontSize: "var(--fs-micro)", color: "var(--ink-faint)", marginBottom: 12 }}>
        {activeStage.label}
        {activeStage.model && <span className="mono"> · {activeStage.model}</span>}
      </div>

      <EmailDiff rv={rv} />

      <ReasoningStream text={activeStage.reasoning} streaming={activeStage.status === "running"} />

      {activeStage.toolCalls.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {activeStage.toolCalls.map((t, i) => (
            <div className="toolcall" key={i}>
              <span className="tname">{t.name}</span>
              <span className="tsummary">{t.summary ? `→ ${t.summary}` : "…"}</span>
            </div>
          ))}
        </div>
      )}

      {activeStage.verdict && (
        <div className="meta-row">
          {activeStage.usage && (
            <>
              <span>{activeStage.usage.inputTokens + activeStage.usage.outputTokens} tok</span>
              <span>{(activeStage.usage.latencyMs / 1000).toFixed(1)}s</span>
            </>
          )}
          <span>conf {Math.round((activeStage.verdict.confidence ?? 0) * 100)}%</span>
        </div>
      )}

      {rv.run.status === "awaiting_approval" && (
        <button
          className="btn btn-primary"
          style={{ marginTop: 14, width: "100%" }}
          onClick={() => actions.approve(rv.entityId)}
        >
          Review in approval queue →
        </button>
      )}

      {rv.run.status === "failed" && (
        <div className="fail-notice">
          <div className="fail-msg">
            <span className="badge fail">Agent call failed</span>
            <span>{rv.run.error ?? "The agent stream ended unexpectedly."}</span>
          </div>
          <button className="btn" onClick={() => actions.retry(rv.entityId)}>
            ↺ Retry this stage
          </button>
        </div>
      )}
    </div>
  );
}

// The beat-3 wow moment: raw email in, structured order out. Renders only for
// email orders once intake has parsed them into a canonical order.
function EmailDiff({ rv }: { rv: RunView }) {
  const entity = rv.entity as { type?: string; raw_text?: string };
  if (entity.type !== "email" || !entity.raw_text) return null;
  const intake = rv.stages.find((s) => s.agentId === "intake");
  const patch = intake?.verdict?.proposed_fix?.patch;
  if (typeof patch !== "string") return null;

  let parsed: { retailer_id?: string; requested_ship_date?: string; lines?: Array<{ sku: string; qty: number; unit_price: number }> };
  try {
    parsed = JSON.parse(patch);
  } catch {
    return null;
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="diff">
        <div>
          <div className="col-label">Raw email received</div>
          <div className="raw-email">{entity.raw_text}</div>
        </div>
        <div>
          <div className="col-label">Parsed structured order</div>
          <div className="raw-email" style={{ color: "var(--ink)" }}>
            <div className="parsed-line">
              <span>retailer</span>
              <span>{parsed.retailer_id}</span>
            </div>
            <div className="parsed-line">
              <span>ship by</span>
              <span>{parsed.requested_ship_date}</span>
            </div>
            {parsed.lines?.map((l, i) => (
              <div className="parsed-line" key={i}>
                <span>{l.sku}</span>
                <span>
                  {l.qty} @ {usd(l.unit_price)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StageBadge({ stage, runStatus }: { stage: StageView; runStatus: string }) {
  if (runStatus === "complete") return <span className="badge pass">Complete</span>;
  const map: Record<string, [string, string]> = {
    running: ["running", "Running"],
    pass: ["pass", "Passed"],
    gate: ["gate", "At human gate"],
    fail: ["fail", "Failed"],
    idle: ["running", "Queued"],
  };
  const [cls, label] = map[stage.status] ?? ["running", "—"];
  return <span className={`badge ${cls}`}>{label}</span>;
}

// Strip emphasis markers (**bold**, ++ins++, ==mark==, __u__, ~~s~~) the model
// occasionally emits despite the plain-prose instruction; they'd render as
// literal characters in the plain-text reasoning box. Single "=" in arithmetic
// is untouched.
function cleanReasoning(text: string): string {
  return text.replace(/(\*\*|__|\+\+|==|~~)/g, "");
}

function ReasoningStream({ text, streaming }: { text: string; streaming: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  if (!text && !streaming) {
    return <div className="reasoning" style={{ color: "var(--ink-faint)" }}>Waiting…</div>;
  }
  return (
    <div className="reasoning" ref={ref}>
      {cleanReasoning(text)}
      {streaming && <span className="caret" />}
    </div>
  );
}
