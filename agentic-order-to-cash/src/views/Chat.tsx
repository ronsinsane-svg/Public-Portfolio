import { useEffect, useRef, useState } from "react";
import { useStore, actions, CHAT_LIMIT, type ChatMessage } from "../store.ts";

const EXAMPLES = [
  "What's Summit Retail Group's contract price for the all-purpose surface cleaner?",
  "Which catalog items are discontinued, and what replaces them?",
  "What early-payment deduction does Harbor Wholesale's contract allow?",
  "How much inventory is on hand for the laundry SKUs?",
];

export default function Chat() {
  const state = useStore();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const asked = state.chat.filter((m) => m.role === "user").length;
  const atLimit = asked >= CHAT_LIMIT;
  const streaming = state.chat.some((m) => m.streaming);
  const isReplay = state.mode === "replay";

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [state.chat]);

  const send = (text: string) => {
    if (isReplay || atLimit || streaming) return;
    actions.sendChat(text);
    setDraft("");
  };

  return (
    <div className="chat-page">
      <p className="scope-note mono">Querying the demo's synthetic dataset · runs live on claude-haiku-4-5</p>

      {isReplay && (
        <div className="chat-blocked">
          Chat runs live against the API and is unavailable in replay mode. Switch the top-bar toggle
          to <strong>LIVE</strong> to ask questions of the dataset.
        </div>
      )}

      <div className="chat-window">
        <div className="chat-list" ref={listRef}>
          {state.chat.length === 0 && !isReplay && (
            <div className="chat-empty">
              <p>Ask the assistant anything about the demo's synthetic catalog, contracts, inventory, or settlements. It answers only from the data, using the same read-only tools the pipeline agents use.</p>
              <div className="chat-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip-btn" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
          {state.chat.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
        </div>

        <div className="chat-input-row">
          <textarea
            className="chat-input"
            value={draft}
            maxLength={500}
            rows={2}
            disabled={isReplay || atLimit}
            placeholder={
              atLimit
                ? "Demo chat limit reached."
                : isReplay
                  ? "Switch to LIVE to chat."
                  : "Ask about the demo data…"
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <button
            className="btn btn-primary"
            disabled={isReplay || atLimit || streaming || !draft.trim()}
            onClick={() => send(draft)}
          >
            {streaming ? "…" : "Send"}
          </button>
        </div>

        <div className="chat-foot">
          {atLimit ? (
            <span className="chat-limit">
              Demo chat limit reached ({CHAT_LIMIT} questions). Reset the demo to continue.
            </span>
          ) : (
            <span>
              {asked}/{CHAT_LIMIT} questions · read-only · appears in the audit log
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Strip emphasis markers the model occasionally emits despite the plain-prose
// instruction; the bubble renders plain text, so they'd show as literals.
const clean = (t: string) => t.replace(/(\*\*|__|\+\+|==|~~)/g, "");

function Bubble({ m }: { m: ChatMessage }) {
  if (m.role === "user") {
    return (
      <div className="bubble user">
        <div className="bubble-body">{m.text}</div>
      </div>
    );
  }
  return (
    <div className={`bubble assistant${m.error ? " error" : ""}`}>
      <div className="bubble-role">Data Assistant</div>
      {m.tools && m.tools.length > 0 && (
        <div className="bubble-tools mono">
          checked: {[...new Set(m.tools)].join(", ")}
        </div>
      )}
      <div className="bubble-body">
        {clean(m.text)}
        {m.streaming && <span className="caret" />}
      </div>
    </div>
  );
}
