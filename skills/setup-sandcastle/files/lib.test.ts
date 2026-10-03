import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { repoFromRemote, statusFromLabels, STATUS_LABEL_PREFIX } from "./github.ts";
import {
  parseTaskWorkflow,
  parseProjectConfig,
  workLogFor,
  declaredPlaceholders,
  extractTaggedJson,
  extractTaggedText,
  frictionEvents,
  buildRetroPrompt,
  buildRetroNote,
  contextWindowTokens,
  formatTokens,
  cacheHitRate,
  formatDuration,
  buildFinalSummary,
  commitTypeFor,
  closeDecision,
  buildRollupComment,
  buildMrDescription,
  gateEvidenceLine,
  buildResumenSection,
  upsertSection,
  parseDotEnv,
  parseParentIds,
  branchNameFor,
  extractBranchFromDescription,
  mirrorBranchFor,
  worktreeHolding,
  classifyChildren,
  classifySlices,
  parseChecklist,
  applyQaVerdicts,
  buildFixChild,
  buildQaComment,
  renderChecklistForAgent,
  QA_FIX_PREFIX,
  orderSlices,
  buildQueue,
  buildTriageComment,
  statusIs,
  hasTag,
  pendingBlockers,
  detectRateLimit,
  baseBranchFor,
  resolveGateCommands,
  resolveModel,
  defaultEffortFor,
  pickSetting,
  parseRunFlags,
  runFlagArgs,
  DEFAULT_MODEL,
  DEFAULT_LIGHT_MODEL,
  rateLimitResetMs,
  rateLimitWaitMs,
  resolveRunModels,
  branchPrefixFor,
  taskMirrorBranchFor,
  existingTaskBranch,
  looseTaskRejection,
  buildLooseMrDescription,
  buildLooseSummary,
  type ChildTask,
  type LooseTask,
} from "./lib.ts";

const WORKFLOW_DOC = "docs/agents/task-workflow.md";
const PROJECT_DOC = ".sandcastle/project.json";

// Statuses are repo config, never literals in lib.ts: these are synthetic
// fixtures, deliberately unrelated to whatever this repo's workflow declares.
const STATUSES = { inReview: "in review", needsInfo: "needs-info" };

const child = (overrides: Partial<ChildTask>): ChildTask => ({
  id: "t01",
  title: "slice",
  status: "backlog",
  tags: ["ready-for-agent"],
  blockedBy: [],
  dateCreated: 1,
  body: "",
  ...overrides,
});

// ── The contract with the repo's own config files ────────────────────────────
// These assert the *shape* the worker depends on, not this repo's values: the
// values are free to change, the contract is not.

test("parseTaskWorkflow reads the real task-workflow.md contract", () => {
  const workflowDoc = readFileSync(WORKFLOW_DOC, "utf8");
  const config = parseTaskWorkflow(workflowDoc);

  for (const [field, value] of Object.entries(config.statuses)) {
    assert.ok((value as string).length > 0, `status role '${field}' is empty`);
  }
  for (const field of ["backlog", "planned", "inProgress", "inReview"] as const) {
    assert.ok(
      config.statuses[field].startsWith(STATUS_LABEL_PREFIX),
      `status role '${field}' must be a '${STATUS_LABEL_PREFIX}*' label, got '${config.statuses[field]}'`,
    );
  }
  for (const field of [
    "baseBranch",
    "mrCli",
    "workLogPath",
    "domainDoc",
    "sliceMandatePath",
    "closeMandatePath",
  ] as const) {
    assert.ok((config[field] as string).length > 0, `'${field}' is empty`);
  }
  assert.ok(config.gate.host.length > 0, "the Host gate block should list its commands");
  assert.ok(config.gate.sandbox.length > 0, "the Sandbox gate block should list its commands");
  assert.ok(config.gate.sandboxSlice.length > 0, "the slice gate should list its commands");
  // The guard is looser than the parser on purpose: a slice heading typed with
  // the wrong dash would fail both and let the degradation pass silently.
  if (/sandbox.*slice/i.test(workflowDoc)) {
    assert.notDeepEqual(
      config.gate.sandboxSlice,
      config.gate.sandbox,
      "the doc declares two tiers; identical lists mean the slice heading silently failed to parse",
    );
  }
});

test("the slice gate is its own tier, falling back to the full gate when absent", () => {
  const twoTiers = [
    "| Backlog | `b` |\n| Planned | `p` |\n| In progress | `i` |\n| In review | `r` |\n| Blocked on a human | `n` |",
    "Base/integration branch: `main` · MR CLI: `glab` · Work log `plans/{parent-id}.md`",
    "Domain docs `docs/GLOSSARY.md` · Slice mandate — canonical: `s.md` · Parent close mandate: `c.md`",
    "## Quality gate",
    "### Host\n\n```bash\nmake test\n```",
    "### Sandbox\n\n```bash\npytest\nnpx vitest run\n```",
    "### Sandbox — slice\n\n```bash\npytest --testmon\n```",
  ].join("\n\n");
  const config = parseTaskWorkflow(twoTiers);
  assert.deepEqual(config.gate.sandbox, ["pytest", "npx vitest run"]);
  assert.deepEqual(config.gate.sandboxSlice, ["pytest --testmon"]);

  const oneTier = twoTiers.slice(0, twoTiers.indexOf("### Sandbox — slice"));
  const fallback = parseTaskWorkflow(oneTier);
  assert.deepEqual(fallback.gate.sandboxSlice, fallback.gate.sandbox);
});

test("the work-log path keeps {parent-id} unresolved so the caller substitutes it", () => {
  const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));

  assert.ok(config.workLogPath.includes("{parent-id}"), "Work log must be a template");
  assert.equal(
    workLogFor({ workLogPath: "work-logs/{parent-id}.md" }, "86cxxx"),
    "work-logs/86cxxx.md",
  );
});

test("the mandates the workflow points at exist and are the ones the worker feeds", () => {
  const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));
  const sliceMandate = declaredPlaceholders(readFileSync(config.sliceMandatePath, "utf8"));
  const closeMandate = declaredPlaceholders(readFileSync(config.closeMandatePath, "utf8"));

  for (const shared of [
    "BASE_BRANCH",
    "BRANCH",
    "DOMAIN_DOC",
    "ENVIRONMENT",
    "GATE",
    "PARENT_ID",
    "PUSH_POLICY",
    "SPEC_FILE",
    "WORK_LOG",
  ]) {
    assert.ok(sliceMandate.includes(shared), `the slice mandate does not declare ${shared}`);
    assert.ok(closeMandate.includes(shared), `the close mandate does not declare ${shared}`);
  }
  assert.ok(sliceMandate.includes("SLICE_SPEC"), "the slice mandate must inline the slice spec");
});

test("the loose task mandate, when declared, exists and declares what tasks.ts feeds", () => {
  const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));
  if (!config.taskMandatePath) return;
  const taskMandate = declaredPlaceholders(readFileSync(config.taskMandatePath, "utf8"));

  assert.deepEqual(taskMandate, [
    "BASE_BRANCH",
    "BRANCH",
    "BRANCH_NOTE",
    "DOMAIN_DOC",
    "ENVIRONMENT",
    "GATE",
    "PUSH_POLICY",
    "TASK_ID",
    "TASK_SPEC",
    "TASK_TITLE",
  ]);
});

