import { useRef, useState } from "react";

// Concept preview only. Nodes drag locally and the palette drops new ones, but
// nothing persists, no engine is wired, and reload/reset reverts everything.
// The real editor's capabilities and scope are a paid-discovery deliverable.

type NodeType = "input" | "agent" | "gate" | "decision" | "terminal";
type Node = { id: number; type: NodeType; label: string; x: number; y: number };

const PALETTE: { type: NodeType; label: string; hint: string }[] = [
  { type: "agent", label: "Agent step", hint: "an AI agent that advises" },
  { type: "decision", label: "Decision gate", hint: "pass / exception branch" },
  { type: "gate", label: "Human approval gate", hint: "a person signs off" },
  { type: "input", label: "Data source", hint: "orders, settlements, feeds" },
];

const SEED: Node[] = [
  { id: 1, type: "input", label: "Order received", x: 40, y: 30 },
  { id: 2, type: "agent", label: "Order Entry & Validation", x: 40, y: 120 },
  { id: 3, type: "gate", label: "Approval gate", x: 320, y: 120 },
  { id: 4, type: "agent", label: "Ship-Date Feasibility", x: 40, y: 220 },
  { id: 5, type: "terminal", label: "Complete", x: 40, y: 320 },
];

const NEW_LABEL: Record<NodeType, string> = {
  agent: "New agent step",
  decision: "New decision gate",
  gate: "New approval gate",
  input: "New data source",
  terminal: "New terminal",
};

export default function Editor() {
  const [nodes, setNodes] = useState<Node[]>(SEED);
  const seq = useRef(100);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; offX: number; offY: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent, id: number) => {
    const node = nodes.find((n) => n.id === id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!node || !rect) return;
    drag.current = {
      id,
      offX: e.clientX - (rect.left + node.x),
      offY: e.clientY - (rect.top + node.y),
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, e.clientX - rect.left - drag.current.offX);
    const y = Math.max(0, e.clientY - rect.top - drag.current.offY);
    setNodes((ns) => ns.map((n) => (n.id === drag.current!.id ? { ...n, x, y } : n)));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("node-type") as NodeType;
    if (!type) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - 70);
    const y = Math.max(0, e.clientY - rect.top - 20);
    setNodes((ns) => [...ns, { id: ++seq.current, type, label: NEW_LABEL[type], x, y }]);
  };

  return (
    <div className="editor-page">
      <div className="concept-banner">
        <span className="badge concept">Concept preview</span>
        <p>
          A sketch of the low-code workflow editor your team asked about. Nodes drag and the
          palette drops new ones, but <strong>nothing here saves and no agents are wired</strong>.
          The real editor's capabilities and scope would be defined in the paid discovery phase.
        </p>
      </div>

      <div className="editor-body">
        <div className="editor-palette">
          <div className="palette-title">Components</div>
          {PALETTE.map((p) => (
            <div
              key={p.type}
              className={`palette-item ${p.type}`}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("node-type", p.type)}
            >
              <span className="palette-label">{p.label}</span>
              <span className="palette-hint">{p.hint}</span>
            </div>
          ))}
          <div className="palette-note">Drag a component onto the canvas →</div>
        </div>

        <div
          className="editor-canvas"
          ref={canvasRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <span className="canvas-watermark">Concept · nothing saves</span>
          {nodes.map((n) => (
            <div
              key={n.id}
              className={`canvas-node ${n.type}`}
              style={{ left: n.x, top: n.y }}
              onPointerDown={(e) => onPointerDown(e, n.id)}
            >
              {n.type === "agent" && <span className="node-badge">AI agent</span>}
              {n.type === "gate" && <span className="node-badge gatebadge">Human</span>}
              <span className="canvas-node-label">{n.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="editor-actions">
        <button className="btn" onClick={() => setNodes(SEED)}>
          ↺ Reset layout
        </button>
        <button className="btn" disabled title="Saving is not part of this concept preview">
          Save workflow
        </button>
        <span className="editor-actions-note">Save is intentionally inactive, this is a concept.</span>
      </div>
    </div>
  );
}
