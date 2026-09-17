import type { Transport, StageRequest } from "./engine.ts";
import type { AgentEvent } from "./events.ts";

export type FixtureSet = Record<string, AgentEvent[]>;
export const fixtureKey = (entityId: string, agentId: string) => `${entityId}:${agentId}`;
const MAX_LIVE_INVOCATIONS = 8;

export function liveTransport(baseUrl: string, overrides?: unknown): Transport {
  const root = baseUrl.replace(/\/+$/, "");
  const extra = overrides ? { overrides } : {};

  return async function* transport(
    { agentId, input, runId, stageId }: StageRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    let payload: Record<string, unknown> = { agentId, input, runId, stageId, ...extra };

    for (let invocation = 0; invocation < MAX_LIVE_INVOCATIONS; invocation += 1) {
      if (signal?.aborted) return;
      let continuation: Extract<AgentEvent, { type: "continue" }> | undefined;
      let terminal = false;
      let response: Response;
      try {
        response = await fetch(`${root}/api/agent-run`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
      } catch (err) {
        if (signal?.aborted) return;
        yield {
          type: "error",
          message: err instanceof Error ? err.message : "Transport request failed",
          retryable: true,
        };
        return;
      }

      if (!response.ok) {
        const details = await response.text().catch(() => "");
        yield {
          type: "error",
          message: details
            ? `HTTP ${response.status} ${response.statusText}: ${details}`
            : `HTTP ${response.status} ${response.statusText}`,
          retryable: true,
        };
        return;
      }

      if (!response.body) {
        yield { type: "error", message: "Response body missing", retryable: true };
        return;
      }

      for await (const event of readSseEvents(response.body, signal)) {
        if (event.type === "continue") {
          continuation = event;
          continue;
        }
        if (event.type === "done") {
          continue;
        }
        if (event.type === "verdict" || event.type === "error") {
          terminal = true;
        }
        yield event;
      }

      if (signal?.aborted) return;

      if (terminal || !continuation) {
        yield { type: "done" };
        return;
      }

      payload = {
        agentId,
        messages: continuation.messages,
        round: continuation.round,
        forceVerdict: continuation.forceVerdict,
        runId,
        stageId,
        ...extra,
      };
    }

    yield {
      type: "error",
      message: `Continuation safety cap reached after ${MAX_LIVE_INVOCATIONS} invocations`,
      retryable: true,
    };
    yield { type: "done" };
  };
}

export function replayTransport(
  fixtures: FixtureSet,
  opts?: { speed?: number },
): Transport {
  return async function* transport(
    req: StageRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    const key = fixtureKey(req.entityId, req.agentId);
    const events = fixtures[key];
    if (!events) {
      yield { type: "error", message: `No fixture for ${key}`, retryable: false };
      return;
    }

    for (const event of events) {
      if (signal?.aborted) return;
      if (event.type === "continue" || event.type === "done") {
        continue;
      }
      await waitForEvent(event, opts?.speed ?? 1, signal);
      if (signal?.aborted) return;
      yield event;
    }
    if (!signal?.aborted) {
      yield { type: "done" };
    }
  };
}

async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      for (const event of takeCompleteEvents(buffer)) {
        yield event;
      }
      buffer = keepPartialRecord(buffer);
    }

    for (const event of takeCompleteEvents(buffer)) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

function takeCompleteEvents(buffer: string): AgentEvent[] {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const records = normalized.split("\n\n");
  records.pop();
  return records.flatMap((record) => {
    const event = parseRecord(record);
    return event ? [event] : [];
  });
}

function keepPartialRecord(buffer: string): string {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const index = normalized.lastIndexOf("\n\n");
  return index === -1 ? normalized : normalized.slice(index + 2);
}

function parseRecord(record: string): AgentEvent | null {
  const dataLine = record.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) {
    return null;
  }

  try {
    return JSON.parse(dataLine.slice("data: ".length)) as AgentEvent;
  } catch {
    return null;
  }
}

function waitForEvent(
  event: AgentEvent,
  speed: number,
  signal?: AbortSignal,
): Promise<void> {
  const delayMs = jitteredDelay(event, speed);
  if (delayMs === 0 || signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = globalThis.setTimeout(cleanup, delayMs);
    const onAbort = () => cleanup();

    function cleanup() {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function jitteredDelay(event: AgentEvent, speed: number): number {
  if (speed === 0 || speed === Infinity) {
    return 0;
  }

  const [min, max] =
    event.type === "token"
      ? [25, 70]
      : event.type === "tool_call" || event.type === "tool_result"
        ? [300, 900]
        : [100, 250];
  return Math.round((min + Math.random() * (max - min)) / speed);
}
