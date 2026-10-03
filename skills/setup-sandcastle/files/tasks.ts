import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createSandbox, claudeCode, type ClaudeCodeOptions, type Sandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { ClickUpClient } from "./clickup.ts";
import {
  git,
  refExists,
  releaseStaleWorktree,
  openMergeRequest,
  runGate,
  uncommittedFiles,
  discardLeftovers,
  createRateLimitGuard,
  type RateLimitGuard,
} from "./runner.ts";
import {
  parseTaskWorkflow,
  parseProjectConfig,
  parseDotEnv,
  parseParentIds,
  parseRunFlags,
  runFlagArgs,
  resolveRunModels,
  resolveGateCommands,
  baseBranchFor,
  branchNameFor,
  branchPrefixFor,
  mirrorBranchFor,
  taskMirrorBranchFor,
  existingTaskBranch,
  looseTaskRejection,
  extractTaggedJson,
  cacheHitRate,
  formatDuration,
  hasTag,
  upsertSection,
  buildResumenSection,
  buildTriageComment,
  buildLooseMrDescription,
  gateEvidenceLine,
  type MergeDanger,
  buildLooseSummary,
  RateLimitExhaustedError,
  MODEL_TAG_LIGHT,
  type CommitType,
  type LooseTask,
  type SliceOutcome,
  type UsageSnapshot,
} from "./lib.ts";

type Effort = ClaudeCodeOptions["effort"];

// Loose-task drain: tracker tasks outside any plan — a bug, a small change —
// that the caller already judged an agent can finish alone. Same guarantees as
// the parent drain (worker.ts): the agent commits, this process runs the full
// gate and only then pushes and sets the status; the agent never touches the
// tracker. There is no spec, no work log and no close pass.
// Two modes:
// - Without --branch, every task gets its own branch, sandbox and MR. The
//   branch prefix comes from the commit type the agent declares after reading
//   the task, so the sandbox builds on a prefix-free mirror and the push names
//   the branch; a branch an earlier run already pushed for the task is
//   continued under its own name.
// - With --branch, every task lands as one commit on that branch (continued if
//   it exists on origin, created from the base otherwise), in one sandbox, and
//   one MR carries them all.
// Usage: node .sandcastle/tasks.ts <task-id>[,<task-id>...] [--branch <name>] [--dry-run]
//        [--base <branch>] [--model <alias|id>] [--light-model <alias|id>] [--effort <low|high>]

const WORKFLOW_DOC = "docs/agents/task-workflow.md";
const PROJECT_DOC = ".sandcastle/project.json";
const GATE_FIX_ATTEMPTS = 1;
const TASK_IDLE_TIMEOUT_SECONDS = 1800;

const taskResultSchema = z.object({
  outcome: z.enum(["done", "blocked"]),
  // Only a landed task needs it (it names the branch); a blocked one without it
  // must still reach the needs-info path with its reason.
  type: z.enum(["feat", "fix", "chore"]).optional(),
  summary: z.string(),
  attempted: z.string(),
  reason: z.string().nullable(),
  review_notes: z.array(z.string()).default([]),
  merge_danger: z
    .object({
      door: z.string(),
      door_note: z.string().nullable().default(null),
      blast_radius: z.string(),
      blast_note: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});

const taskIds = parseParentIds(process.argv[2] ?? "");
const dryRun = process.argv.includes("--dry-run");
const flags = parseRunFlags(process.argv.slice(2));
if (taskIds.length === 0) {
  console.error(
    "Usage: node .sandcastle/tasks.ts <task-id>[,<task-id>...] [--branch <name>] [--dry-run] [--base <branch>] [--model <alias|id>] [--light-model <alias|id>] [--effort <low|high>]",
  );
  process.exit(1);
}

// One branch per task means one sandbox per task: each drains in its own
// process, so a failed task does not stop the rest and the run exits non-zero
// if any failed. A dry run stays in this process to show the whole queue.
if (!flags.branch && taskIds.length > 1 && !dryRun) {
  const failed: string[] = [];
  for (const [index, id] of taskIds.entries()) {
    console.log(`\n━━ Task ${index + 1}/${taskIds.length}: ${id} ━━`);
    const child = spawnSync(process.execPath, [process.argv[1], id, ...runFlagArgs(flags)], { stdio: "inherit" });
    if (child.status !== 0) {
      console.error(`✖ task ${id} exited with status ${child.status ?? "signal"}`);
      failed.push(id);
    }
  }
  console.log(`\n━━ Drained ${taskIds.length - failed.length}/${taskIds.length} tasks${failed.length > 0 ? ` — failed: ${failed.join(", ")}` : ""} ━━`);
  process.exit(failed.length > 0 ? 1 : 0);
}

const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));
const taskMandatePath = config.taskMandatePath;
if (!taskMandatePath) {
  console.error(`${WORKFLOW_DOC} declares no 'Loose task mandate' under '## Paths' — add it (seed in setup-skills).`);
  process.exit(1);
}
const project = parseProjectConfig(readFileSync(PROJECT_DOC, "utf8"));
const env = parseDotEnv(readFileSync(".sandcastle/.env", "utf8"));
if (!env.CLICKUP_API_TOKEN) {
  console.error("CLICKUP_API_TOKEN missing in .sandcastle/.env (personal token from ClickUp settings > Apps)");
  process.exit(1);
}
const clickup = new ClickUpClient(env.CLICKUP_API_TOKEN);
const models = resolveRunModels(flags, process.env, env);
const effortFor = (m: string): Effort => models.effortFor(m) as Effort;

