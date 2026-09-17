#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  applyApproval,
  createRun,
  currentStage,
  driveRun,
} from "../shared/engine.ts";
import {
  fixtureKey,
  liveTransport,
} from "../shared/transport.ts";
import { loadScenarios } from "./run-scenarios.mjs";

const DEFAULT_BASE = "http://localhost:8888";
const DEFAULT_OUT = "fixtures/";

function parseArgs(argv) {
  const opts = {
    base: DEFAULT_BASE,
    out: DEFAULT_OUT,
    scenario: null,
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
      case "--base":
        opts.base = next();
        break;
      case "--out":
        opts.out = next();
        break;
      case "--scenario":
        opts.scenario = parseScenarioFilter(next());
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
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

function summarizeIssues(run, stageId) {
  const verdict = run.verdicts[stageId];
  if (!verdict || verdict.issues.length === 0) {
    return "no issue summary";
  }
  return verdict.issues.map((issue) => issue.summary).join(" | ");
}

function recordingTransport(inner, recordings, failedStages) {
  return async function* transport(req, signal) {
    const key = fixtureKey(req.entityId, req.agentId);
    const events = [];
    let hasError = false;

    for await (const event of inner(req, signal)) {
      events.push(event);
      if (event.type === "error") {
        hasError = true;
      }
      yield event;
    }

    if (hasError) {
      failedStages.add(key);
    } else {
      recordings.set(key, events);
    }
  };
}

async function recordScenario(template, scenario, transport, failedStages) {
  let run = createRun(template, scenario.laneId, scenario.entityId, scenario.input);

  while (run.status === "running") {
    run = await driveRun({ template, run, transport });

    if (run.status === "awaiting_approval") {
      const stage = currentStage(template, run);
      console.log(`${scenario.id} gate ${stage.id}: ${summarizeIssues(run, stage.id)}`);
      run = applyApproval(template, run, true);
    }
  }

  console.log(`${scenario.id} final=${run.status}`);
  if (run.status === "failed") {
    const stage = currentStage(template, run);
    if (stage.agentId) {
      failedStages.add(fixtureKey(run.entityId, stage.agentId));
    }
  }
  return run.status === "complete" || run.status === "rejected";
}

async function writeRecordings(outDir, recordings) {
  await mkdir(outDir, { recursive: true });
  // Merge with the existing index so partial re-records (--scenario) never
  // orphan the fixtures of untouched scenarios.
  let index = {};
  try {
    index = JSON.parse(await readFile(path.join(outDir, "index.json"), "utf8"));
  } catch {
    // no index yet
  }

  for (const [key, events] of recordings) {
    const [entityId, agentId] = key.split(":");
    const filename = `${entityId}.${agentId}.json`;
    index[key] = filename;
    await writeFile(path.join(outDir, filename), `${JSON.stringify(events, null, 2)}\n`);
  }

  await writeFile(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

export async function recordFixtures(opts) {
  const { template, scenarios } = await loadScenarios(opts.scenario);
  const recordings = new Map();
  const failedStages = new Set();
  const transport = recordingTransport(liveTransport(opts.base), recordings, failedStages);
  let failed = false;

  for (const scenario of scenarios) {
    const ok = await recordScenario(template, scenario, transport, failedStages);
    failed ||= !ok;
  }

  for (const key of failedStages) {
    recordings.delete(key);
    console.error(`failed stage: ${key}`);
  }

  await writeRecordings(opts.out, recordings);
  if (failed || failedStages.size > 0) {
    process.exitCode = 1;
  }
}

await recordFixtures(parseArgs(process.argv.slice(2)));