test("the loose task mandate is optional, so a doc that predates it still parses", () => {
  const withoutTaskMandate = parseTaskWorkflow(workflowDocWith(""));
  assert.equal(withoutTaskMandate.taskMandatePath, undefined);

  const withTaskMandate = parseTaskWorkflow(
    `${workflowDocWith("")}\n- **Loose task mandate**: \`docs/agents/prompts/task.md\` — one task outside any plan.`,
  );
  assert.equal(withTaskMandate.taskMandatePath, "docs/agents/prompts/task.md");
});

test("the QA mandate, when declared, exists and declares what the QA phase feeds", () => {
  const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));
  if (!config.qaMandatePath) return;
  const qaMandate = declaredPlaceholders(readFileSync(config.qaMandatePath, "utf8"));

  assert.deepEqual(qaMandate, [
    "APP_UP",
    "APP_URL",
    "BASE_BRANCH",
    "BRANCH",
    "BROWSER_LANE",
    "CREDENTIALS",
    "ENVIRONMENT",
    "PARENT_ID",
    "PARENT_TITLE",
    "QA_CHECKLIST",
    "QA_ID",
    "SPEC_FILE",
    "WORK_LOG",
  ]);
  assert.ok(config.qa, "a QA mandate needs the '## QA' section the phase reads its values from");
});

test("the QA section is optional and parses lanes, cycles and the two app-up tiers", () => {
  const without = parseTaskWorkflow(workflowDocWith(""));
  assert.equal(without.qa, undefined);
  assert.equal(without.qaMandatePath, undefined);

  const withQa = parseTaskWorkflow(
    [
      workflowDocWith(""),
      "- **QA mandate**: `docs/agents/prompts/qa.md` — the verification pass.",
      "## QA",
      "- Browser lane: `yes`",
      "- QA↔fix cycles: `3`",
      "- Credentials: `user / pass`",
      "### Host\n\n```bash\nmake up\n```\n\n- App URL (host): `http://localhost:8080`",
      "### Sandbox\n\n```bash\ncd src && php artisan migrate --seed\ncd src && nohup php artisan serve &\n```\n\n- App URL (sandbox): `http://127.0.0.1:8000`",
      "## Paths",
    ].join("\n\n"),
  );
  assert.equal(withQa.qaMandatePath, "docs/agents/prompts/qa.md");
  assert.deepEqual(withQa.qa, {
    browserLane: true,
    maxCycles: 3,
    credentials: "user / pass",
    hostUp: ["make up"],
    hostUrl: "http://localhost:8080",
    sandboxUp: ["cd src && php artisan migrate --seed", "cd src && nohup php artisan serve &"],
    sandboxUrl: "http://127.0.0.1:8000",
  });

  const defaults = parseTaskWorkflow(`${workflowDocWith("")}\n## QA\n\n- Browser lane: \`no\`\n`);
  assert.equal(defaults.qa?.browserLane, false);
  assert.equal(defaults.qa?.maxCycles, 2);
});

// ── QA checklist (task-workflow.md "QA") ─────────────────────────────────────

const CHECKLIST = [
  "Intro line kept as is.",
  "",
  "- [ ] Login works",
  "- [x] Dashboard lists 3 cards",
  "  → ✅ agente: 3 cards seen at /dashboard",
  "- [ ] Export downloads a CSV",
  "  → ❌ FALLÓ: esperado: 200 · observado: 500",
  "- [ ] Looks good on the iPad",
  "  → 🙋 humano: needs the device",
].join("\n");

test("parseChecklist settles ✅ and 🙋 and keeps bare and ❌ items pending", () => {
  const items = parseChecklist(CHECKLIST);
  assert.deepEqual(
    items.map((i) => [i.index, i.text, i.verdict, i.pending]),
    [
      [1, "Login works", undefined, true],
      [2, "Dashboard lists 3 cards", "pass", false],
      [3, "Export downloads a CSV", "fail", true],
      [4, "Looks good on the iPad", "human", false],
    ],
  );
  const rendered = renderChecklistForAgent(items);
  assert.match(rendered, /^1\. Login works$/m);
  assert.match(rendered, /^3\. Export downloads a CSV \(❌ en el ciclo anterior — re-verificar\)$/m);
  assert.match(rendered, /^~~2\. Dashboard lists 3 cards~~ \(✅ ya verificado\)$/m);
});

test("applyQaVerdicts rewrites only the reported items and replaces a stale verdict line", () => {
  const updated = applyQaVerdicts(CHECKLIST, [
    { index: 1, verdict: "pass", evidence: "redirected to /dashboard" },
    { index: 3, verdict: "fail", evidence: "still 500", expected: "200 + csv", observed: "500", steps: "GET /export" },
  ]);
  assert.deepEqual(updated.split("\n"), [
    "Intro line kept as is.",
    "",
    "- [x] Login works",
    "  → ✅ agente: redirected to /dashboard",
    "- [x] Dashboard lists 3 cards",
    "  → ✅ agente: 3 cards seen at /dashboard",
    "- [ ] Export downloads a CSV",
    "  → ❌ FALLÓ: esperado: 200 + csv · observado: 500",
    "- [ ] Looks good on the iPad",
    "  → 🙋 humano: needs the device",
  ]);
  // Round trip: the rewritten checklist parses back with the new verdicts.
  assert.deepEqual(parseChecklist(updated).map((i) => i.pending), [false, false, true, false]);
});

test("parseChecklist tolerates a blank line between an item and its verdict", () => {
  const spaced = "- [x] Login works\n\n  → ✅ agente: ok\n- [ ] Export\n";
  assert.deepEqual(parseChecklist(spaced).map((i) => [i.verdict, i.pending]), [["pass", false], [undefined, true]]);
  const updated = applyQaVerdicts(spaced, [{ index: 1, verdict: "fail", evidence: "broke" }]);
  assert.deepEqual(updated.split("\n"), ["- [ ] Login works", "  → ❌ FALLÓ: broke", "- [ ] Export", ""]);
});

test("buildFixChild turns a ❌ into a slice spec with the prefix the queue treats as a slice", () => {
  assert.equal(buildFixChild({ text: "[agente] Export works" }, { index: 1, verdict: "fail", evidence: "x" }, "q").title, `${QA_FIX_PREFIX} Export works`);
  const fix = buildFixChild(
    { text: "Export downloads a CSV" },
    { index: 3, verdict: "fail", evidence: "x", expected: "200 + csv", observed: "500", steps: "GET /export" },
    "qa1",
  );
  assert.equal(fix.title, `${QA_FIX_PREFIX} Export downloads a CSV`);
  assert.match(fix.body, /Esperado: 200 \+ csv/);
  assert.match(fix.body, /Observado: 500/);
  assert.match(fix.body, /GET \/export/);
  assert.equal(classifyChildren([child({ id: "f1", title: fix.title, body: fix.body })]).slices.length, 1);
});

