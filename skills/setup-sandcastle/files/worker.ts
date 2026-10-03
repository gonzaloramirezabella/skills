import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createSandbox, claudeCode, type ClaudeCodeOptions, type Sandbox } from "@ai-hero/sandcastle";

type Effort = ClaudeCodeOptions["effort"];
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { z } from "zod";
import { createGitHubClient } from "./github.ts";
import {
  git,
  refExists,
  releaseStaleWorktree,
  openMergeRequest,
  commentMergeRequest,
  discardLeftovers,
  runGate,
  uncommittedFiles,
  createRateLimitGuard,
} from "./runner.ts";
import {
  parseTaskWorkflow,
  parseProjectConfig,
  parseDotEnv,
  parseParentIds,
  workLogFor,
  branchNameFor,
  extractBranchFromDescription,
  extractTaggedJson,
  extractTaggedText,
  frictionEvents,
  buildRetroPrompt,
  buildRetroNote,
  cacheHitRate,
  formatDuration,
  classifyChildren,
  classifySlices,
  buildQueue,
  buildTriageComment,
  buildRollupComment,
  buildMrDescription,
  gateEvidenceLine,
  type MergeDanger,
  buildResumenSection,
  upsertSection,
  buildFinalSummary,
  closeDecision,
  commitTypeFor,
  statusIs,
  hasTag,
  pendingBlockers,
  RateLimitExhaustedError,
  MODEL_TAG_LIGHT,
  parseRunFlags,
  resolveRunModels,
  runFlagArgs,
  mirrorBranchFor,
  type ChildTask,
  type SliceOutcome,
  type UsageSnapshot,
  baseBranchFor,
  resolveGateCommands,
  parseChecklist,
  applyQaVerdicts,
  buildFixChild,
  buildQaComment,
  qaTotals,
  qaVerdictLine,
  renderChecklistForAgent,
  TRIAGE_AFK,
  type QaItemResult,
} from "./lib.ts";

// Deterministic worker: drains one parent's ready-for-agent slices inside a
// single long-lived sandbox, one commit per slice on the parent branch, then
// runs the QA phase (verify the [QA] checklist, a [FIX] slice per ❌, bounded
// cycles) and closes the parent (review + handbook + MR + roll-up).
// The sandbox worktree checks out a mirror branch (sandcastle/{branch}), never
// the parent branch itself: git allows a branch in one worktree only, and the
// parent branch may be checked out in another session at any time.
// Pushes map the mirror onto the parent's remote ref.
// The plan lives in the tracker: the queue is the parent's child tasks (slices
// by triage tag, [SPEC]/[DOCS]/[QA] by title prefix), and a slice's status is
// this worker's verdict — set only after its commit exists and the gate ran
// green here, never on the agent's word. The agent never touches the tracker.
// A hard usage/rate limit from the provider does not fail the slice: the worker
// discards the dead run's uncommitted leftovers, sleeps until the limit resets
// (or a blind fallback) and relaunches; only when the limit persists past the
// retries does the drain stop — leaving the rest of the queue untouched.
// Nothing about this project is hardcoded here: workflow values (statuses, base
// branch, gate, mandate paths) come from docs/agents/task-workflow.md, stack
// values (image, network, setup) from .sandcastle/project.json, and tracker
// specifics from the adapter module.
// Usage: node .sandcastle/worker.ts <parent-task-id>[,<parent-task-id>...] [--dry-run]
//        [--base <branch>] [--model <alias|id>] [--light-model <alias|id>] [--effort <low|high>]

const WORKFLOW_DOC = "docs/agents/task-workflow.md";
const PROJECT_DOC = ".sandcastle/project.json";
const GATE_FIX_ATTEMPTS = 1;
const SLICE_IDLE_TIMEOUT_SECONDS = 1800;

const sliceResultSchema = z.object({
  outcome: z.enum(["done", "blocked"]),
  summary: z.string(),
  attempted: z.string(),
  reason: z.string().nullable(),
  review_notes: z.array(z.string()).default([]),
});

const qaResultSchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int().positive(),
      verdict: z.enum(["pass", "fail", "human"]),
      evidence: z.string(),
      expected: z.string().nullable().default(null),
      observed: z.string().nullable().default(null),
      steps: z.string().nullable().default(null),
    }),
  ),
  summary: z.string().nullable().default(null),
});

