import { useState } from "react";
import "./styles.css";
import { useStore, actions } from "./store.ts";
import Pipeline from "./views/Pipeline.tsx";
import ApprovalQueue from "./views/ApprovalQueue.tsx";
import Guardrails from "./views/Guardrails.tsx";
import AuditLog from "./views/AuditLog.tsx";
import Templates from "./views/Templates.tsx";
import Builder from "./views/Builder.tsx";
import LogicTree from "./views/LogicTree.tsx";
import Chat from "./views/Chat.tsx";
import Editor from "./views/Editor.tsx";

type View =
  | "pipeline"
  | "logic"
  | "approvals"
  | "builder"
  | "chat"
  | "editor"
  | "guardrails"
  | "audit"
  | "templates";

const NAV: { id: View; label: string }[] = [
  { id: "pipeline", label: "Pipeline" },
  { id: "logic", label: "Logic tree" },
  { id: "approvals", label: "Approvals" },
  { id: "builder", label: "Scenario builder" },
  { id: "chat", label: "Ask the data" },
  { id: "editor", label: "Editor" },
  { id: "guardrails", label: "Guardrails" },
  { id: "audit", label: "Audit log" },
  { id: "templates", label: "Templates" },
];

const TITLES: Record<View, string> = {
  pipeline: "Order-to-Cash Pipeline",
  logic: "Workflow Logic Tree",
  approvals: "Approval Queue",
  builder: "Scenario Builder",
  chat: "Ask the Data",
  editor: "Workflow Editor",
  guardrails: "Guardrails",
  audit: "Audit Log",
  templates: "Workflow Templates",
};

export default function App() {
  const state = useStore();
  const [view, setView] = useState<View>("pipeline");
  const queueCount = state.runs.filter((r) => r.run.status === "awaiting_approval").length;

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">Meridian Goods</div>
            <div className="brand-sub">Order-to-Cash Automation</div>
          </div>
        </div>
        {NAV.map((n) => (
          <span key={n.id} style={{ display: "contents" }}>
            {n.id === "guardrails" && <div className="nav-divider" />}
            <button
              className="nav-item"
              aria-current={view === n.id}
              onClick={() => setView(n.id)}
            >
              {n.label}
              {n.id === "approvals" && queueCount > 0 && (
                <span className="nav-count">{queueCount}</span>
              )}
            </button>
          </span>
        ))}
        <div className="sidebar-foot">
          Meridian Goods Co. · Demo
          <br />
          All data synthetic.
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{TITLES[view]}</h1>
          <span className="spacer" />
          <ModeToggle />
          <button className="btn btn-primary" onClick={() => actions.ingestAll()}>
            Ingest batch
          </button>
          <button
            className={`btn${state.paused ? " paused" : ""}`}
            onClick={() => actions.setPaused(!state.paused)}
          >
            {state.paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <button className="btn" onClick={() => actions.reset()}>
            ↺ Reset
          </button>
          <span className="synthetic-tag">SYNTHETIC DATA</span>
        </header>

        <main className="content">
          {view === "pipeline" && <Pipeline />}
          {view === "logic" && <LogicTree />}
          {view === "approvals" && <ApprovalQueue />}
          {view === "builder" && <Builder onRun={() => setView("pipeline")} />}
          {view === "chat" && <Chat />}
          {view === "editor" && <Editor />}
          {view === "guardrails" && <Guardrails />}
          {view === "audit" && <AuditLog />}
          {view === "templates" && <Templates />}
        </main>
      </div>
    </div>
  );
}

function ModeToggle() {
  const state = useStore();
  return (
    <div className="seg" title="Live calls the Anthropic API; Replay runs from recorded fixtures with no network.">
      <button
        aria-pressed={state.mode === "live"}
        onClick={() => actions.setMode("live")}
      >
        LIVE
      </button>
      <button
        aria-pressed={state.mode === "replay"}
        onClick={() => actions.setMode("replay")}
      >
        REPLAY
      </button>
    </div>
  );
}

