import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@netlify/functions";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUnion,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { AGENTS } from "../../shared/agents.ts";
import type { AgentEvent } from "../../shared/events.ts";
import { TOOL_SCHEMAS, runTool, withWeekday, type ToolOverrides } from "../../shared/tools.ts";
import meta from "../../shared/data/meta.json" with { type: "json" };
import { SUBMIT_VERDICT_TOOL, type Verdict } from "../../shared/verdict.ts";
import { AGENT_CALL_POLICY } from "../../shared/policy.ts";

// One invocation = ONE model round (a single streamed Anthropic call plus any
// local tool execution it requests). Netlify hard-kills streaming invocations
// at 30s on this plan; a bounded single round stays well inside that. When the
// round doesn't end in a verdict, the response finishes with a "continue"
// event carrying the conversation, and the client transport immediately calls
// back to run the next round. The server stays stateless.

type AgentRunRequest = {
  agentId?: unknown;
  input?: unknown;
  messages?: unknown;
  round?: unknown;
  forceVerdict?: unknown;
  runId?: unknown;
  stageId?: unknown;
  overrides?: unknown;
};

type ToolUseBlock = Extract<ContentBlock, { type: "tool_use" }>;

const jsonResponse = (status: number, message: string) =>
  Response.json({ error: message }, { status });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const truncateSummary = (value: unknown): string => {
  const json = JSON.stringify(value);
  if (json.length <= 200) {
    return json;
  }
  return `${json.slice(0, 197)}...`;
};