const closeResultSchema = z.object({
  review: z.string(),
  handbook: z.string().nullable(),
  findings_for_human: z.array(z.string()),
  // Tolerated as missing so a worker updated ahead of the close mandate (they
  // ship through different skills) degrades to the old behavior with a warning.
  report: z.string().nullable().default(null),
  comment: z.string().nullable().default(null),
  // Same tolerance for the MR-body fields of the `pr` shape.
  evidence_before: z.string().nullable().default(null),
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

const parentIds = parseParentIds(process.argv[2] ?? "");
const dryRun = process.argv.includes("--dry-run");
const flags = parseRunFlags(process.argv.slice(2));
if (parentIds.length === 0) {
  console.error(
    "Usage: node .sandcastle/worker.ts <parent-task-id>[,<parent-task-id>...] [--dry-run] [--base <branch>] [--model <alias|id>] [--light-model <alias|id>] [--effort <low|high>]",
  );
  process.exit(1);
}

// Several parents drain sequentially, each in its own process so the whole
// single-parent flow below keeps its module-level state untouched. A failed
// parent does not stop the queue; the run exits non-zero if any failed.
if (parentIds.length > 1) {
  const failed: string[] = [];
  for (const [index, id] of parentIds.entries()) {
    console.log(`\n━━ Parent ${index + 1}/${parentIds.length}: ${id} ━━`);
    const child = spawnSync(
      process.execPath,
      [process.argv[1], id, ...(dryRun ? ["--dry-run"] : []), ...runFlagArgs(flags)],
      { stdio: "inherit" },
    );
    if (child.status !== 0) {
      console.error(`✖ parent ${id} exited with status ${child.status ?? "signal"}`);
      failed.push(id);
    }
  }
  console.log(`\n━━ Drained ${parentIds.length - failed.length}/${parentIds.length} parents${failed.length > 0 ? ` — failed: ${failed.join(", ")}` : ""} ━━`);
  process.exit(failed.length > 0 ? 1 : 0);
}

const parentId = parentIds[0];

const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));
const project = parseProjectConfig(readFileSync(PROJECT_DOC, "utf8"));
const env = parseDotEnv(readFileSync(".sandcastle/.env", "utf8"));
const tracker = createGitHubClient({ ...env, ...process.env });
// Model routing (task-workflow.md "Model routing"): the default model drains the
// slices and the close; a `sonnet`-tagged slice runs on the light model instead.
const models = resolveRunModels(flags, process.env, env);
const { model, lightModel } = models;
const effortFor = (m: string): Effort => models.effortFor(m) as Effort;

const sandboxSetup = project.setup.join(" && ");

const parent = await tracker.getTask(parentId);
console.log(`Parent ${parentId}: ${parent.title} [${parent.status}]`);

const parentDescription = parent.body;
const branchFromDescription = extractBranchFromDescription(parentDescription);
const branch = branchFromDescription ?? branchNameFor(parentId, parent.title);
const baseBranch = baseBranchFor(branch, config, flags.base);
const gateVars = { BASE_BRANCH: baseBranch };
const sliceGate = resolveGateCommands(config.gate.sandboxSlice, gateVars);
const closeGate = resolveGateCommands(config.gate.sandbox, gateVars);

try {
  git("fetch", "origin", baseBranch, branch);
} catch {
  try {
    git("fetch", "origin", baseBranch);
  } catch {
    // Reported right below, where the message can name where the branch came from.
  }
}

// A base that does not exist on origin is caught here, before anything is built:
// the fallback chain below would otherwise mirror the parent branch and push an
// MR at the wrong target, which only surfaces once the MR is open.
if (!refExists(`origin/${baseBranch}`)) {
  console.error(
    `Base branch 'origin/${baseBranch}' does not exist ${flags.base ? "(passed with --base)" : `(declared in ${WORKFLOW_DOC})`} — nothing was created.`,
  );
  process.exit(1);
}

const workLogPath = workLogFor(config, parentId);
const workBranch = mirrorBranchFor(branch);
const pushParent = (): string => git("push", "origin", `${workBranch}:refs/heads/${branch}`);

const baseRef = [`origin/${branch}`, branch, `origin/${baseBranch}`].find(refExists);
if (!baseRef) {
  console.error(`No readable ref among '${branch}', 'origin/${branch}', 'origin/${baseBranch}'.`);
  process.exit(1);
}

const children = await tracker.getChildren(parentId);
const plan = classifyChildren(children);
if (plan.slices.length === 0) {
  console.error(`Parent ${parentId} has no slice children — run plan-task first.`);
  process.exit(1);
}
if (!plan.spec) {
  console.warn(`⚠️ Parent ${parentId} has no [SPEC] child — slices run without a parent spec.`);
}

// The [DOCS] is a queue item like any slice: every slice is blocked by it, so
// the topological order already runs it first, and its content is context the
// slices need. The slice mandate carries its special-case instructions.
const workUnits = plan.docs ? [plan.docs, ...plan.slices] : plan.slices;
const classified = classifySlices(workUnits, config.statuses);
const workItems: ChildTask[] = buildQueue(classified);