const tasks: LooseTask[] = [];
for (const id of taskIds) tasks.push(await clickup.getLooseTask(id));
const rejected = tasks.flatMap((task) => {
  const reason = looseTaskRejection(task, config.statuses);
  return reason ? [{ id: task.id, reason }] : [];
});
const runnable = tasks.filter((task) => !rejected.some((r) => r.id === task.id));

const sharedBranch = flags.branch;
// Hotfix routing needs a prefix: a shared branch has one, a task branch only
// gets it after its run, so it falls back to --base or the doc's base branch.
const remoteHeads = git("ls-remote", "--heads", "origin");
/** `{id}-{slug}`: the task branch before the agent's type gives it a prefix. */
const slugFor = (task: LooseTask): string => branchNameFor(task.id, task.title, "").slice(1);
const plannedBranch = (task: LooseTask): string | undefined =>
  sharedBranch ?? existingTaskBranch(remoteHeads, task.id);
const baseBranch = sharedBranch
  ? baseBranchFor(sharedBranch, config, flags.base)
  : baseBranchFor(runnable[0] ? plannedBranch(runnable[0]) ?? "" : "", config, flags.base);
const gate = resolveGateCommands(config.gate.sandbox, { BASE_BRANCH: baseBranch });

console.log(
  `Mode: ${sharedBranch ? `every task on '${sharedBranch}', one MR` : "one branch and MR per task"} · base: ${baseBranch} · models: ${models.model} / ${models.lightModel} (tag '${MODEL_TAG_LIGHT}') · gate: ${gate.length} commands from ${WORKFLOW_DOC}`,
);
for (const task of runnable) {
  const branch = plannedBranch(task);
  console.log(`  ▸ ${task.id} ${task.title} [${task.status}] → ${branch ?? `{type}/${slugFor(task)} (type declared by the agent)`}`);
}
for (const r of rejected) console.log(`  ⏭ ${r.id} — ${r.reason}`);
if (dryRun) {
  console.log("Dry run: no sandbox launched, no writes.");
  process.exit(0);
}
if (runnable.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

try {
  git("fetch", "origin", baseBranch, ...(sharedBranch ? [sharedBranch] : []));
} catch {
  try {
    git("fetch", "origin", baseBranch);
  } catch {
    // Reported right below.
  }
}
if (!refExists(`origin/${baseBranch}`)) {
  console.error(
    `Base branch 'origin/${baseBranch}' does not exist ${flags.base ? "(passed with --base)" : `(declared in ${WORKFLOW_DOC})`} — nothing was created.`,
  );
  process.exit(1);
}

const openSandbox = async (mirror: string, baseRef: string): Promise<Sandbox> => {
  const heldMirror = releaseStaleWorktree(mirror);
  if (heldMirror) {
    console.error(heldMirror);
    process.exit(1);
  }
  git("branch", "--force", mirror, baseRef);
  const started = Date.now();
  const sandbox = await createSandbox({
    branch: mirror,
    baseBranch,
    sandbox: docker({ imageName: project.image, network: project.network, mounts: project.mounts }),
    hooks: {
      // onSandboxReady hooks run concurrently, so ordered setup must be a single chained command.
      sandbox: { onSandboxReady: [{ command: project.setup.join(" && "), timeoutMs: project.setupTimeoutMs }] },
    },
  });
  console.log(`Sandbox ready in ${formatDuration(Date.now() - started)}`);
  return sandbox;
};

const closeSandbox = async (sandbox: Sandbox): Promise<void> => {
  const closed = await sandbox.close();
  if (closed.preservedWorktreePath) {
    console.log(`Worktree preserved (uncommitted changes): ${closed.preservedWorktreePath}`);
  }
};

const PUSH_POLICY =
  "No tenés permisos de push ni acceso al tracker: tu entregable es un commit local en esta rama más el bloque de resultado que pide este mandato. El proceso externo pushea, verifica el gate y actualiza el tracker.";
const GATE_LIST = gate.map((command) => `- \`${command}\``).join("\n");

type TaskOutcome = SliceOutcome & {
  type?: CommitType;
  reviewNotes: string[];
  mergeDanger?: MergeDanger;
  branch?: string;
  mrUrl?: string;
};

/** Puts the task back for a human and leaves the branch as it was before the
 *  run: in a shared branch the next task must not inherit a rejected commit. */
const markNeedsInfo = async (sandbox: Sandbox, headBefore: string, task: LooseTask, reason: string, attempted: string) => {
  git("-C", sandbox.worktreePath, "reset", "--hard", headBefore);
  discardLeftovers(sandbox);
  await clickup.setStatus(task.id, config.statuses.backlog);
  await clickup.addTag(task.id, config.statuses.needsInfo);
  await clickup.comment(task.id, buildTriageComment(reason, attempted));
};

/** One task, one agent: its commit verified and the full gate green here, or
 *  the task back in the backlog. Pushing and the review status are the caller's. */
const drainTask = async (
  sandbox: Sandbox,
  limits: RateLimitGuard,
  task: LooseTask,
  branchLabel: string,
  branchNote: string,
): Promise<TaskOutcome> => {
  const taskModel = hasTag(task, MODEL_TAG_LIGHT) ? models.lightModel : models.model;
  console.log(`\n▶ ${task.id} — ${task.title}${taskModel !== models.model ? ` [${taskModel}]` : ""}`);
  const headBefore = git("-C", sandbox.worktreePath, "rev-parse", "HEAD");
  await clickup.setStatus(task.id, config.statuses.inProgress);

  let usage: UsageSnapshot | undefined;
  let hitRate: number | undefined;
  let agentMs = 0;
  let gateMs = 0;
  const timed = async <T>(launch: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    const sleptBefore = limits.sleptMs();
    const result = await limits.run(launch);
    agentMs += Date.now() - started - (limits.sleptMs() - sleptBefore);
    return result;
  };
  const timedGate = async () => {
    const started = Date.now();
    const result = await runGate(sandbox, gate);
    gateMs += Date.now() - started;
    return result;
  };
  const measure = (run: Awaited<ReturnType<Sandbox["run"]>>) => {
    usage = run.iterations.at(-1)?.usage ?? usage;
    hitRate = cacheHitRate(run.iterations.flatMap((i) => (i.usage ? [i.usage] : []))) ?? hitRate;
  };
  const outcome = (state: SliceOutcome["state"], detail: string, extra: Partial<TaskOutcome> = {}): TaskOutcome => ({
    slice: task,
    state,
    detail,
    usage,
    cacheHitRate: hitRate,
    agentMs,
    gateMs,
    reviewNotes: [],
    ...extra,
  });

  try {
    let run = await timed(() =>
      sandbox.run({
        agent: claudeCode(taskModel, { effort: effortFor(taskModel) }),
        promptFile: taskMandatePath,
        promptArgs: {
          TASK_ID: task.id,
          TASK_TITLE: task.title,
          TASK_SPEC: task.body || "(la tarea no tiene descripción; guiate por el título)",
          BRANCH: branchLabel,
          BRANCH_NOTE: branchNote,
          BASE_BRANCH: baseBranch,
          DOMAIN_DOC: config.domainDoc,
          ENVIRONMENT: project.environment,
          PUSH_POLICY,
          GATE: GATE_LIST,
        },
        name: `task-${task.id}`,
        logging: { type: "stdout" },
        idleTimeoutSeconds: TASK_IDLE_TIMEOUT_SECONDS,
      }),
    );
    measure(run);
    const result = taskResultSchema.parse(extractTaggedJson(run.stdout, "result"));

    if (result.outcome === "blocked") {
      const reason = result.reason ?? "sin motivo reportado";
      await markNeedsInfo(sandbox, headBefore, task, reason, result.attempted);
      console.log(`⚠️ ${task.id} → needs-info: ${reason}`);
      return outcome("needs-info", reason);
    }
    if (run.commits.length === 0) throw new Error("agent reported done but made no commits");
    if (!result.type) throw new Error("agent reported done without declaring the commit type");

    let gateResult = await timedGate();
    for (let attempt = 0; !gateResult.ok && attempt < GATE_FIX_ATTEMPTS && run.resume; attempt++) {
      console.log(`   ✖ gate red on '${gateResult.failed}' — handing the output back to the agent`);
      const resume = run.resume;
      run = await timed(() =>
        resume(
          [
            `El gate del repo falló después de tu commit: \`${gateResult.failed}\` salió con exit code distinto de cero.`,
            "",
            "```",
            gateResult.output,
            "```",
            "",
            "Arreglalo y amendeá o agregá un commit en esta misma rama. Si no podés dejarlo verde,",
            'aplicá el camino de bloqueo del mandato y devolvé `outcome: "blocked"`.',
            "Volvé a emitir el bloque `<result>` y `<promise>COMPLETE</promise>`.",
          ].join("\n"),
          // Empty promptArgs overrides the ones inherited from the original run:
          // the library forwards them into the inline-prompt resume and then
          // rejects them in its own validation.
          { idleTimeoutSeconds: TASK_IDLE_TIMEOUT_SECONDS, promptArgs: {} },
        ),
      );
      measure(run);
      gateResult = await timedGate();
    }
    if (!gateResult.ok) {
      const reason = `el gate quedó rojo en \`${gateResult.failed}\` tras ${GATE_FIX_ATTEMPTS + 1} intentos`;
      await markNeedsInfo(sandbox, headBefore, task, reason, result.attempted);
      console.log(`⚠️ ${task.id} → needs-info (gate red)`);
      return outcome("gate-red", gateResult.failed ?? "");
    }

    // The gate saw the working tree, the push only carries commits: a green
    // gate over uncommitted files proves nothing about the commit.
    const leftovers = await uncommittedFiles(sandbox);
    if (leftovers.length > 0) {
      const reason = `quedaron ${leftovers.length} archivo(s) sin commitear (${leftovers.slice(0, 5).join(", ")})`;
      await markNeedsInfo(sandbox, headBefore, task, reason, result.attempted);
      console.log(`⚠️ ${task.id} → needs-info (uncommitted files)`);
      return outcome("needs-info", reason);
    }

    return outcome("done", result.summary, {
      type: result.type,
      reviewNotes: result.review_notes.map((note) => `${task.title}: ${note}`),
      mergeDanger: result.merge_danger ?? undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✖ ${task.id} run failed, task back in the backlog: ${message}`);
    git("-C", sandbox.worktreePath, "reset", "--hard", headBefore);
    discardLeftovers(sandbox);
    await clickup.setStatus(task.id, config.statuses.backlog);
    if (error instanceof RateLimitExhaustedError) throw error;
    return outcome("failed", message);
  }
};

/** The verdict reaches the tracker: review status, the state block on top of
 *  the description, and one functional comment. */
const publish = async (o: TaskOutcome): Promise<void> => {
  const task = o.slice as LooseTask;
  await clickup.updateDescription(
    task.id,
    upsertSection(
      task.body,
      "## Resumen",
      buildResumenSection({ report: o.detail, branch: o.branch ?? "", mrUrl: o.mrUrl, pending: [], withQa: false }),
      "start",
    ),
  );
  await clickup.comment(task.id, o.detail);
};

const mrTitleFor = (done: TaskOutcome[]): string =>
  done.length === 1
    ? `${done[0].type}: ${done[0].slice.title}`
    : `${done.every((o) => o.type === done[0].type) ? done[0].type : "chore"}: ${done.map((o) => o.slice.title).join(" · ")}`.slice(0, 200);

const outcomes: TaskOutcome[] = [];

if (sharedBranch) {
  const mirror = mirrorBranchFor(sharedBranch);
  const baseRef = [`origin/${sharedBranch}`, sharedBranch, `origin/${baseBranch}`].find(refExists)!;
  console.log(`Branch: ${sharedBranch} via mirror ${mirror} (built from: ${baseRef})`);
  const sandbox = await openSandbox(mirror, baseRef);
  const limits = createRateLimitGuard(sandbox);
  try {
    for (const [index, task] of runnable.entries()) {
      let result: TaskOutcome;
      try {
        result = await drainTask(
          sandbox,
          limits,
          task,
          sharedBranch,
          "La rama es compartida con otras tareas sueltas: cada una deja su propio commit.",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outcomes.push({ slice: task, state: "failed", detail: message, reviewNotes: [] });
        for (const queued of runnable.slice(index + 1)) {
          outcomes.push({ slice: queued, state: "deferred", detail: "drenaje frenado por rate limit", reviewNotes: [] });
        }
        console.error(`✖ rate limit persists — stopping the drain`);
        break;
      }
      if (result.state === "done") {
        git("push", "origin", `${mirror}:refs/heads/${sharedBranch}`);
        await clickup.setStatus(task.id, config.statuses.inReview);
        console.log(`✅ ${task.id} → ${config.statuses.inReview} (gate verde)\n   ${git("log", "--oneline", "-1", mirror)}`);
        result.branch = sharedBranch;
      }
      outcomes.push(result);
    }

    const done = outcomes.filter((o) => o.state === "done");
    if (done.length > 0) {
      const mrUrl = openMergeRequest(config.mrCli, {
        branch: sharedBranch,
        baseBranch,
        title: mrTitleFor(done),
        description: buildLooseMrDescription({
          outcomes: done,
          reviewNotes: done.flatMap((o) => o.reviewNotes),
          evidenceAfter: gateEvidenceLine(gate, git("rev-parse", "--short", mirror)),
          taskUrl: (id) => clickup.taskUrl(id),
        }),
      });
      for (const o of done) {
        o.mrUrl = mrUrl;
        await publish(o);
      }
    }
  } finally {
    await closeSandbox(sandbox);
  }
} else {
  const task = runnable[0];
  const existing = existingTaskBranch(remoteHeads, task.id);
  const mirror = taskMirrorBranchFor(task.id);
  if (existing) git("fetch", "origin", existing);
  const baseRef = existing ? `origin/${existing}` : `origin/${baseBranch}`;
  console.log(`Branch: ${existing ?? "named after the declared type"} via mirror ${mirror} (built from: ${baseRef})`);
  const sandbox = await openSandbox(mirror, baseRef);
  const limits = createRateLimitGuard(sandbox);
  try {
    const result = await drainTask(
      sandbox,
      limits,
      task,
      existing ?? slugFor(task),
      existing
        ? "Es la rama que ya abrió una corrida anterior de esta tarea: continuala."
        : "El verificador le antepone el prefijo según el `type` que declares (`feature/`, `fix/` o `chore/`).",
    ).catch((error: unknown): TaskOutcome => ({
      slice: task,
      state: "failed",
      detail: error instanceof Error ? error.message : String(error),
      reviewNotes: [],
    }));
    if (result.state === "done") {
      const branch = existing ?? branchNameFor(task.id, task.title, branchPrefixFor(result.type!));
      git("push", "origin", `${mirror}:refs/heads/${branch}`);
      result.branch = branch;
      result.mrUrl = openMergeRequest(config.mrCli, {
        branch,
        baseBranch,
        title: mrTitleFor([result]),
        description: buildLooseMrDescription({
          outcomes: [result],
          reviewNotes: result.reviewNotes,
          evidenceAfter: gateEvidenceLine(gate, git("rev-parse", "--short", mirror)),
          taskUrl: (id) => clickup.taskUrl(id),
        }),
      });
      await clickup.setStatus(task.id, config.statuses.inReview);
      console.log(`✅ ${task.id} → ${config.statuses.inReview} (gate verde)\n   ${git("log", "--oneline", "-1", mirror)}`);
      await publish(result);
    }
    outcomes.push(result);
  } finally {
    await closeSandbox(sandbox);
  }
}

console.log("\n── Resumen ──");
for (const line of buildLooseSummary({ outcomes, rejected })) console.log(line);
// A task handed to a human is a verdict, not a crash: only a failed run fails the process.
process.exit(outcomes.some((o) => o.state === "failed") ? 1 : 0);
