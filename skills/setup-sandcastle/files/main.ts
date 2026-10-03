import { readFileSync } from "node:fs";
import { run, claudeCode, type ClaudeCodeOptions } from "@ai-hero/sandcastle";

type Effort = ClaudeCodeOptions["effort"];
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import {
  parseProjectConfig,
  parseRunFlags,
  pickSetting,
  resolveModel,
  defaultEffortFor,
  DEFAULT_MODEL,
} from "./lib.ts";

// Free-form escape hatch: runs Claude Code on .sandcastle/prompt.md in an isolated
// worktree sandbox built from .sandcastle/project.json (image, network, mounts,
// setup), so it reaches the project's services by name and runs the toolchain
// natively — no Docker socket needed.
// This is NOT the task-workflow path: to drain a planned parent use worker.ts,
// which reads the queue from the tracker and verifies the gate itself.
// Usage: node .sandcastle/main.ts [--model <alias|id>] [--effort <low|high>]

const project = parseProjectConfig(readFileSync(".sandcastle/project.json", "utf8"));
const flags = parseRunFlags(process.argv.slice(2));
const model = resolveModel(
  pickSetting({ flag: flags.model, shell: process.env.SANDCASTLE_MODEL }),
  DEFAULT_MODEL,
);
const effort = (pickSetting({ flag: flags.effort, shell: process.env.SANDCASTLE_EFFORT }) ??
  defaultEffortFor(model)) as Effort;

console.log(`Model: ${model} · effort: ${effort}`);

const result = await run({
  agent: claudeCode(model, { effort }),
  sandbox: docker({
    imageName: project.image,
    network: project.network,
    mounts: project.mounts,
  }),
  branchStrategy: { type: "branch", branch: "sandcastle/agent-run" },
  hooks: {
    sandbox: {
      // onSandboxReady hooks run concurrently, so ordered setup must be a single chained command.
      onSandboxReady: [
        { command: project.setup.join(" && "), timeoutMs: project.setupTimeoutMs },
      ],
    },
  },
  promptFile: "./.sandcastle/prompt.md",
  logging: { type: "stdout" },
});

console.log("branch:", result.branch);
console.log("commits:", result.commits);
console.log("completionSignal:", result.completionSignal);