test("buildQaComment rolls up totals, failures with their [FIX] and the human lane", () => {
  const items = parseChecklist(CHECKLIST);
  const comment = buildQaComment({
    cycle: 1,
    items,
    results: [
      { index: 1, verdict: "pass", evidence: "ok" },
      { index: 3, verdict: "fail", evidence: "x", expected: "200", observed: "500" },
    ],
    fixes: [{ id: "f1", title: "[FIX] Export downloads a CSV" }],
  });
  assert.match(comment, /ciclo 1: ✅ 1 · ❌ 1 · 🙋 0/);
  assert.match(comment, /- Export downloads a CSV — esperado: 200 · observado: 500/);
  assert.match(comment, /- f1 \[FIX\] Export downloads a CSV/);
});

test("no mandate hardcodes the environment that project.json owns", () => {
  const config = parseTaskWorkflow(readFileSync(WORKFLOW_DOC, "utf8"));
  const { environment } = parseProjectConfig(readFileSync(PROJECT_DOC, "utf8"));
  const owned = environment.split(".")[0].trim();

  const mandates = [config.sliceMandatePath, config.closeMandatePath, config.taskMandatePath, config.qaMandatePath];
  for (const path of mandates.filter((p): p is string => !!p)) {
    assert.ok(
      !readFileSync(path, "utf8").includes(owned),
      `${path} duplicates project.json's prose instead of using {{ENVIRONMENT}}`,
    );
  }
});

test("parseProjectConfig reads the real project.json and defaults the optionals", () => {
  const project = parseProjectConfig(readFileSync(PROJECT_DOC, "utf8"));
  assert.ok(project.image.length > 0);
  assert.ok(project.setup.length > 0);
  assert.ok(project.environment.length > 0);

  const minimal = parseProjectConfig('{"image":"x:local","setup":["true"],"environment":"un sandbox"}');
  assert.deepEqual(minimal.mounts, []);
  assert.deepEqual(minimal.serviceChecks, []);
  assert.equal(minimal.setupTimeoutMs, 900_000);

  assert.throws(() => parseProjectConfig('{"image":"x:local"}'), /missing 'setup'/);
});

test("parseTaskWorkflow fails loudly instead of falling back to hardcoded values", () => {
  const withoutSandboxGate = "## Quality gate\n\n### Host\n\n```bash\nmake test\n```\n";
  assert.throws(() => parseTaskWorkflow(withoutSandboxGate), /Sandbox/);
  assert.throws(() => parseTaskWorkflow("# nothing here"), /Quality gate|status row|backticked/);
});

// ── Pure logic ───────────────────────────────────────────────────────────────

test("repoFromRemote reads owner/repo from https and ssh remotes", () => {
  assert.equal(repoFromRemote("https://github.com/acme/app.git\n"), "acme/app");
  assert.equal(repoFromRemote("https://github.com/acme/app"), "acme/app");
  assert.equal(repoFromRemote("git@github.com:acme/app.git"), "acme/app");
  assert.throws(() => repoFromRemote("https://gitlab.com/acme/app.git"), /not a GitHub repo/);
});

test("statusFromLabels picks the status label and ignores the rest", () => {
  assert.equal(statusFromLabels(["ready-for-agent", "status:in-review", "sonnet"]), "status:in-review");
  assert.equal(statusFromLabels(["ready-for-agent"]), "");
});

test("parseDotEnv reads KEY=VALUE, ignores comments and blanks", () => {
  const env = parseDotEnv(
    "# comment\nCLAUDE_CODE_OAUTH_TOKEN=abc\n\nGH_TOKEN=ghp_123\nQUOTED=\"x y\"\n",
  );
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "abc");
  assert.equal(env.GH_TOKEN, "ghp_123");
  assert.equal(env.QUOTED, "x y");
  assert.equal(env["# comment"], undefined);
});