export default async (req: Request) => {
  const startedAt = Date.now();

  if (req.method !== "POST") {
    return jsonResponse(405, "Method not allowed");
  }

  let body: AgentRunRequest;
  try {
    const parsed: unknown = await req.json();
    if (!isRecord(parsed)) {
      return jsonResponse(400, "Body must be a JSON object");
    }
    body = parsed;
  } catch {
    return jsonResponse(400, "Invalid JSON body");
  }

  if (typeof body.agentId !== "string") {
    return jsonResponse(400, "agentId is required");
  }

  const agent = AGENTS[body.agentId];
  if (!agent) {
    return jsonResponse(400, `Unknown agentId: ${body.agentId}`);
  }

  // Round 0 takes the raw entity as `input`; continuation rounds take the
  // accumulated conversation as `messages`.
  const isContinuation = Array.isArray(body.messages);
  if (!isContinuation && (!Object.hasOwn(body, "input") || body.input === undefined)) {
    return jsonResponse(400, "input is required");
  }
  const round = typeof body.round === "number" && Number.isInteger(body.round) ? body.round : 0;
  const forceVerdict = body.forceVerdict === true;
  if (round >= agent.maxRounds) {
    return jsonResponse(400, `Round ${round} exceeds cap of ${agent.maxRounds}`);
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return jsonResponse(500, "ANTHROPIC_API_KEY is not configured");
  }

  const overrides: ToolOverrides = isRecord(body.overrides)
    ? (body.overrides as ToolOverrides)
    : {};

  const encoder = new TextEncoder();
  const client = new Anthropic({
    apiKey,
    timeout: AGENT_CALL_POLICY.timeoutMs,
    maxRetries: AGENT_CALL_POLICY.maxRetries,
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (event: AgentEvent) => {
        controller.enqueue(
          encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
        );
      };

      const finish = (usage?: { inputTokens: number; outputTokens: number }) => {
        if (closed) {
          return;
        }
        if (usage) {
          send({ type: "usage", ...usage, latencyMs: Date.now() - startedAt });
        }
        send({ type: "done" });
        closed = true;
        controller.close();
      };

      try {
        if (round === 0) {
          send({
            type: "stage_start",
            runId: typeof body.runId === "string" ? body.runId : undefined,
            stageId: typeof body.stageId === "string" ? body.stageId : undefined,
            agentId: agent.id,
            model: agent.model,
          });
        }

        // Chat agents answer in prose (no verdict tool, end_turn terminates).
        // Everything below is gated on this flag; verdict agents are unchanged.
        const chatMode = agent.mode === "chat";
        const allowedTools = new Set(agent.tools);
        const tools = [
          ...agent.tools.map((toolName) => TOOL_SCHEMAS[toolName]),
          ...(chatMode ? [] : [SUBMIT_VERDICT_TOOL]),
        ] as ToolUnion[];
        const payloadLabel =
          agent.id === "deduction" ? "Payment remittance to reconcile:" : "Order to process:";
        const messages: MessageParam[] = isContinuation
          ? (body.messages as MessageParam[])
          : [
              {
                role: "user",
                content: chatMode
                  ? String(body.input)
                  : `${payloadLabel}\n${JSON.stringify(body.input)}`,
              },
            ];

        const anthropicStream = client.messages.stream({
          model: agent.model,
          max_tokens: agent.maxTokens ?? 2048,
          system: `${agent.system}\n\nToday's date is ${withWeekday(meta.today)}.`,
          messages,
          tools,
          ...(forceVerdict
            ? { tool_choice: { type: "tool" as const, name: "submit_verdict" } }
            : {}),
        });

        for await (const event of anthropicStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "token", text: event.delta.text });
          }
        }

        const msg = await anthropicStream.finalMessage();
        const usage = {
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
        };

        if (msg.stop_reason === "tool_use") {
          const toolResults: ToolResultBlockParam[] = [];
          let verdictSent = false;

          for (const block of msg.content) {
            if (block.type !== "tool_use") {
              continue;
            }
            if (block.name === "submit_verdict") {
              send({ type: "verdict", verdict: block.input as Verdict });
              verdictSent = true;
              break;
            }
            toolResults.push(runAgentTool(block, allowedTools, send, overrides));
          }

          if (verdictSent) {
            finish(usage);
            return;
          }
          if (toolResults.length === 0) {
            send({
              type: "error",
              message: "Model stopped for tool use but did not provide a usable tool call.",
              retryable: true,
            });
            finish(usage);
            return;
          }
          if (round + 1 >= agent.maxRounds) {
            send({
              type: "error",
              message: "Agent round cap reached before submit_verdict.",
              retryable: true,
            });
            finish(usage);
            return;
          }
          send({
            type: "continue",
            messages: [
              ...messages,
              { role: "assistant", content: msg.content as ContentBlockParam[] },
              { role: "user", content: toolResults },
            ],
            round: round + 1,
            forceVerdict: false,
          });
          finish(usage);
          return;
        }

        if (msg.stop_reason === "end_turn") {
          // For a chat agent the streamed text IS the answer; end normally.
          if (chatMode) {
            finish(usage);
            return;
          }
          if (forceVerdict || round + 1 >= agent.maxRounds) {
            send({
              type: "error",
              message: "Agent ended its turn without calling submit_verdict.",
              retryable: true,
            });
            finish(usage);
            return;
          }
          send({
            type: "continue",
            messages: [
              ...messages,
              { role: "assistant", content: msg.content as ContentBlockParam[] },
              { role: "user", content: "Call submit_verdict now with your final verdict." },
            ],
            round: round + 1,
            forceVerdict: true,
          });
          finish(usage);
          return;
        }

        send({
          type: "error",
          message: `Agent stopped unexpectedly: ${msg.stop_reason ?? "unknown"}`,
          retryable: true,
        });
        finish(usage);
      } catch (error) {
        send({ type: "error", message: getErrorMessage(error), retryable: true });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
};

const runAgentTool = (
  block: ToolUseBlock,
  allowedTools: Set<string>,
  send: (event: AgentEvent) => void,
  overrides: ToolOverrides,
): ToolResultBlockParam => {
  if (!allowedTools.has(block.name)) {
    const summary = "Tool not permitted for this agent.";
    send({ type: "tool_result", name: block.name, summary });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: summary,
      is_error: true,
    };
  }

  send({ type: "tool_call", name: block.name, args: block.input });

  try {
    const result = runTool(block.name, block.input, overrides);
    const summary = truncateSummary(result);
    send({ type: "tool_result", name: block.name, summary });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(result),
    };
  } catch (error) {
    const message = getErrorMessage(error);
    send({ type: "tool_result", name: block.name, summary: message });
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: message,
      is_error: true,
    };
  }
};

export const config: Config = { path: "/api/agent-run" };
