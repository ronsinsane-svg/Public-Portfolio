export type Issue = {
  code: string;
  summary: string;
  evidence: { source: string; ref: string; quote: string }[];
};

export type Verdict = {
  status: "pass" | "exception";
  issues: Issue[];
  // patch is a JSON-encoded string (e.g. the parsed canonical order); strict
  // tool schemas reject free-form "any" values, so it travels serialized.
  proposed_fix: { description: string; patch: string | null } | null;
  confidence: number;
  explanation: string;
};

export const SUBMIT_VERDICT_TOOL = {
  name: "submit_verdict",
  description:
    "Submit the final verdict for this stage. Calling this tool ends your turn and is mandatory when your analysis is complete.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: { type: "string", enum: ["pass", "exception"] },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            code: { type: "string" },
            summary: { type: "string" },
            evidence: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  source: { type: "string" },
                  ref: { type: "string" },
                  quote: { type: "string" },
                },
                required: ["source", "ref", "quote"],
              },
            },
          },
          required: ["code", "summary", "evidence"],
        },
      },
      proposed_fix: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              description: { type: "string" },
              patch: {
                anyOf: [
                  {
                    type: "string",
                    description:
                      "JSON-encoded structured payload, e.g. the parsed canonical order or corrected line",
                  },
                  { type: "null" },
                ],
              },
            },
            required: ["description", "patch"],
          },
          { type: "null" },
        ],
      },
      confidence: { type: "number" },
      explanation: { type: "string" },
    },
    required: ["status", "issues", "proposed_fix", "confidence", "explanation"],
  },
} as const;