console.log(`Branch: ${branch} via mirror ${workBranch} (base: ${baseBranch}, built from: ${baseRef})`);
console.log(
  `Models: ${model} (default) / ${lightModel} (tag '${MODEL_TAG_LIGHT}') · effort: ${effortFor(model)} default / ${effortFor(lightModel)} light · gate: ${config.gate.sandboxSlice.length} slice + ${config.gate.sandbox.length} close commands from ${WORKFLOW_DOC}`,
);
if (!branchFromDescription) {
  console.warn("⚠️ Parent description has no 'Rama:' block — branch derived from the title; add the block if another branch already exists.");
}
console.log(`Queue (${workItems.length}): ${workItems.map((s) => `${s.id} ${s.title}`).join(" | ") || "empty"}`);
if (classified.hitl.length > 0) {
  console.log(`HITL, blocks the parent close until a human drains it: ${classified.hitl.map((s) => `${s.id} ${s.title}`).join(" | ")}`);
}
if (classified.needsInfo.length > 0) {
  console.log(`needs-info, waiting on a human: ${classified.needsInfo.map((s) => s.id).join(", ")}`);
}
if (dryRun) {
  console.log("Dry run: no sandbox launched, no writes.");
  process.exit(0);
}
if (workItems.length === 0 && classified.done.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}
if (workItems.length === 0 && statusIs(parent.status, config.statuses.inReview)) {
  console.log(`Nothing to do: queue empty and the parent is already ${config.statuses.inReview}.`);
  process.exit(0);
}

const heldMirror = releaseStaleWorktree(workBranch);
if (heldMirror) {
  console.error(heldMirror);
  process.exit(1);
}
git("branch", "--force", workBranch, baseRef);

if (statusIs(parent.status, config.statuses.planned)) {
  await tracker.setStatus(parentId, config.statuses.inProgress);
  await tracker.comment(parentId, `Rama de trabajo: \`${branch}\` (sandcastle worker)`);
}

const setupStarted = Date.now();
const sandbox = await createSandbox({
  branch: workBranch,
  baseBranch: baseBranch,
  sandbox: docker({
    imageName: project.image,
    network: project.network,
    mounts: project.mounts,
  }),
  hooks: {
    // onSandboxReady hooks run concurrently, so ordered setup must be a single chained command.
    sandbox: { onSandboxReady: [{ command: sandboxSetup, timeoutMs: project.setupTimeoutMs }] },
  },
});
console.log(`Sandbox ready in ${formatDuration(Date.now() - setupStarted)}`);
const limits = createRateLimitGuard(sandbox);

// The mandates read the parent spec from a file; the tracker holds it, so it is
// materialized into the worktree at a gitignored path the agent can open.
const specFile = `.sandcastle/logs/spec-${parentId}.md`;
const specAbsolute = join(sandbox.worktreePath, specFile);
mkdirSync(dirname(specAbsolute), { recursive: true });
writeFileSync(
  specAbsolute,
  plan.spec?.body ?? "(el padre no tiene hija [SPEC]; guiate por la descripción del slice)",
);

/** Deterministic block path: the worker owns the tracker state, the log keeps the trace. */
const markNeedsInfo = async (slice: ChildTask, reason: string): Promise<void> => {
  await tracker.setStatus(slice.id, config.statuses.backlog);
  await tracker.addTag(slice.id, config.statuses.needsInfo);
  const log = join(sandbox.worktreePath, workLogPath);
  if (!existsSync(log)) {
    mkdirSync(dirname(log), { recursive: true });
    writeFileSync(log, `# Work — ${parentId}: ${parent.title}\nRama: ${branch}\n`);
  }
  appendFileSync(
    log,
    `\n## ${slice.id} — ${slice.title}\nEstado: ⚠️ needs-info\nResultado: ${reason}\n`,
  );
  execFileSync("git", ["-C", sandbox.worktreePath, "add", workLogPath]);
  execFileSync("git", [
    "-C",
    sandbox.worktreePath,
    "commit",
    "--no-verify",
    "-m",
    `docs(work): slice ${slice.id} needs-info #${parentId}`,
  ]);
};

const reportNeedsInfo = async (slice: ChildTask, reason: string, attempted: string): Promise<void> => {
  await tracker.comment(
    parentId,
    `⚠️ Slice ${slice.id} (${slice.title}) → needs-info\n\n${buildTriageComment(reason, attempted)}`,
  );
};

const PUSH_POLICY =
  "No tenés permisos de push ni acceso al tracker: tu entregable son commits locales en esta rama más el bloque de resultado que pide este mandato. El proceso externo pushea, verifica el gate y actualiza el tracker.";

const asGateList = (commands: string[]): string =>
  commands.map((command) => `- \`${command}\``).join("\n");
const SLICE_GATE_LIST = asGateList(sliceGate);
const CLOSE_GATE_LIST = asGateList(closeGate);

