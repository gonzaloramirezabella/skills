import { readFileSync } from "node:fs";
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { parseProjectConfig, parseTaskWorkflow } from "./lib.ts";

// Debugging harness for the image, with no agent and no credential: service checks,
// then setup, then the real quality gate. Every command here would otherwise fail
// silently under an agent. Both lists come from config — nothing duplicated.
// Usage: node .sandcastle/smoke.ts

const project = parseProjectConfig(readFileSync(".sandcastle/project.json", "utf8"));
const workflow = parseTaskWorkflow(readFileSync("docs/agents/task-workflow.md", "utf8"));

const sandbox = await createSandbox({
  branch: "sandcastle/smoke",
  sandbox: docker({
    imageName: project.image,
    network: project.network,
    mounts: project.mounts,
  }),
});

const sh = async (command: string) => {
  console.log(`\n$ ${command}`);
  const result = await sandbox.exec(command, {
    onLine: (line) => console.log(`  ${line}`),
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed with exit code ${result.exitCode}: ${command}\n${result.stderr}`);
  }
  return result;
};

try {
  for (const check of project.serviceChecks) await sh(check);
  await sh(project.setup.join(" && "));
  for (const command of workflow.gate.sandbox) await sh(command);
  console.log("\nSMOKE TEST PASSED");
} finally {
  await sandbox.close();
}
