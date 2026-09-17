#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import {
  applyApproval,
  createRun,
  currentStage,
  driveRun,
} from "../shared/engine.ts";
import {
  fixtureKey,
  liveTransport,
  replayTransport,
} from "../shared/transport.ts";

const DEFAULT_BASE = "http://localhost:8888";
const DEFAULT_FIXTURES = "fixtures/";

const EXPECTATIONS = new Map([
  [1, { final: "complete", requiredGates: [], warnOnGate: false }],
  [2, { final: "complete", requiredGates: [], warnOnGate: true }],
  [3, { final: "complete", requiredGates: ["intake"], warnOnGate: false }],
  [4, { final: "complete", requiredGates: ["intake"], warnOnGate: false }],
  [5, { final: "complete", requiredGates: ["fulfillment"], warnOnGate: false }],
  [6, { final: "complete", requiredGates: [], warnOnGate: false }],
  [7, { final: "complete", requiredGates: ["deduction"], warnOnGate: false }],
]);

function parseArgs(argv) {
  const opts = {
    transport: "live",
    base: DEFAULT_BASE,
    fixtures: DEFAULT_FIXTURES,
    scenario: null,
    speed: 20,
    selftest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    switch (arg) {
      case "--transport":
        opts.transport = next();
        break;
      case "--base":
        opts.base = next();
        break;
      case "--fixtures":
        opts.fixtures = next();
        break;
      case "--scenario":
        opts.scenario = parseScenarioFilter(next());
        break;
      case "--speed":
        opts.speed = Number(next());
        break;
      case "--selftest":
        opts.selftest = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  if (!["live", "replay"].includes(opts.transport)) {
    throw new Error("--transport must be live or replay");
  }
  if (Number.isNaN(opts.speed)) {
    throw new Error("--speed must be a number");
  }

  return opts;
}

function parseScenarioFilter(value) {
  const scenarios = value.split(",").map((part) => Number(part.trim()));
  if (scenarios.length === 0 || scenarios.some((num) => !Number.isInteger(num))) {
    throw new Error("--scenario must be a comma-separated list of numbers");
  }
  return new Set(scenarios);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function loadScenarios(filter) {
  const [template, orders, remittances] = await Promise.all([
    readJson("shared/templates/order-to-cash.json"),
    readJson("shared/data/orders.json"),
    readJson("shared/data/remittances.json"),
  ]);

  const orderScenarios = orders
    .filter((order) => order.status === "new")
    .map((order) => ({
      id: `S${order.scenario}`,
      number: order.scenario,
      laneId: "orders",
      entityId: order.id,
      input: order,
    }));

  const paymentScenarios = remittances.map((remittance) => ({
    id: `S${remittance.scenario}`,
    number: remittance.scenario,
    laneId: "payments",
    entityId: remittance.remittance_id,
    input: remittance,
  }));

  const scenarios = [...orderScenarios, ...paymentScenarios]
    .filter((scenario) => !filter || filter.has(scenario.number))
    .sort((a, b) => a.number - b.number);

  return { template, scenarios };
}

async function loadFixtures(dir) {
  const fixtures = {};
  const indexPath = path.join(dir, "index.json");

  try {
    const index = await readJson(indexPath);
    await Promise.all(
      Object.entries(index).map(async ([key, filename]) => {
        fixtures[key] = await readJson(path.join(dir, filename));
      }),
    );
    return fixtures;
  } catch (err) {
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  const entries = await readdir(dir);
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json") && entry !== "index.json")
      .map(async (entry) => {
        const basename = entry.slice(0, -".json".length);
        const dot = basename.lastIndexOf(".");
        if (dot === -1) {
          return;
        }
        const entityId = basename.slice(0, dot);
        const agentId = basename.slice(dot + 1);
        fixtures[fixtureKey(entityId, agentId)] = await readJson(path.join(dir, entry));
      }),
  );
  return fixtures;
}

function makeTransport(opts) {
  if (opts.transport === "live") {
    return liveTransport(opts.base);
  }
  return loadFixtures(opts.fixtures).then((fixtures) =>
    replayTransport(fixtures, { speed: opts.speed }),
  );
}

function summarizeIssues(run, stageId) {
  const verdict = run.verdicts[stageId];
  if (!verdict || verdict.issues.length === 0) {
    return "no issue summary";
  }
  return verdict.issues.map((issue) => issue.summary).join(" | ");
}

function sumUsage(events) {
  return events.reduce(
    (total, event) => {
      if (event.type === "usage") {
        total.inputTokens += event.inputTokens;
        total.outputTokens += event.outputTokens;
      }
      return total;
    },
    { inputTokens: 0, outputTokens: 0 },
  );
}

async function runScenario(template, scenario, transport) {
  let run = createRun(template, scenario.laneId, scenario.entityId, scenario.input);
  const gateHistory = [];
  const events = [];
  const startedAt = performance.now();

  while (run.status === "running") {
    run = await driveRun({
      template,
      run,
      transport,
      onEvent: (_run, _stageId, event) => {
        events.push(event);
      },
    });

    if (run.status === "awaiting_approval") {
      const stage = currentStage(template, run);
      const summary = summarizeIssues(run, stage.id);
      gateHistory.push(stage.id);
      console.log(`${scenario.id} gate ${stage.id}: ${summary}`);
      run = applyApproval(template, run, true);
    }
  }

  const usage = sumUsage(events);
  const wallMs = Math.round(performance.now() - startedAt);
  console.log(
    `${scenario.id} gates=${gateHistory.join(",") || "-"} final=${run.status} wall=${wallMs}ms tokens=${usage.inputTokens}/${usage.outputTokens}`,
  );

  return { scenario, run, gateHistory, usage, wallMs };
}

function evaluateResult(result) {
  const expected = EXPECTATIONS.get(result.scenario.number);
  const errors = [];
  const warnings = [];

  if (!expected) {
    errors.push("no expectation configured");
    return { ok: false, warnings, errors };
  }

  if (result.run.status !== expected.final) {
    errors.push(`final status ${result.run.status}, expected ${expected.final}`);
  }

  const actual = result.gateHistory.join(",");
  const required = expected.requiredGates.join(",");
  if (actual !== required) {
    if (
      expected.warnOnGate &&
      expected.requiredGates.length === 0 &&
      result.gateHistory.length > 0
    ) {
      warnings.push(`gated at ${actual}`);
    } else {
      errors.push(`gates ${actual || "-"}, expected ${required || "-"}`);
    }
  }

  return { ok: errors.length === 0, warnings, errors };
}

function printTable(rows) {
  console.log("\nScenario results");
  for (const row of rows) {
    const status = row.ok ? "PASS" : "FAIL";
    const notes = [...row.warnings, ...row.errors].join("; ");
    console.log(`${row.id}\t${status}\t${notes || "-"}`);
  }
}

export async function runScenarios(opts) {
  const { template, scenarios } = await loadScenarios(opts.scenario);
  const transport = await makeTransport(opts);
  const rows = [];
  let failed = false;

  for (const scenario of scenarios) {
    const result = await runScenario(template, scenario, transport);
    const evaluation = evaluateResult(result);
    rows.push({ id: scenario.id, ...evaluation });
    failed ||= !evaluation.ok;
  }

  printTable(rows);
  return failed ? 1 : 0;
}

export async function selftest() {
  const template = {
    id: "selftest",
    label: "Selftest",
    description: "One stage test template",
    lanes: [
      {
        id: "lane",
        label: "Lane",
        inputKind: "selftest",
        stages: [
          { id: "stage", label: "Stage", agentId: "agent" },
          { id: "complete", label: "Complete", agentId: null },
        ],
      },
    ],
  };
  const input = { id: "ENTITY-1" };
  const fixtures = {
    [fixtureKey("ENTITY-1", "agent")]: [
      {
        type: "stage_start",
        runId: "run-ENTITY-1",
        stageId: "stage",
        agentId: "agent",
        model: "selftest",
      },
      {
        type: "verdict",
        verdict: {
          status: "pass",
          issues: [],
          proposed_fix: null,
          confidence: 1,
          explanation: "ok",
        },
      },
      { type: "usage", inputTokens: 1, outputTokens: 2, latencyMs: 3 },
      { type: "done" },
    ],
  };

  const run = createRun(template, "lane", "ENTITY-1", input);
  const finalRun = await driveRun({
    template,
    run,
    transport: replayTransport(fixtures, { speed: Infinity }),
  });

  if (finalRun.status !== "complete") {
    throw new Error(`Selftest failed: final status was ${finalRun.status}`);
  }
  console.log("selftest PASS");
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selftest) {
    await selftest();
  } else {
    process.exitCode = await runScenarios(opts);
  }
}