const slicePromptArgs = (slice: ChildTask) => ({
  SLICE_ID: slice.id,
  SLICE_TITLE: slice.title,
  SLICE_SPEC: slice.body,
  SPEC_FILE: specFile,
  PARENT_ID: parentId,
  WORK_LOG: workLogPath,
  BRANCH: branch,
  BASE_BRANCH: baseBranch,
  DOMAIN_DOC: config.domainDoc,
  ENVIRONMENT: project.environment,
  PUSH_POLICY,
  GATE: SLICE_GATE_LIST,
});

// Slices already in review from an earlier run count as done, so a re-run that
// only has the close left still produces a complete MR body and roll-up.
const outcomes: SliceOutcome[] = classified.done.map((slice) => ({
  slice,
  state: "done",
  detail: slice.title,
}));
const reviewNotes: string[] = [];
const completedInRun = new Set<string>(classified.done.map((s) => s.id));

/** One slice end to end: delegate, verify commit + gate, set its status.
 *  Returns "stop" when the provider limit persists and the drain must end. */
const drainSlice = async (slice: ChildTask, queue: ChildTask[]): Promise<"done" | "stop"> => {
  {

    const sliceModel = hasTag(slice, MODEL_TAG_LIGHT) ? lightModel : model;
    console.log(`\n▶ ${slice.id} — ${slice.title}${sliceModel !== model ? ` [${sliceModel}]` : ""}`);
    await tracker.setStatus(slice.id, config.statuses.inProgress);

    let usage: UsageSnapshot | undefined;
    let hitRate: number | undefined;
    let agentMs = 0;
    let gateMs = 0;
    const timedGate = async () => {
      const started = Date.now();
      const gate = await runGate(sandbox, sliceGate);
      gateMs += Date.now() - started;
      return gate;
    };
    try {
      let agentStarted = Date.now();
      let sleptBefore = limits.sleptMs();
      let run = await limits.run(() =>
        sandbox.run({
          agent: claudeCode(sliceModel, { effort: effortFor(sliceModel) }),
          promptFile: config.sliceMandatePath,
          promptArgs: slicePromptArgs(slice),
          name: `${parentId}-${slice.id}`,
          logging: { type: "stdout" },
          idleTimeoutSeconds: SLICE_IDLE_TIMEOUT_SECONDS,
        }),
      );
      agentMs += Date.now() - agentStarted - (limits.sleptMs() - sleptBefore);
      usage = run.iterations.at(-1)?.usage;
      hitRate = cacheHitRate(run.iterations.flatMap((i) => (i.usage ? [i.usage] : [])));

      const result = sliceResultSchema.parse(extractTaggedJson(run.stdout, "result"));

      if (result.outcome === "blocked") {
        await markNeedsInfo(slice, result.reason ?? "sin motivo reportado");
        await reportNeedsInfo(slice, result.reason ?? "sin motivo reportado", result.attempted);
        pushParent();
        console.log(`⚠️ ${slice.id} → needs-info: ${result.reason}`);
        outcomes.push({ slice, state: "needs-info", detail: result.reason ?? "", usage, cacheHitRate: hitRate, agentMs, gateMs });
        return "done";
      }

      if (run.commits.length === 0) {
        throw new Error("agent reported done but made no commits");
      }

      // The gate is the worker's, not the agent's: run it, and give the agent
      // its own failure output back before giving up on the slice.
      let gate = await timedGate();
      let gateRetries = 0;
      for (let attempt = 0; !gate.ok && attempt < GATE_FIX_ATTEMPTS; attempt++) {
        console.log(`   ✖ gate red on '${gate.failed}' — handing the output back to the agent`);
        const resume = run.resume;
        if (!resume) break;
        gateRetries++;
        agentStarted = Date.now();
        sleptBefore = limits.sleptMs();
        run = await limits.run(() =>
          resume(
            [
              `El gate del repo falló después de tu commit: \`${gate.failed}\` salió con exit code distinto de cero.`,
              "",
              "```",
              gate.output,
              "```",
              "",
              "Arreglalo y amendeá o agregá un commit en esta misma rama. Si no podés dejarlo verde,",
              'aplicá el camino de bloqueo del mandato (bitácora actualizada) y devolvé `outcome: "blocked"`.',
              "Volvé a emitir el bloque `<result>` y `<promise>COMPLETE</promise>`.",
            ].join("\n"),
            // Empty promptArgs overrides the ones inherited from the original run:
            // the library forwards them into the inline-prompt resume and then
            // rejects them in its own validation.
            { idleTimeoutSeconds: SLICE_IDLE_TIMEOUT_SECONDS, promptArgs: {} },
          ),
        );
        agentMs += Date.now() - agentStarted - (limits.sleptMs() - sleptBefore);
        usage = run.iterations.at(-1)?.usage ?? usage;
        hitRate = cacheHitRate(run.iterations.flatMap((i) => (i.usage ? [i.usage] : []))) ?? hitRate;
        gate = await timedGate();
      }

      if (!gate.ok) {
        const reason = `el gate quedó rojo en \`${gate.failed}\` tras ${GATE_FIX_ATTEMPTS + 1} intentos`;
        await markNeedsInfo(slice, reason);
        await reportNeedsInfo(slice, reason, result.attempted);
        pushParent();
        console.log(`⚠️ ${slice.id} → needs-info (gate red)`);
        outcomes.push({ slice, state: "gate-red", detail: gate.failed ?? "", usage, cacheHitRate: hitRate, agentMs, gateMs, gateRetries });
        return "done";
      }

      // Commit verified and gate green: only now does the slice get its status.
      pushParent();
      await tracker.setStatus(slice.id, config.statuses.inReview);
      const head = git("log", "--oneline", "-1", workBranch);
      console.log(`✅ ${slice.id} → ${config.statuses.inReview} (gate verde)\n   ${head}`);
      completedInRun.add(slice.id);
      outcomes.push({ slice, state: "done", detail: result.summary, usage, cacheHitRate: hitRate, agentMs, gateMs, gateRetries });
      reviewNotes.push(...result.review_notes.map((note) => `Slice ${slice.id}: ${note}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✖ ${slice.id} run failed, slice stays queued: ${message}`);
      await tracker.setStatus(slice.id, config.statuses.backlog);
      outcomes.push({ slice, state: "failed", detail: message, usage, cacheHitRate: hitRate, agentMs, gateMs });
      if (error instanceof RateLimitExhaustedError) {
        // Every further run would die on the same limit: stop the drain and
        // leave the rest of the queue untouched for the next run to pick up.
        const remaining = queue.slice(queue.indexOf(slice) + 1);
        for (const queued of remaining) {
          outcomes.push({ slice: queued, state: "deferred", detail: "drenaje frenado por rate limit" });
        }
        console.error(`✖ rate limit persists — stopping the drain, ${remaining.length} slice(s) left queued`);
        return "stop";
      }
    }
  }
  return "done";
};

try {
  for (const slice of workItems) {
    const blockedBy = pendingBlockers(slice, children, completedInRun, config.statuses.inReview);
    if (blockedBy.length > 0) {
      console.log(`⏸ ${slice.id} deferred (blocked by ${blockedBy.join(", ")})`);
      outcomes.push({ slice, state: "deferred", detail: `bloqueado por ${blockedBy.join(", ")}` });
      continue;
    }
    if ((await drainSlice(slice, workItems)) === "stop") break;
  }

  // ── Parent close ──────────────────────────────────────────────────────────
  // Decided before the QA phase on purpose: a [FIX] that was built but still
  // fails QA leaves the parent in progress, yet the MR opens — the code is
  // reviewable. A [FIX] whose own gate went red is a failed slice like any other.
  const decision = closeDecision(classified, outcomes, config.statuses.inReview);
  const closeEvents: string[] = [];
  const warnings: string[] = [];

  // ── QA phase ──────────────────────────────────────────────────────────────
  // Runs only when the parent would close: every AFK slice done. The agent
  // observes and reports in a <qa> block; this worker writes the verdicts on
  // the [QA] child and creates a [FIX] slice per ❌, drained by drainSlice.
  // Gated on setInReview, not openMr: an unbuilt HITL slice would turn its
  // checklist items into [FIX] children and hand human-reserved work to an agent.
  const qaWouldRun = decision.setInReview && config.qaMandatePath && plan.qa;
  if (qaWouldRun && config.qa) {
    const qaChild = plan.qa;
    const qaConfig = config.qa;
    let qaDescription = (await tracker.getTask(qaChild.id)).body || qaChild.body;
    let unresolvedFixes: ChildTask[] = [];
    const fixByIndex = new Map<number, ChildTask>();
    let lastTotals = { pass: 0, fail: 0, human: 0 };
    const qaSandboxUp = resolveGateCommands(qaConfig.sandboxUp, gateVars);
    for (let cycle = 1; cycle <= qaConfig.maxCycles; cycle++) {
      const items = parseChecklist(qaDescription);
      const pendingItems = items.filter((i) => i.pending);
      if (pendingItems.length === 0) {
        console.log(`\n── QA: nothing pending on cycle ${cycle} ──`);
        break;
      }
      console.log(`\n── QA cycle ${cycle}/${qaConfig.maxCycles}: ${pendingItems.length} item(s) to verify ──`);
      let results: QaItemResult[];
      try {
        const qaRun = await limits.run(() =>
          sandbox.run({
            agent: claudeCode(model, { effort: effortFor(model) }),
            promptFile: config.qaMandatePath!,
            promptArgs: {
              PARENT_ID: parentId,
              PARENT_TITLE: parent.title,
              QA_ID: qaChild.id,
              QA_CHECKLIST: renderChecklistForAgent(items),
              SPEC_FILE: specFile,
              WORK_LOG: workLogPath,
              BRANCH: branch,
              BASE_BRANCH: baseBranch,
              ENVIRONMENT: project.environment,
              APP_UP: asGateList(qaSandboxUp),
              APP_URL: qaConfig.sandboxUrl ?? "(sin URL declarada)",
              BROWSER_LANE: qaConfig.browserLane ? "yes" : "no",
              CREDENTIALS: qaConfig.credentials ?? "none",
            },
            name: `${parentId}-qa-${cycle}`,
            logging: { type: "stdout" },
            idleTimeoutSeconds: SLICE_IDLE_TIMEOUT_SECONDS,
          }),
        );
        results = qaResultSchema.parse(extractTaggedJson(qaRun.stdout, "qa")).items;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✖ QA cycle ${cycle} failed: ${message}`);
        closeEvents.push(`qa: ciclo ${cycle} falló — ${message}`);
        warnings.push(`QA incompleto (ciclo ${cycle}): ${message}`);
        break;
      }
      if ((await uncommittedFiles(sandbox)).length > 0) {
        console.warn("⚠️ the QA pass left uncommitted files — discarding, it was read-only by mandate");
        discardLeftovers(sandbox);
      }
      const pendingIndexes = new Set(pendingItems.map((i) => i.index));
      results = results.filter((r) => pendingIndexes.has(r.index));
      const totals = qaTotals(results);
      lastTotals = totals;
      console.log(`   QA cycle ${cycle}: ✅ ${totals.pass} · ❌ ${totals.fail} · 🙋 ${totals.human}`);

      const fixes: ChildTask[] = [];
      const fails = results.filter((r) => r.verdict === "fail");
      if (cycle < qaConfig.maxCycles || fails.length === 0) {
        for (const result of fails) {
          const item = items.find((i) => i.index === result.index)!;
          const fix = buildFixChild(item, result, qaChild.id);
          const created = await tracker.createChildTask(parentId, {
            title: fix.title,
            body: fix.body,
            status: config.statuses.backlog,
            tags: [TRIAGE_AFK],
          });
          fixes.push(created);
          fixByIndex.set(result.index, created);
        }
      }
      qaDescription = applyQaVerdicts(qaDescription, results);
      await tracker.updateDescription(qaChild.id, qaDescription);
      await tracker.comment(
        qaChild.id,
        buildQaComment({ cycle, items, results, fixes: fixes.map((f) => ({ id: f.id, title: f.title })) }),
      );

      if (fails.length === 0) break;
      if (fixes.length === 0) {
        // Last cycle: the ❌ survive; the [FIX] built for each one goes back to
        // a human, since what it built did not make the item pass.
        for (const result of fails) {
          const fix = fixByIndex.get(result.index);
          if (!fix) continue;
          const reason = `su item de QA sigue ❌ tras ${qaConfig.maxCycles} ciclos: ${qaVerdictLine(result)}`;
          await markNeedsInfo(fix, reason);
          await reportNeedsInfo(fix, reason, "construido y verificado con gate verde, pero el item de QA no pasó");
          const outcome = outcomes.find((o) => o.slice.id === fix.id);
          if (outcome) {
            outcome.state = "needs-info";
            outcome.detail = reason;
          }
        }
        if (fails.some((r) => fixByIndex.has(r.index))) pushParent();
        closeEvents.push(`qa: ${fails.length} item(s) ❌ tras ${qaConfig.maxCycles} ciclos`);
        decision.pending.push(`QA: ${fails.length} item(s) ❌ sin resolver tras ${qaConfig.maxCycles} ciclos (hija [QA] ${qaChild.id})`);
        decision.setInReview = false;
        break;
      }
      closeEvents.push(`qa: ciclo ${cycle} con ${fails.length} fallo(s) → ${fixes.length} hija(s) [FIX]`);

      let stopped = false;
      unresolvedFixes = [];
      for (const fix of fixes) {
        const before = outcomes.length;
        if ((await drainSlice(fix, fixes)) === "stop") {
          stopped = true;
          break;
        }
        const outcome = outcomes[before];
        if (outcome?.state !== "done") unresolvedFixes.push(fix);
      }
      if (stopped || unresolvedFixes.length > 0) {
        decision.pending.push(
          ...unresolvedFixes.map((f) => `[FIX] ${f.id} no quedó construido — su item de QA sigue ❌`),
        );
        decision.setInReview = false;
        break;
      }
      // The fixed items keep their ❌ line, so the next cycle re-verifies them.
    }
    reviewNotes.push(
      `QA: ✅ ${lastTotals.pass} · ❌ ${lastTotals.fail} · 🙋 ${lastTotals.human} — veredictos en la hija [QA] ${tracker.taskUrl(qaChild.id)}`,
    );
  } else if (qaWouldRun && !config.qa) {
    console.warn("⚠️ QA mandate declared but task-workflow.md has no '## QA' section — QA phase skipped");
  }
  let reviewLine: string | undefined;
  let handbookLine: string | undefined;
  let closeReport: string | undefined;
  let closeComment: string | null = null;
  let evidenceBefore: string | null = null;
  let mergeDanger: MergeDanger | undefined;
  let closeGateVerdict: "green" | "red" | "skipped" = "skipped";
  let mrUrl: string | undefined;
  let mrSkippedReason: string | undefined = decision.openMr
    ? undefined
    : "el trabajo del padre no está completo";

  if (decision.openMr) {
    console.log("\n── Closing the parent: two-axis review + handbook ──");
    const closeStarted = Date.now();
    const closeSleptBefore = limits.sleptMs();
    let closeRun: Awaited<ReturnType<Sandbox["run"]>> | undefined;
    const applyCloseResult = (stdout: string): void => {
      const closeResult = closeResultSchema.parse(extractTaggedJson(stdout, "close"));
      reviewLine = closeResult.review;
      reviewNotes.push(...closeResult.findings_for_human);
      handbookLine = closeResult.handbook ?? undefined;
      closeReport = closeResult.report ?? undefined;
      closeComment = closeResult.comment;
      evidenceBefore = closeResult.evidence_before;
      mergeDanger = closeResult.merge_danger ?? undefined;
    };
    try {
      closeRun = await limits.run(() =>
        sandbox.run({
          agent: claudeCode(model, { effort: effortFor(model) }),
          promptFile: config.closeMandatePath,
          promptArgs: {
            PARENT_ID: parentId,
            PARENT_TITLE: parent.title,
            SPEC_FILE: specFile,
            WORK_LOG: workLogPath,
            BRANCH: branch,
            BASE_BRANCH: baseBranch,
            HANDBOOK: config.hasHandbook ? "yes" : "no",
            DOMAIN_DOC: config.domainDoc,
            ENVIRONMENT: project.environment,
            PUSH_POLICY,
            GATE: CLOSE_GATE_LIST,
          },
          name: `${parentId}-close`,
          logging: { type: "stdout" },
          idleTimeoutSeconds: SLICE_IDLE_TIMEOUT_SECONDS,
        }),
      );
      applyCloseResult(closeRun.stdout);
      if (!closeReport) {
        console.warn("⚠️ close result has no 'report' — the close mandate predates the informe; parent description stays untouched");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`✖ closing review failed: ${message}`);
      closeEvents.push(`cierre: el review de dos ejes falló — ${message}`);
      reviewLine = `⚠️ no se pudo completar el review de cierre (${message}) — revisar el diff a mano`;
      warnings.push("review de cierre incompleto — revisar el diff a mano");
    }

    let leftovers = await uncommittedFiles(sandbox);
    if (leftovers.length === 0) {
      // The full unscoped gate runs here and only here: this is where breakage
      // the scoped slice gates missed surfaces, so the close agent gets the
      // same fix chance a slice does before the parent is declared stuck.
      let gate = await runGate(sandbox, closeGate);
      for (let attempt = 0; !gate.ok && attempt < GATE_FIX_ATTEMPTS && closeRun?.resume; attempt++) {
        console.log(`   ✖ close gate red on '${gate.failed}' — handing the output back to the agent`);
        closeEvents.push(`cierre: gate completo rojo en \`${gate.failed}\` (intento ${attempt + 1})`);
        const resumeClose = closeRun.resume;
        closeRun = await limits.run(() =>
          resumeClose(
            [
              `El gate completo del repo falló al cerrar el padre: \`${gate.failed}\` salió con exit code distinto de cero.`,
              "",
              "```",
              gate.output,
              "```",
              "",
              "Arreglalo y commiteá en esta misma rama, y volvé a emitir el bloque `<close>` y `<promise>COMPLETE</promise>`.",
            ].join("\n"),
            { idleTimeoutSeconds: SLICE_IDLE_TIMEOUT_SECONDS, promptArgs: {} },
          ),
        );
        try {
          applyCloseResult(closeRun.stdout);
        } catch {
          console.warn("⚠️ close fix run re-emitted no parseable <close> block — keeping the previous one");
        }
        gate = await runGate(sandbox, closeGate);
      }
      leftovers = await uncommittedFiles(sandbox);
      closeGateVerdict = gate.ok ? "green" : "red";
      if (gate.ok && leftovers.length === 0) {
        pushParent();
      } else if (!gate.ok) {
        console.error(`✖ gate red at '${gate.failed}' — the parent stays open`);
        decision.pending.push(`gate rojo en '${gate.failed}'`);
        decision.setInReview = false;
      }
    }
    if (leftovers.length > 0) {
      const shown = leftovers.slice(0, 5).join(", ");
      console.error(`✖ ${leftovers.length} uncommitted file(s) — the MR would not carry them`);
      closeEvents.push(`cierre: ${leftovers.length} archivo(s) sin commitear (${shown})`);
      decision.pending.push(
        `${leftovers.length} archivo(s) sin commitear en el sandbox, fuera del MR (${shown}${leftovers.length > 5 ? ", …" : ""})`,
      );
      decision.setInReview = false;
    }
    console.log(`   close phase took ${formatDuration(Date.now() - closeStarted - (limits.sleptMs() - closeSleptBefore))}`);

    mrUrl = openMergeRequest(config.mrCli, {
      branch,
      baseBranch,
      title: `${commitTypeFor(branch)}: ${parent.title}`,
      description: buildMrDescription({
        outcomes,
        reviewLine,
        reviewNotes,
        handbookLine,
        evidence: {
          before: evidenceBefore,
          after: gateEvidenceLine(closeGate, git("rev-parse", "--short", workBranch), closeGateVerdict),
        },
        mergeDanger,
        taskUrl: tracker.taskUrl(parentId),
      }),
    });
    mrSkippedReason = mrUrl ? undefined : "falló la creación y no hay MR previo";

    // Retro only when the drain rubbed somewhere: a clean run teaches little and
    // the human review of the MR is still to come. Read-only pass; its output is
    // an MR comment, kept apart from the body that reviews the code.
    const events = frictionEvents(outcomes, closeEvents);
    if (mrUrl && events.length > 0 && existsSync(join(sandbox.worktreePath, ".agents/skills/retro/SKILL.md"))) {
      console.log(`\n── Retro: ${events.length} friction event(s) ──`);
      const retroFile = `.sandcastle/logs/retro-${parentId}.md`;
      writeFileSync(
        join(sandbox.worktreePath, retroFile),
        buildRetroPrompt({ parentId, parentTitle: parent.title, branch, baseBranch, workLog: workLogPath, events, reviewNotes }),
      );
      try {
        const retroRun = await limits.run(() =>
          sandbox.run({
            agent: claudeCode(model, { effort: effortFor(model) }),
            promptFile: retroFile,
            name: `${parentId}-retro`,
            logging: { type: "stdout" },
            idleTimeoutSeconds: SLICE_IDLE_TIMEOUT_SECONDS,
          }),
        );
        const proposals = extractTaggedText(retroRun.stdout, "retro");
        if (commentMergeRequest(config.mrCli, mrUrl, buildRetroNote({ proposals, events }))) {
          console.log("   retro posted as an MR comment");
        } else {
          warnings.push("retro generada pero no se pudo publicar en el MR");
        }
        if ((await uncommittedFiles(sandbox)).length > 0) {
          console.warn("⚠️ the retro pass left uncommitted files — discarding, it was read-only by mandate");
          discardLeftovers(sandbox);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️ retro skipped: ${message}`);
      }
    }

    // The business-facing report goes in the parent description, where the plan
    // block already lives; the close comment is a single functional paragraph.
    if (closeReport) {
      try {
        await tracker.updateDescription(
          parentId,
          upsertSection(
            parentDescription,
            "## Resumen",
            buildResumenSection({ report: closeReport, branch, mrUrl, pending: decision.pending }),
            "start",
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`✖ could not publish the close report on the parent: ${message}`);
        // The report must not be lost: fall back to a plain comment.
        await tracker.comment(
          parentId,
          `📋 Resumen (no se pudo actualizar la descripción)\n\n${buildResumenSection({ report: closeReport, branch, mrUrl, pending: decision.pending })}`,
        );
        warnings.push("informe de cierre publicado como comentario — no se pudo editar la descripción");
      }
    }
  }

  if (decision.setInReview) {
    await tracker.setStatus(parentId, config.statuses.inReview);
  }
  await tracker.comment(
    parentId,
    buildRollupComment({
      comment: closeComment,
      pending: decision.pending,
      warnings,
    }),
  );

  console.log("\n── Resumen ──");
  for (const line of buildFinalSummary({
    parentId,
    parentTitle: parent.title,
    branch,
    baseBranch: baseBranch,
    outcomes,
    mrUrl,
    mrSkippedReason,
    statusSet: decision.setInReview,
    statuses: config.statuses,
    pending: decision.pending,
    warnings,
  })) {
    console.log(line);
  }
} finally {
  const closed = await sandbox.close();
  if (closed.preservedWorktreePath) {
    console.log(`Worktree preserved (uncommitted changes): ${closed.preservedWorktreePath}`);
  }
}