test("parseParentIds splits on commas, trims, drops empties and dedupes", () => {
  assert.deepEqual(parseParentIds("86cxxxxxx"), ["86cxxxxxx"]);
  assert.deepEqual(parseParentIds("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(parseParentIds(" a , b ,"), ["a", "b"]);
  assert.deepEqual(parseParentIds("a,,b"), ["a", "b"]);
  assert.deepEqual(parseParentIds("a,b,a"), ["a", "b"]);
});

test("branchNameFor slugifies title with accents and caps length", () => {
  assert.equal(
    branchNameFor("86cavz8mg", "Migrar Latitud y Longitud de CPD"),
    "feature/86cavz8mg-migrar-latitud-y-longitud-de-cpd",
  );
  const long = branchNameFor("86cavz8mg", "á".repeat(100));
  assert.ok(long.length <= 60, `expected <=60 chars, got ${long.length}`);
  assert.ok(!long.endsWith("-"));
});

test("extractBranchFromDescription finds the Rama block", () => {
  assert.equal(
    extractBranchFromDescription("## Planificado\n- Rama: `feature/x-y`\nmore"),
    "feature/x-y",
  );
  assert.equal(extractBranchFromDescription("no branch here"), undefined);
});

test("extractBranchFromDescription tolerates the tracker's markdown renderings", () => {
  assert.equal(
    extractBranchFromDescription("## Planificado\n\n*   Rama: `feature/x-y`"),
    "feature/x-y",
  );
  assert.equal(
    extractBranchFromDescription("Planificado\n\nRama: feature/x-y"),
    "feature/x-y",
  );
});

test("classifyChildren splits the plan children by title prefix", () => {
  const spec = child({ id: "s", title: "[SPEC] Sync de citas" });
  const docs = child({ id: "d", title: "[DOCS] Sync de citas" });
  const qa = child({ id: "q", title: "[QA] Sync de citas" });
  const slice1 = child({ id: "t1", title: "Endpoint de sync" });
  const legacySpec = child({ id: "p", title: "[PRD] Viejo" });

  const plan = classifyChildren([spec, docs, qa, slice1]);
  assert.equal(plan.spec?.id, "s");
  assert.equal(plan.docs?.id, "d");
  assert.equal(plan.qa?.id, "q");
  assert.deepEqual(plan.slices.map((s) => s.id), ["t1"]);

  assert.equal(classifyChildren([legacySpec]).spec?.id, "p");
});

test("extractTaggedJson takes the last block and reports unusable output", () => {
  const stdout = [
    "bla bla",
    '<result>{"outcome":"blocked"}</result>',
    "me equivoqué, va de nuevo",
    '<result>{"outcome":"done","summary":"listo"}</result>',
    "<promise>COMPLETE</promise>",
  ].join("\n");

  assert.deepEqual(extractTaggedJson(stdout, "result"), { outcome: "done", summary: "listo" });
  assert.throws(() => extractTaggedJson("no tags here", "result"), /no <result> block/);
  assert.throws(() => extractTaggedJson("<result>{nope}</result>", "result"), /not valid JSON/);
});

test("detectRateLimit matches the hard-limit wordings and nothing else", () => {
  assert.ok(detectRateLimit("claude-code exited with code 1:\nClaude AI usage limit reached|1755603600"));
  assert.ok(detectRateLimit('API Error: 429 {"error":{"type":"rate_limit_error"}}'));
  assert.ok(detectRateLimit("Overloaded"));
  assert.ok(!detectRateLimit("agent reported done but made no commits"));
  assert.ok(!detectRateLimit("claude-code exited with code 1:\nidle timeout"));
});

test("rateLimitResetMs parses an epoch after a pipe or 'resets at', ignoring the past", () => {
  const now = 1_755_600_000_000;
  assert.equal(rateLimitResetMs("usage limit reached|1755603600", now), 1_755_603_600_000);
  assert.equal(rateLimitResetMs("usage limit reached| 1755603600", now), 1_755_603_600_000);
  assert.equal(rateLimitResetMs("rate limited, resets at 1755603600", now), 1_755_603_600_000);
  assert.equal(rateLimitResetMs("usage limit reached|1755603600000", now), 1_755_603_600_000);
  assert.equal(rateLimitResetMs("usage limit reached|1755500000", now), undefined);
  assert.equal(rateLimitResetMs("usage limit reached, resets 3pm", now), undefined);
});

test("rateLimitWaitMs sleeps to the reset plus margin, falls back blind, respects the cap", () => {
  const base = {
    now: 1_755_600_000_000,
    marginMs: 60_000,
    fallbackMs: 1_800_000,
    maxMs: 21_600_000,
  };
  assert.equal(rateLimitWaitMs({ ...base, message: "reached|1755603600" }), 3_660_000);
  assert.equal(rateLimitWaitMs({ ...base, message: "rate limit, no timestamp" }), 1_800_000);
  assert.equal(rateLimitWaitMs({ ...base, message: "reached|1755700000" }), 21_600_000);
});

test("commitTypeFor maps the branch prefix, defaulting to feat", () => {
  assert.equal(commitTypeFor("fix/86c-algo"), "fix");
  assert.equal(commitTypeFor("chore/86c-algo"), "chore");
  assert.equal(commitTypeFor("feature/86c-algo"), "feat");
  assert.equal(commitTypeFor("raro"), "feat");
});

test("closeDecision opens the MR when every queued slice landed", () => {
  const done = child({ id: "t01", status: STATUSES.inReview });
  const classified = classifySlices([done], STATUSES);
  const decision = closeDecision(
    classified,
    [{ slice: done, state: "done", detail: "abc123" }],
    STATUSES.inReview,
  );

  assert.deepEqual(decision, { openMr: true, setInReview: true, pending: [] });
});

test("closeDecision keeps the parent open while HITL slices are undrained", () => {
  const done = child({ id: "t01", status: STATUSES.inReview });
  const hitl = child({ id: "t02", tags: ["ready-for-human"] });
  const classified = classifySlices([done, hitl], STATUSES);
  const decision = closeDecision(
    classified,
    [{ slice: done, state: "done", detail: "abc123" }],
    STATUSES.inReview,
  );

  assert.equal(decision.openMr, true, "the AFK work is reviewable");
  assert.equal(decision.setInReview, false, "unbuilt HITL work blocks the status flip");
  assert.deepEqual(decision.pending, ["slice t02 HITL sin drenar"]);
});

test("closeDecision blocks the MR on a red gate, needs-info or a failed run", () => {
  const red = child({ id: "t01" });
  const stuck = child({ id: "t02", tags: ["ready-for-agent", STATUSES.needsInfo] });
  const classified = classifySlices([red, stuck], STATUSES);
  const decision = closeDecision(
    classified,
    [{ slice: red, state: "gate-red", detail: "lint" }],
    STATUSES.inReview,
  );

  assert.equal(decision.openMr, false);
  assert.deepEqual(decision.pending, ["slice t01 gate-red (lint)", "slice t02 needs-info"]);
});

test("buildRollupComment is the close paragraph, plus pendings only when they exist", () => {
  const paragraph = "Las citas vuelven a sincronizarse solas con el calendario del veterinario.";
  const clean = buildRollupComment({ comment: paragraph, pending: [] });
  assert.equal(clean, paragraph);

  const partial = buildRollupComment({
    comment: paragraph,
    pending: ["slice t02 HITL sin drenar"],
  });
  assert.ok(partial.startsWith(paragraph));
  assert.ok(partial.includes("⏳ Pendiente:"));
  assert.ok(partial.includes("- slice t02 HITL sin drenar"));
  assert.ok(!partial.includes("Rama"));
  assert.ok(!partial.includes("hija [QA]"));

  const legacy = buildRollupComment({ comment: null, pending: [] });
  assert.ok(legacy.includes("el resumen está en la descripción"));
});

test("buildMrDescription takes the pr shape: summary, evidence, merge danger, task", () => {
  const done = child({ id: "t01" });
  const description = buildMrDescription({
    outcomes: [
      { slice: done, state: "done", detail: "sincroniza citas" },
      { slice: child({ id: "t02" }), state: "needs-info", detail: "gate rojo" },
    ],
    reviewLine: "fixes aplicados (abc123)",
    reviewNotes: ["Slice t01: naming ambiguo en el mapper"],
    handbookLine: "src/resources/handbook/citas.md",
    evidence: { before: "las citas no se sincronizaban", after: gateEvidenceLine(["php artisan test"], "abc123") },
    mergeDanger: { door: "de dos vías", door_note: "se revierte con un revert", blast_radius: "acotado", blast_note: null },
    taskUrl: "https://github.com/acme/app/issues/42",
  });

  assert.ok(description.startsWith("## Resumen\n- Slice t01: sincroniza citas\n📖 Handbook: src/resources/handbook/citas.md"));
  assert.ok(!description.includes("t02"));
  assert.ok(description.includes("## Evidencia\n- **Antes:** las citas no se sincronizaban\n  **Después:** gate verde sobre `abc123`: `php artisan test`"));
  assert.ok(description.includes("## Riesgo de merge\n**Puerta:** de dos vías\n\nse revierte con un revert\n\n**Radio de impacto:** acotado"));
  assert.ok(description.includes("🔍 Code review: fixes aplicados (abc123)"));
  assert.ok(description.includes("- Slice t01: naming ambiguo en el mapper"));
  assert.ok(!description.includes("## Revisión"));
  assert.ok(description.endsWith("## Tarea\nhttps://github.com/acme/app/issues/42"));
});

test("buildMrDescription degrades when the close mandate gave no merge-danger call", () => {
  const description = buildMrDescription({
    outcomes: [{ slice: child({ id: "t01" }), state: "done", detail: "sincroniza citas" }],
    taskUrl: "https://github.com/acme/app/issues/42",
  });
  assert.ok(description.includes("## Riesgo de merge\n**Puerta:** sin evaluar\n\n**Radio de impacto:** sin evaluar"));
  assert.ok(!description.includes("## Evidencia"));
  assert.ok(!description.includes("Code review"));
  assert.equal(gateEvidenceLine(["make test"], "abc", "red"), "gate rojo sobre `abc` — revisar antes de mergear");
  assert.match(gateEvidenceLine(["make test"], "abc", "skipped"), /^gate sin correr sobre `abc`/);
});

test("upsertSection appends the section once and replaces it on re-runs", () => {
  const original = "Pedido del jefe.\n\n## Planificado\n\n- Rama: `feature/x`\n";
  const first = upsertSection(original, "## Resumen", "v1\n\n### Estado\n\n- Rama: `feature/x`");
  assert.ok(first.includes("## Planificado"));
  assert.ok(first.includes("- Rama: `feature/x`"));
  assert.ok(first.trimEnd().endsWith("- Rama: `feature/x`"));
  assert.ok(first.includes("## Resumen\n\nv1"));

  const second = upsertSection(first, "## Resumen", "v2");
  assert.ok(!second.includes("v1"));
  assert.ok(second.includes("## Resumen\n\nv2"));
  assert.equal(second.match(/## Resumen/g)?.length, 1);
  assert.ok(second.includes("## Planificado"));
});

test("upsertSection with position start puts the report before the plan block", () => {
  const original = "Pedido del jefe.\n\n## Planificado\n\n- Rama: `feature/x`\n";
  const first = upsertSection(original, "## Resumen", "v1", "start");
  assert.ok(first.startsWith("## Resumen\n\nv1"));
  assert.ok(first.includes("Pedido del jefe."));
  assert.ok(first.includes("## Planificado"));

  const rerun = upsertSection(first, "## Resumen", "v2", "start");
  assert.ok(rerun.startsWith("## Resumen\n\nv2"));
  assert.ok(!rerun.includes("v1"));
  assert.equal(rerun.match(/## Resumen/g)?.length, 1);

  const migrated = upsertSection(original + "\n## Resumen\n\nviejo al final\n", "## Resumen", "v3", "start");
  assert.ok(migrated.startsWith("## Resumen\n\nv3"));
  assert.ok(!migrated.includes("viejo al final"));
  assert.ok(migrated.includes("## Planificado"));
});

test("upsertSection replaces up to the next section, keeping later ones", () => {
  const original = "## Resumen\n\nviejo\n\n### Estado\n\n- Rama: `x`\n\n## Planificado\n\n- Spec: [SPEC]\n";
  const updated = upsertSection(original, "## Resumen", "nuevo");
  assert.ok(!updated.includes("viejo"));
  assert.ok(!updated.includes("### Estado"));
  assert.ok(updated.includes("## Planificado\n\n- Spec: [SPEC]"));
});

test("buildResumenSection appends the state block the close agent cannot know", () => {
  const section = buildResumenSection({
    report: "La sincronización fallaba.\n\n### Qué se hizo\n\n- Las citas se sincronizan solas.",
    branch: "fix/86cxxx-sync",
    mrUrl: "https://gitlab/mr/7",
    pending: ["slice t02 HITL sin drenar"],
  });

  assert.ok(section.startsWith("La sincronización fallaba."));
  assert.ok(section.includes("### Estado"));
  assert.ok(section.includes("- Rama: `fix/86cxxx-sync` → MR: https://gitlab/mr/7"));
  assert.ok(section.includes("- ⏳ Pendiente: slice t02 HITL sin drenar · QA manual (hija [QA] del padre)"));
});

test("buildResumenSection without QA lists only what is really pending", () => {
  const clean = buildResumenSection({ report: "Arreglado.", branch: "fix/86c-x", pending: [], withQa: false });
  assert.ok(clean.includes("- Rama: `fix/86c-x`"));
  assert.ok(!clean.includes("Pendiente"));

  const pending = buildResumenSection({ report: "Casi.", branch: "fix/86c-x", pending: ["gate rojo"], withQa: false });
  assert.ok(pending.includes("- ⏳ Pendiente: gate rojo"));
  assert.ok(!pending.includes("QA manual"));
});

test("classifySlices routes hitl, needs-info, done and pending", () => {
  const hitl = child({ id: "t04", tags: ["ready-for-human"] });
  const needsInfo = child({ id: "t03", tags: ["ready-for-agent", STATUSES.needsInfo] });
  const done = child({ id: "t02", status: STATUSES.inReview });
  const pending = child({ id: "t01" });

  const c = classifySlices([hitl, needsInfo, done, pending], STATUSES);
  assert.deepEqual(c.hitl.map((s) => s.id), ["t04"]);
  assert.deepEqual(c.needsInfo.map((s) => s.id), ["t03"]);
  assert.deepEqual(c.done.map((s) => s.id), ["t02"]);
  assert.deepEqual(c.pending.map((s) => s.id), ["t01"]);
});

test("status and tag comparisons ignore case", () => {
  assert.ok(statusIs("IN REVIEW", "in review"));
  assert.ok(statusIs("backlog", "in review", "backlog"));
  assert.ok(!statusIs("planned", "backlog"));
  assert.ok(hasTag(child({ tags: ["Ready-For-Human"] }), "ready-for-human"));
  assert.ok(!hasTag(child({ tags: [] }), "ready-for-human"));
});

test("orderSlices sorts by creation date with blockers first", () => {
  const a = child({ id: "ta", dateCreated: 1, blockedBy: ["tb"] });
  const b = child({ id: "tb", dateCreated: 2 });
  const c = child({ id: "tc", dateCreated: 3, blockedBy: ["ta"] });
  assert.deepEqual(orderSlices([a, b, c]).map((s) => s.id), ["tb", "ta", "tc"]);
});

test("orderSlices ignores blockers outside the set and falls back to creation order on cycles", () => {
  const external = child({ id: "t05", dateCreated: 2, blockedBy: ["t99"] });
  const first = child({ id: "t01", dateCreated: 1 });
  assert.deepEqual(orderSlices([external, first]).map((s) => s.id), ["t01", "t05"]);

  const cycleA = child({ id: "t02", dateCreated: 2, blockedBy: ["t01"] });
  const cycleB = child({ id: "t01", dateCreated: 1, blockedBy: ["t02"] });
  assert.deepEqual(orderSlices([cycleA, cycleB]).map((s) => s.id), ["t01", "t02"]);
});

test("pendingBlockers unblocks on reviewed or completed-in-run dependencies", () => {
  const blocked = child({ id: "t03", blockedBy: ["t01", "t02", "t07"] });
  const reviewedDep = child({ id: "t01", status: "IN REVIEW" });
  const staleDep = child({ id: "t02", status: "backlog" });

  assert.deepEqual(
    pendingBlockers(blocked, [reviewedDep, staleDep], new Set(), STATUSES.inReview),
    ["t02", "t07"],
  );
  assert.deepEqual(
    pendingBlockers(blocked, [reviewedDep, staleDep], new Set(["t02", "t07"]), STATUSES.inReview),
    [],
  );
});

test("buildQueue orders pending slices, excluding hitl/done/needs-info", () => {
  const done = child({ id: "t01", dateCreated: 1, status: STATUSES.inReview });
  const second = child({ id: "t03", dateCreated: 3, blockedBy: ["t02"] });
  const first = child({ id: "t02", dateCreated: 2, blockedBy: ["t01"] });
  const hitl = child({ id: "t04", dateCreated: 4, tags: ["ready-for-human"] });
  const stuck = child({ id: "t05", dateCreated: 5, tags: ["ready-for-agent", STATUSES.needsInfo] });

  const queue = buildQueue(classifySlices([done, second, first, hitl, stuck], STATUSES));
  assert.deepEqual(queue.map((s) => s.id), ["t02", "t03"]);
});

test("a [DOCS] child created last still runs first through its dependencies", () => {
  const docs = child({ id: "td", title: "[DOCS] Glosario", dateCreated: 9 });
  const slice1 = child({ id: "t01", dateCreated: 1, blockedBy: ["td"] });
  const slice2 = child({ id: "t02", dateCreated: 2, blockedBy: ["td", "t01"] });

  const queue = buildQueue(classifySlices([docs, slice1, slice2], STATUSES));
  assert.deepEqual(queue.map((s) => s.id), ["td", "t01", "t02"]);
});

test("contextWindowTokens sums everything the agent had to read", () => {
  const usage = {
    inputTokens: 1_200,
    cacheCreationInputTokens: 4_000,
    cacheReadInputTokens: 80_000,
    outputTokens: 900,
  };
  assert.equal(contextWindowTokens(usage), 85_200);
  assert.equal(formatTokens(85_200), "85.2k");
  assert.equal(formatTokens(940), "940");
});

test("cacheHitRate aggregates reads over everything fed in, across iterations", () => {
  const iteration = (read: number, creation: number, input: number) => ({
    inputTokens: input,
    cacheCreationInputTokens: creation,
    cacheReadInputTokens: read,
    outputTokens: 0,
  });
  assert.equal(cacheHitRate([iteration(60, 30, 10)]), 0.6);
  assert.equal(cacheHitRate([iteration(0, 100, 0), iteration(100, 0, 0)]), 0.5);
  assert.equal(cacheHitRate([]), undefined);
  assert.equal(cacheHitRate([iteration(0, 0, 0)]), undefined);
});

test("formatDuration reads like a clock", () => {
  assert.equal(formatDuration(42_000), "42s");
  assert.equal(formatDuration(272_000), "4m32s");
  assert.equal(formatDuration(3_915_000), "1h05m");
});

test("buildFinalSummary reports slices with their last window, the MR and the status flip", () => {
  const first = child({ id: "t01", title: "endpoint de sync" });
  const second = child({ id: "t02", title: "pantalla de citas" });
  const summary = buildFinalSummary({
    parentId: "86cxxx",
    parentTitle: "Sync de citas",
    branch: "feature/86cxxx-sync",
    baseBranch: "dev",
    outcomes: [
      {
        slice: first,
        state: "done",
        detail: "sincroniza citas",
        usage: {
          inputTokens: 1_000,
          cacheCreationInputTokens: 2_000,
          cacheReadInputTokens: 60_000,
          outputTokens: 1_500,
        },
        cacheHitRate: 0.87,
        agentMs: 272_000,
        gateMs: 42_000,
      },
      { slice: second, state: "done", detail: "lista las citas" },
    ],
    mrUrl: "https://gitlab/mr/7",
    statusSet: true,
    statuses: { inReview: "in review", inProgress: "in progress" },
    pending: [],
  }).join("\n");

  assert.ok(summary.includes("Slices completados (2):"));
  assert.ok(
    summary.includes(
      "✅ t01 endpoint de sync — ventana final 63.0k tok in · 1.5k out · cache 87% · agente 4m32s · gate 42s",
    ),
  );
  assert.ok(summary.includes("✅ t02 pantalla de citas — ventana final n/d"));
  assert.ok(summary.includes("🔀 MR a dev: https://gitlab/mr/7"));
  assert.ok(summary.includes('🔄 Tarea actualizada a "in review"'));
});

test("buildFinalSummary says why the MR is missing and why the parent stayed open", () => {
  const stuck = child({ id: "t01", title: "endpoint" });
  const summary = buildFinalSummary({
    parentId: "86cxxx",
    parentTitle: "Sync de citas",
    branch: "feature/86cxxx-sync",
    baseBranch: "dev",
    outcomes: [{ slice: stuck, state: "gate-red", detail: "lint" }],
    mrSkippedReason: "el trabajo del padre no está completo",
    statusSet: false,
    statuses: { inReview: "in review", inProgress: "in progress" },
    pending: ["slice t01 gate-red (lint)"],
  }).join("\n");

  assert.ok(summary.includes("Slices completados (0):\n  (ninguno)"));
  assert.ok(summary.includes("⚠️ t01 endpoint — gate-red: lint"));
  assert.ok(summary.includes("no creado (el trabajo del padre no está completo)"));
  assert.ok(summary.includes('sigue en "in progress" — pendiente: slice t01 gate-red (lint)'));
});

test("buildFinalSummary still flips the status when only the closing review failed", () => {
  const done = child({ id: "t01", title: "catálogo de acciones" });
  const summary = buildFinalSummary({
    parentId: "86cayfu76",
    parentTitle: "Catálogo de acciones comerciales",
    branch: "feature/86cayfu76-catalogo",
    baseBranch: "dev",
    outcomes: [{ slice: done, state: "done", detail: "expone el catálogo" }],
    mrUrl: "https://gitlab/mr/396",
    statusSet: true,
    statuses: { inReview: "in review", inProgress: "in progress" },
    pending: [],
    warnings: ["review de cierre incompleto — revisar el diff a mano"],
  }).join("\n");

  assert.ok(summary.includes("⚠️ review de cierre incompleto — revisar el diff a mano"));
  assert.ok(summary.includes('🔄 Tarea actualizada a "in review"'));
  assert.ok(!summary.includes('sigue en "in progress"'));
});

test("buildRollupComment flags a warned close without reopening the parent", () => {
  const comment = buildRollupComment({
    comment: "El catálogo quedó operativo.",
    pending: [],
    warnings: ["review de cierre incompleto — revisar el diff a mano"],
  });

  assert.ok(comment.startsWith("El catálogo quedó operativo."));
  assert.ok(comment.includes("⚠️ review de cierre incompleto — revisar el diff a mano"));
  assert.ok(!comment.includes("Pendiente:"));
});

test("buildTriageComment starts with the mandatory disclaimer and includes the reason", () => {
  const comment = buildTriageComment("no pude resolver la migración", "probé X e Y");
  assert.ok(comment.startsWith("> *This was generated by AI during triage.*"));
  assert.ok(comment.includes("probé X e Y"));
  assert.ok(comment.includes("no pude resolver la migración"));
});

test("mirrorBranchFor namespaces the parent branch", () => {
  assert.equal(
    mirrorBranchFor("feature/86cayfu7u-formulario"),
    "sandcastle/feature/86cayfu7u-formulario",
  );
});

const worktreeList = [
  "worktree /repo",
  "HEAD aaa111",
  "branch refs/heads/dev",
  "",
  "worktree /repo/.sandcastle/worktrees/sandcastle-feature-x",
  "HEAD bbb222",
  "branch refs/heads/sandcastle/feature/x",
  "",
  "worktree /tmp/scratch",
  "HEAD ccc333",
  "detached",
  "",
].join("\n");

test("worktreeHolding finds the worktree that has the branch checked out", () => {
  assert.equal(
    worktreeHolding(worktreeList, "sandcastle/feature/x"),
    "/repo/.sandcastle/worktrees/sandcastle-feature-x",
  );
});

test("worktreeHolding returns undefined for free and detached branches", () => {
  assert.equal(worktreeHolding(worktreeList, "feature/x"), undefined);
  assert.equal(worktreeHolding("", "feature/x"), undefined);
});

// ── Base branch overrides (task-workflow.md "Branching") ─────────────────────
// A synthetic doc: the contract is the shape parseTaskWorkflow reads, not any
// consumer's values.

const workflowDocWith = (branchingExtra: string): string =>
  [
    "## Statuses",
    "",
    "| Role | Status |",
    "|---|---|",
    "| Backlog | `backlog` |",
    "| Planned | `planned` |",
    "| In progress | `doing` |",
    "| In review | `review` |",
    "| Blocked on a human | `needs-info` |",
    "",
    "## Branching & merge requests",
    "",
    "- Base/integration branch: `dev` (branches are created from it and MRs target it).",
    branchingExtra,
    "- MR CLI: `glab`.",
    "",
    "## Quality gate",
    "",
    "### Sandbox",
    "",
    "```bash",
    "make lint",
    "git diff --name-only origin/{{BASE_BRANCH}}...HEAD",
    "```",
    "",
    "## Paths",
    "",
    "- Work log: `docs/work/{parent-id}.md`",
    "- Domain docs: `docs/GLOSSARY.md`",
    "- Slice mandate — canonical: `docs/agents/prompts/slice.md`",
    "- Parent close mandate: `docs/agents/prompts/close.md`",
  ].join("\n");

test("a doc without special targets routes every branch to the base branch", () => {
  const config = parseTaskWorkflow(workflowDocWith(""));
  assert.deepEqual(config.baseBranchOverrides, []);
  assert.equal(baseBranchFor("hotfix/abc-slug", config), "dev");
  assert.equal(baseBranchFor("feature/abc-slug", config), "dev");
});

test("a 'Hotfix branches (`hotfix/`) target `main` instead' line routes that prefix", () => {
  const config = parseTaskWorkflow(workflowDocWith("- Hotfix branches (`hotfix/`) target `main` instead."));
  assert.deepEqual(config.baseBranchOverrides, [{ prefix: "hotfix/", baseBranch: "main" }]);
  assert.equal(baseBranchFor("hotfix/abc-slug", config), "main");
  assert.equal(baseBranchFor("feature/abc-slug", config), "dev");
  assert.equal(baseBranchFor("hotfixes/abc-slug", config), "dev");
});

test("an invocation override outranks both the prefix routes and the doc's base branch", () => {
  const config = parseTaskWorkflow(workflowDocWith("- Hotfix branches (`hotfix/`) target `main` instead."));
  assert.equal(baseBranchFor("feature/abc-slug", config, "migration-long-lived"), "migration-long-lived");
  assert.equal(baseBranchFor("hotfix/abc-slug", config, "migration-long-lived"), "migration-long-lived");
  // An absent or empty override falls through to the doc, unchanged from before.
  assert.equal(baseBranchFor("hotfix/abc-slug", config, undefined), "main");
  assert.equal(baseBranchFor("hotfix/abc-slug", config, "  "), "main");
  assert.equal(baseBranchFor("feature/abc-slug", config, ""), "dev");
});

test("parseRunFlags reads the run-wide flags and ignores valueless ones", () => {
  assert.deepEqual(parseRunFlags(["86abc", "--dry-run", "--base", "migration", "--model", "opus"]), {
    base: "migration",
    model: "opus",
  });
  assert.deepEqual(parseRunFlags(["86abc,86def", "--branch", "fix/varios"]), { branch: "fix/varios" });
  assert.deepEqual(parseRunFlags(["86abc", "--light-model", "haiku", "--effort", "high"]), {
    lightModel: "haiku",
    effort: "high",
  });
  // A flag with no value (or followed by another flag) is not a value.
  assert.deepEqual(parseRunFlags(["86abc", "--base", "--dry-run"]), {});
  assert.deepEqual(parseRunFlags(["86abc"]), {});
});

test("runFlagArgs round-trips the flags so a multi-parent respawn keeps the overrides", () => {
  const flags = parseRunFlags(["86abc", "--base", "migration", "--model", "opus", "--effort", "low"]);
  const forwarded = runFlagArgs(flags);
  assert.deepEqual(forwarded, ["--base", "migration", "--model", "opus", "--effort", "low"]);
  assert.deepEqual(parseRunFlags(["86def", ...forwarded]), flags);
  assert.deepEqual(runFlagArgs({}), []);
});

test("resolveModel maps the aliases, passes ids through and falls back to the default", () => {
  assert.equal(resolveModel("opus", DEFAULT_MODEL), "claude-opus-5-5");
  assert.equal(resolveModel("Fable", DEFAULT_MODEL), "claude-fable-5-1");
  assert.equal(resolveModel("sonnet", DEFAULT_MODEL), "claude-sonnet-5");
  // An id we do not know yet must reach the provider untouched.
  assert.equal(resolveModel("claude-opus-9-20990101", DEFAULT_MODEL), "claude-opus-9-20990101");
  assert.equal(resolveModel(undefined, DEFAULT_MODEL), "claude-opus-5-5");
  assert.equal(resolveModel("  ", DEFAULT_LIGHT_MODEL), "claude-sonnet-5");
});

test("pickSetting ranks the invocation flag over the shell and the shell over the .env", () => {
  assert.equal(pickSetting({ flag: "opus", shell: "fable", file: "sonnet" }), "opus");
  assert.equal(pickSetting({ shell: "fable", file: "sonnet" }), "fable");
  assert.equal(pickSetting({ file: "sonnet" }), "sonnet");
  assert.equal(pickSetting({ flag: "  ", shell: "", file: "sonnet" }), "sonnet");
  assert.equal(pickSetting({}), undefined);
});

test("effort defaults low for Fable and high for every other model", () => {
  assert.equal(defaultEffortFor("claude-fable-5-1"), "low");
  assert.equal(defaultEffortFor(DEFAULT_MODEL), "high");
  assert.equal(defaultEffortFor("claude-sonnet-5"), "high");
});

test("resolveGateCommands substitutes known vars and leaves unknown placeholders intact", () => {
  const config = parseTaskWorkflow(workflowDocWith(""));
  assert.deepEqual(resolveGateCommands(config.gate.sandbox, { BASE_BRANCH: "main" }), [
    "make lint",
    "git diff --name-only origin/main...HEAD",
  ]);
  assert.deepEqual(resolveGateCommands(["echo {{OTHER}}"], { BASE_BRANCH: "main" }), ["echo {{OTHER}}"]);
});

// ── Loose tasks ──────────────────────────────────────────────────────────────

const looseTask = (overrides: Partial<LooseTask>): LooseTask => ({
  ...child({ tags: [] }),
  subtaskCount: 0,
  closed: false,
  ...overrides,
});

test("branchPrefixFor inverts commitTypeFor", () => {
  assert.equal(branchPrefixFor("feat"), "feature");
  assert.equal(branchPrefixFor("fix"), "fix");
  assert.equal(branchPrefixFor("chore"), "chore");
  for (const type of ["feat", "fix", "chore"] as const) {
    assert.equal(commitTypeFor(`${branchPrefixFor(type)}/86c-x`), type);
  }
});

test("taskMirrorBranchFor is prefix-free, since the type is only known after the run", () => {
  assert.equal(taskMirrorBranchFor("86cabc"), "sandcastle/task-86cabc");
});

test("existingTaskBranch finds a branch an earlier run pushed for the task, whatever its prefix", () => {
  const heads = [
    "a1\trefs/heads/main",
    "b2\trefs/heads/feature/86cabc1-otra-cosa",
    "c3\trefs/heads/fix/86cabc-arregla-login",
  ].join("\n");
  assert.equal(existingTaskBranch(heads, "86cabc"), "fix/86cabc-arregla-login");
  assert.equal(existingTaskBranch(heads, "86czzz"), undefined);
  assert.equal(existingTaskBranch("", "86cabc"), undefined);
});

test("looseTaskRejection routes plan members and finished work away from the loose drain", () => {
  assert.equal(looseTaskRejection(looseTask({}), STATUSES), undefined);
  assert.match(looseTaskRejection(looseTask({ subtaskCount: 3 }), STATUSES)!, /sandcastle-work/);
  assert.match(looseTaskRejection(looseTask({ parentId: "86cparent" }), STATUSES)!, /86cparent/);
  assert.match(looseTaskRejection(looseTask({ closed: true }), STATUSES)!, /cerrada/);
  assert.match(looseTaskRejection(looseTask({ status: "In Review" }), STATUSES)!, /in review/);
  assert.match(looseTaskRejection(looseTask({ tags: ["ready-for-human"] }), STATUSES)!, /humano/);
  assert.match(looseTaskRejection(looseTask({ tags: [STATUSES.needsInfo] }), STATUSES)!, /needs-info/);
});

test("buildLooseMrDescription lists every landed task with its link, evidence and merge danger", () => {
  const description = buildLooseMrDescription({
    outcomes: [
      {
        slice: child({ id: "t1", title: "Login roto" }),
        state: "done",
        detail: "El login vuelve a funcionar.",
        mergeDanger: { door: "de dos vías", blast_radius: "login" },
      },
      { slice: child({ id: "t3", title: "Export CSV" }), state: "done", detail: "Exporta." },
      { slice: child({ id: "t2", title: "Export" }), state: "needs-info", detail: "falta el formato" },
    ],
    reviewNotes: ["Login roto: el helper está duplicado"],
    evidenceAfter: "gate verde sobre `abc`",
    taskUrl: (id) => `https://tracker/${id}`,
  });
  assert.ok(description.startsWith("## Resumen\n- Login roto (https://tracker/t1): El login vuelve a funcionar."));
  assert.ok(!description.includes("falta el formato"));
  assert.ok(description.includes("## Evidencia\n- **Antes:** lo que describe cada tarea\n  **Después:** gate verde sobre `abc`"));
  assert.ok(description.includes("## Riesgo de merge\n- Login roto: puerta de dos vías · radio de impacto login\n- Export CSV: sin evaluar"));
  assert.ok(description.includes("Hallazgos anotados para el revisor:\n- Login roto: el helper está duplicado"));

  const single = buildLooseMrDescription({
    outcomes: [{ slice: child({ id: "t1", title: "Login roto" }), state: "done", detail: "ok", mergeDanger: { door: "de una vía", blast_radius: "sesiones", blast_note: "cierra sesiones" } }],
    reviewNotes: [],
    taskUrl: (id) => id,
  });
  assert.ok(single.includes("**Puerta:** de una vía\n\n**Radio de impacto:** sesiones\n\ncierra sesiones"));
  assert.ok(!single.includes("Hallazgos"));
});

test("buildLooseSummary reports landed tasks with branch and MR, the unfinished and the rejected", () => {
  const lines = buildLooseSummary({
    outcomes: [
      { slice: child({ id: "t1", title: "Login" }), state: "done", detail: "ok", branch: "fix/t1-login", mrUrl: "https://mr/1" },
      { slice: child({ id: "t2", title: "Export" }), state: "gate-red", detail: "make test" },
    ],
    rejected: [{ id: "t3", reason: "está cerrada" }],
  }).join("\n");
  assert.ok(lines.includes("✅ t1 Login → fix/t1-login · MR https://mr/1"));
  assert.ok(lines.includes("⚠️ t2 Export — gate-red: make test"));
  assert.ok(lines.includes("⏭ t3 — está cerrada"));
});

test("resolveRunModels applies the flag > shell > .env precedence to both models and the effort", () => {
  const models = resolveRunModels({ model: "fable" }, { SANDCASTLE_LIGHT_MODEL: "opus" }, { SANDCASTLE_EFFORT: "low" });
  assert.equal(models.model, "claude-fable-5-1");
  assert.equal(models.lightModel, "claude-opus-5-5");
  assert.equal(models.effortFor(models.lightModel), "low");

  const defaults = resolveRunModels({}, {}, {});
  assert.equal(defaults.model, DEFAULT_MODEL);
  assert.equal(defaults.lightModel, DEFAULT_LIGHT_MODEL);
  assert.equal(defaults.effortFor("claude-fable-5-1"), "low");
  assert.equal(defaults.effortFor(DEFAULT_MODEL), "high");
});

const sliceFixture = (id: string, title: string) =>
  ({ id, title, status: "to do", tags: [], blockedBy: [] }) as unknown as import("./lib.ts").ChildTask;

test("frictionEvents is empty on a clean drain and lists every rub otherwise", () => {
  const clean = frictionEvents([{ slice: sliceFixture("a", "A"), state: "done", detail: "ok" }]);
  assert.deepEqual(clean, []);

  const events = frictionEvents(
    [
      { slice: sliceFixture("a", "A"), state: "done", detail: "ok", gateRetries: 1 },
      { slice: sliceFixture("b", "B"), state: "gate-red", detail: "make test", gateRetries: 2 },
      { slice: sliceFixture("c", "C"), state: "needs-info", detail: "falta el endpoint" },
      { slice: sliceFixture("d", "D"), state: "deferred", detail: "bloqueado por b" },
    ],
    ["cierre: 2 archivo(s) sin commitear (x, y)"],
  );
  assert.equal(events.length, 4);
  assert.match(events[0], /slice a .*verde recién tras 1 reintento/);
  assert.match(events[1], /slice b .*gate rojo en `make test` tras 2/);
  assert.match(events[2], /slice c .*needs-info — falta el endpoint/);
  assert.match(events[3], /^cierre: 2 archivo/);
});

test("buildRetroPrompt loads the user-invoked skill by file and forbids edits", () => {
  const prompt = buildRetroPrompt({
    parentId: "p1",
    parentTitle: "Padre",
    branch: "feature/p1-x",
    baseBranch: "main",
    workLog: "work-logs/p1.md",
    events: ["slice a: gate rojo"],
    reviewNotes: ["naming ambiguo"],
  });
  assert.match(prompt, /Leé `\.agents\/skills\/retro\/SKILL\.md`/);
  assert.match(prompt, /- slice a: gate rojo/);
  assert.match(prompt, /## Hallazgos que el cierre dejó sin aplicar\n\n- naming ambiguo/);
  assert.match(prompt, /\*\*Sólo lectura\.\*\*/);
  assert.match(prompt, /<retro>\.\.\.<\/retro>/);
});

test("extractTaggedText returns the last markdown block and buildRetroNote wraps it for the MR", () => {
  const stdout = "ruido <retro>borrador</retro> más ruido <retro>\n- **Check faltante**: evidencia\n</retro> <promise>COMPLETE</promise>";
  const proposals = extractTaggedText(stdout, "retro");
  assert.equal(proposals, "- **Check faltante**: evidencia");
  assert.throws(() => extractTaggedText("nada", "retro"), /no <retro> block/);

  const note = buildRetroNote({ proposals, events: ["slice a: gate rojo"] });
  assert.match(note, /^## Retro del agente/);
  assert.match(note, /make sandcastle-retro MR=\{iid\}/);
  assert.match(note, /\*\*Fricción observada:\*\*\n- slice a: gate rojo/);
  assert.match(note, /- \*\*Check faltante\*\*: evidencia$/);
});
