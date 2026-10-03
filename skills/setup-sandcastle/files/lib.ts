export interface LifecycleStatuses {
  backlog: string;
  planned: string;
  inProgress: string;
  inReview: string;
  /** A tag, not a status: a stuck slice keeps the backlog status and gets this tag. */
  needsInfo: string;
}

/** Workflow contract of this repo, owned by docs/agents/task-workflow.md.
 *  Every status string, path and command the worker uses is read from there. */
export interface WorkflowConfig {
  baseBranch: string;
  /** Branch prefixes that target another base (e.g. `hotfix/` → `main`). */
  baseBranchOverrides: Array<{ prefix: string; baseBranch: string }>;
  mrCli: string;
  statuses: LifecycleStatuses;
  /** `sandbox` is the full close gate; `sandboxSlice` the scoped per-slice one,
   *  falling back to the full gate when the doc declares no slice tier. */
  gate: { host: string[]; sandbox: string[]; sandboxSlice: string[] };
  /** Work-log template, `{parent-id}` unresolved — see workLogFor(). */
  workLogPath: string;
  domainDoc: string;
  sliceMandatePath: string;
  closeMandatePath: string;
  /** Optional: a repo whose doc predates loose tasks still drains its parents. */
  taskMandatePath?: string;
  /** Optional: without a QA mandate the QA phase is skipped. */
  qaMandatePath?: string;
  /** The `## QA` section; absent when the doc predates it. */
  qa?: QaConfig;
  hasHandbook: boolean;
}

/** Per-repo values of the QA phase (task-workflow.md "QA"): where the app is
 *  reachable in the sandbox, how to bring it up, and how many verify→fix cycles
 *  the orchestrator pays before leaving a ❌ to a human. */
export interface QaConfig {
  browserLane: boolean;
  maxCycles: number;
  credentials?: string;
  /** Sandbox block: exec'd one by one by the agent before the first item. */
  sandboxUp: string[];
  sandboxUrl?: string;
  hostUp: string[];
  hostUrl?: string;
}

/** Sandbox contract of this repo, written by `setup-sandcastle`. Nothing about
 *  the stack (image, services, install commands) is hardcoded in the worker. */
export interface ProjectConfig {
  image: string;
  network?: string;
  mounts: { hostPath: string; sandboxPath: string }[];
  setup: string[];
  setupTimeoutMs: number;
  /** Commands that prove the image and its services are reachable — smoke only. */
  serviceChecks: string[];
  environment: string;
}

export const parseProjectConfig = (json: string): ProjectConfig => {
  const raw = JSON.parse(json) as Partial<ProjectConfig>;
  for (const key of ["image", "setup", "environment"] as const) {
    if (!raw[key] || (Array.isArray(raw[key]) && (raw[key] as unknown[]).length === 0)) {
      throw new Error(`project.json: missing '${key}'`);
    }
  }
  return {
    image: raw.image!,
    network: raw.network,
    mounts: raw.mounts ?? [],
    setup: raw.setup!,
    setupTimeoutMs: raw.setupTimeoutMs ?? 900_000,
    serviceChecks: raw.serviceChecks ?? [],
    environment: raw.environment!,
  };
};

/** One child task of the parent, as the tracker adapter returns it. The plan
 *  lives in the tracker: this is the worker's queue item, not a repo file. */
export interface ChildTask {
  id: string;
  title: string;
  status: string;
  tags: string[];
  /** Ids of the tasks this one is blocked by (tracker dependencies). */
  blockedBy: string[];
  dateCreated: number;
  /** The task description — the slice spec, the [SPEC] body, the [DOCS] content. */
  body: string;
}

/** The plan children plan-task leaves under a parent, split by title prefix. */
export interface PlanChildren {
  spec?: ChildTask;
  docs?: ChildTask;
  qa?: ChildTask;
  slices: ChildTask[];
}

export interface ClassifiedSlices {
  hitl: ChildTask[];
  needsInfo: ChildTask[];
  done: ChildTask[];
  pending: ChildTask[];
}

const DEFAULT_QA_CYCLES = 2;

const sectionOf = (md: string, heading: string): string => {
  const start = md.search(new RegExp(`^##\\s+${heading}`, "im"));
  if (start < 0) return "";
  const rest = md.slice(start + 1);
  const end = rest.search(/^##\s+/m);
  return end < 0 ? rest : rest.slice(0, end);
};

const commandsUnder = (section: string, subheading: string): string[] => {
  const start = section.search(new RegExp(`^###\\s+${subheading}\\s*$`, "im"));
  if (start < 0) return [];
  const fence = section.slice(start).match(/```bash\n([\s\S]*?)```/);
  if (!fence) return [];
  return fence[1]
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter(Boolean);
};

const statusFromTable = (md: string, role: string): string => {
  const value = md.match(new RegExp(`^\\|\\s*${role}[^|]*\\|\\s*\`([^\`]+)\``, "im"))?.[1];
  if (!value) throw new Error(`task-workflow.md: no status row for '${role}'`);
  return value;
};

const optionalBacktickedAfter = (md: string, label: string): string | undefined =>
  md.match(new RegExp(`${label}[^\`\\n]*\`([^\`]+)\``, "i"))?.[1];

const backtickedAfter = (md: string, label: string): string => {
  const value = optionalBacktickedAfter(md, label);
  if (!value) throw new Error(`task-workflow.md: no backticked value after '${label}'`);
  return value;
};

// Single source of truth: every status string, branch, path and gate command
// the worker uses is read from docs/agents/task-workflow.md, never hardcoded.
export const parseTaskWorkflow = (md: string): WorkflowConfig => {
  const gateSection = sectionOf(md, "Quality gate");
  const sandbox = commandsUnder(gateSection, "Sandbox");
  const sandboxSlice = commandsUnder(gateSection, "Sandbox — slice");
  const gate = {
    host: commandsUnder(gateSection, "Host"),
    sandbox,
    sandboxSlice: sandboxSlice.length > 0 ? sandboxSlice : sandbox,
  };
  if (gate.sandbox.length === 0) {
    throw new Error("task-workflow.md: '## Quality gate' has no '### Sandbox' bash block");
  }

  const qaSection = sectionOf(md, "QA");
  const qa: QaConfig | undefined = qaSection
    ? {
        browserLane: /^yes$/i.test(optionalBacktickedAfter(qaSection, "Browser lane:") ?? "no"),
        maxCycles: Number(optionalBacktickedAfter(qaSection, "QA↔fix cycles:") ?? DEFAULT_QA_CYCLES),
        credentials: optionalBacktickedAfter(qaSection, "Credentials:"),
        sandboxUp: commandsUnder(qaSection, "Sandbox"),
        sandboxUrl: optionalBacktickedAfter(qaSection, "App URL \\(sandbox\\):"),
        hostUp: commandsUnder(qaSection, "Host"),
        hostUrl: optionalBacktickedAfter(qaSection, "App URL \\(host\\):"),
      }
    : undefined;

  return {
    baseBranch: backtickedAfter(md, "Base/integration branch:"),
    baseBranchOverrides: [...md.matchAll(/`([^`\n]+\/)`\)?\s+target\s+`([^`\n]+)`/g)].map((m) => ({
      prefix: m[1],
      baseBranch: m[2],
    })),
    mrCli: backtickedAfter(md, "MR CLI:"),
    statuses: {
      backlog: statusFromTable(md, "Backlog"),
      planned: statusFromTable(md, "Planned"),
      inProgress: statusFromTable(md, "In progress"),
      inReview: statusFromTable(md, "In review"),
      needsInfo: statusFromTable(md, "Blocked on a human"),
    },
    gate,
    workLogPath: backtickedAfter(md, "Work log"),
    domainDoc: backtickedAfter(md, "Domain docs"),
    sliceMandatePath: backtickedAfter(md, "Slice mandate — canonical"),
    closeMandatePath: backtickedAfter(md, "Parent close mandate"),
    taskMandatePath: optionalBacktickedAfter(md, "Loose task mandate"),
    qaMandatePath: optionalBacktickedAfter(md, "QA mandate"),
    qa,
    hasHandbook: /^##\s+Handbook/im.test(md),
  };
};

export const workLogFor = (config: Pick<WorkflowConfig, "workLogPath">, parentId: string): string =>
  config.workLogPath.replace("{parent-id}", parentId);

export const parseDotEnv = (content: string): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
};

export const parseParentIds = (raw: string): string[] => [
  ...new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  ),
];

export const branchNameFor = (taskId: string, title: string, prefix = "feature"): string => {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}/${taskId}-${slug}`.slice(0, 60).replace(/-+$/, "");
};

export const extractBranchFromDescription = (
  description: string,
): string | undefined => description.match(/Rama:\s*`?([^`\s]+)/)?.[1];

/**
 * git allows a branch in one worktree only, so claiming the parent branch would
 * collide with any session that has it checked out. The worker builds on this
 * mirror instead and pushes it to the parent's remote ref.
 */
export const mirrorBranchFor = (branch: string): string => `sandcastle/${branch}`;

/** Path of the worktree holding `branch`, from `git worktree list --porcelain`. */
export const worktreeHolding = (
  worktreeListPorcelain: string,
  branch: string,
): string | undefined => {
  let path: string | undefined;
  for (const line of worktreeListPorcelain.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return undefined;
};

/** Conventional-commit type an agent declares for a loose task. */
export type CommitType = "feat" | "fix" | "chore";

/** Inverse of commitTypeFor: the branch prefix a declared commit type earns. */
export const branchPrefixFor = (type: CommitType): string => (type === "feat" ? "feature" : type);

/** Mirror of a loose task: prefix-free, because the prefix comes from the type
 *  the agent declares once it has read the task. */
export const taskMirrorBranchFor = (taskId: string): string => `sandcastle/task-${taskId}`;

/** A branch already pushed for this task by an earlier run, from
 *  `git ls-remote --heads origin`: continued instead of renamed. */
export const existingTaskBranch = (lsRemoteHeads: string, taskId: string): string | undefined =>
  lsRemoteHeads
    .split("\n")
    .map((line) => line.split("\t")[1]?.trim().replace(/^refs\/heads\//, ""))
    .find((ref): ref is string => !!ref && new RegExp(`^[^/]+/${taskId}(-|$)`).test(ref));

export const commitTypeFor = (branch: string): string => {
  const prefix = branch.split("/")[0];
  return prefix === "fix" || prefix === "chore" ? prefix : "feat";
};

export const statusIs = (status: string, ...expected: string[]): boolean =>
  expected.some((e) => e.toLowerCase() === status.toLowerCase());

export const hasTag = (child: Pick<ChildTask, "tags">, tag: string): boolean =>
  child.tags.some((t) => t.toLowerCase() === tag.toLowerCase());

// Canonical role names shared by the whole suite (triage-labels.md maps them
// to tracker tags of the same name).
export const TRIAGE_HITL = "ready-for-human";

// Model routing tag, documented in task-workflow.md's "Model routing": a slice
// carrying it runs on the light model instead of the worker's default.
export const MODEL_TAG_LIGHT = "sonnet";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const DEFAULT_LIGHT_MODEL = "claude-sonnet-5";

// Invocation aliases: nobody types a model id by hand. An unknown value passes
// through untouched, so a model released after this table still works.
const MODEL_ALIASES: Record<string, string> = {
  opus: "claude-opus-5-5",
  fable: "claude-fable-5-1",
  sonnet: "claude-sonnet-5",
};

export const resolveModel = (value: string | undefined, fallback: string): string => {
  const raw = value?.trim();
  if (!raw) return fallback;
  return MODEL_ALIASES[raw.toLowerCase()] ?? raw;
};

/** Fable runs low effort while we measure it; every other model runs high. */
export const defaultEffortFor = (model: string): "low" | "high" =>
  model.includes("fable") ? "low" : "high";

/** Precedence for a run setting: invocation flag > shell env > .sandcastle/.env.
 *  The file used to win over both, so a value passed on the command line was
 *  silently eaten by a stale line in the .env. */
export const pickSetting = (sources: { flag?: string; shell?: string; file?: string }): string | undefined =>
  [sources.flag, sources.shell, sources.file].map((value) => value?.trim()).find((value) => value);

export type RunFlags = { base?: string; branch?: string; model?: string; lightModel?: string; effort?: string };

const RUN_FLAG_KEYS: Record<string, keyof RunFlags> = {
  "--base": "base",
  "--branch": "branch",
  "--model": "model",
  "--light-model": "lightModel",
  "--effort": "effort",
};

/** Invocation flags that apply to the whole run, each as `--flag value`.
 *  Valueless arguments (`--dry-run`) and unknown flags are ignored. */
export const parseRunFlags = (args: string[]): RunFlags => {
  const flags: RunFlags = {};
  args.forEach((arg, index) => {
    const key = RUN_FLAG_KEYS[arg];
    const value = args[index + 1]?.trim();
    if (key && value && !value.startsWith("--")) flags[key] = value;
  });
  return flags;
};

/** Model routing for one run (task-workflow.md "Model routing"): the default
 *  model and the light one a `sonnet`-tagged item routes to. Aliases resolve to
 *  ids, and the invocation flag wins over the shell, which wins over the .env. */
export const resolveRunModels = (
  flags: RunFlags,
  shell: Record<string, string | undefined>,
  file: Record<string, string>,
): { model: string; lightModel: string; effortFor: (model: string) => string } => {
  const effortOverride = pickSetting({ flag: flags.effort, shell: shell.SANDCASTLE_EFFORT, file: file.SANDCASTLE_EFFORT });
  return {
    model: resolveModel(
      pickSetting({ flag: flags.model, shell: shell.SANDCASTLE_MODEL, file: file.SANDCASTLE_MODEL }),
      DEFAULT_MODEL,
    ),
    lightModel: resolveModel(
      pickSetting({ flag: flags.lightModel, shell: shell.SANDCASTLE_LIGHT_MODEL, file: file.SANDCASTLE_LIGHT_MODEL }),
      DEFAULT_LIGHT_MODEL,
    ),
    effortFor: (model) => effortOverride ?? defaultEffortFor(model),
  };
};

/** The same flags back as argv, for the per-parent respawn: an override dropped
 *  here would drain every parent but the first against the wrong base or model. */
export const runFlagArgs = (flags: RunFlags): string[] =>
  Object.entries(RUN_FLAG_KEYS).flatMap(([flag, key]) => (flags[key] ? [flag, flags[key] as string] : []));

const PREFIXES: { key: keyof Omit<PlanChildren, "slices">; pattern: RegExp }[] = [
  { key: "spec", pattern: /^\[(SPEC|PRD)\]/i },
  { key: "docs", pattern: /^\[DOCS\]/i },
  { key: "qa", pattern: /^\[QA\]/i },
];

/** Splits a parent's children into the plan roles by title prefix. Everything
 *  without a reserved prefix is a slice. */
export const classifyChildren = (children: ChildTask[]): PlanChildren => {
  const plan: PlanChildren = { slices: [] };
  for (const child of children) {
    const role = PREFIXES.find(({ pattern }) => pattern.test(child.title.trim()));
    if (role) plan[role.key] ??= child;
    else plan.slices.push(child);
  }
  return plan;
};

export const classifySlices = (
  slices: ChildTask[],
  statuses: Pick<LifecycleStatuses, "inReview" | "needsInfo">,
): ClassifiedSlices => {
  const classified: ClassifiedSlices = { hitl: [], needsInfo: [], done: [], pending: [] };
  for (const slice of slices) {
    if (hasTag(slice, TRIAGE_HITL)) classified.hitl.push(slice);
    else if (hasTag(slice, statuses.needsInfo)) classified.needsInfo.push(slice);
    else if (statusIs(slice.status, statuses.inReview)) classified.done.push(slice);
    else classified.pending.push(slice);
  }
  return classified;
};

export const pendingBlockers = (
  slice: ChildTask,
  children: ChildTask[],
  completedIds: Set<string>,
  inReviewStatus: string,
): string[] =>
  slice.blockedBy.filter((id) => {
    if (completedIds.has(id)) return false;
    const dep = children.find((c) => c.id === id);
    if (!dep) return true;
    return !statusIs(dep.status, inReviewStatus);
  });

export const orderSlices = (slices: ChildTask[]): ChildTask[] => {
  const byCreation = [...slices].sort((a, b) => a.dateCreated - b.dateCreated);
  const ordered: ChildTask[] = [];
  const placed = new Set<string>();
  let progressed = true;
  while (ordered.length < byCreation.length && progressed) {
    progressed = false;
    for (const slice of byCreation) {
      if (placed.has(slice.id)) continue;
      const blockersPending = slice.blockedBy.some(
        (id) => byCreation.some((s) => s.id === id) && !placed.has(id),
      );
      if (blockersPending) continue;
      ordered.push(slice);
      placed.add(slice.id);
      progressed = true;
    }
  }
  if (ordered.length < byCreation.length) {
    console.warn("Dependency cycle between slices; falling back to creation order");
    return byCreation;
  }
  return ordered;
};

export const buildQueue = (classified: ClassifiedSlices): ChildTask[] =>
  orderSlices(classified.pending);

// `sandbox.run()` has no structured-output option (only the top-level `run()`
// does), so the agent's <tag>{...}</tag> block is extracted from stdout here and
// validated by the caller. The last occurrence wins: the agent may retry a tag.
export const extractTaggedJson = (stdout: string, tag: string): unknown => {
  const blocks = [...stdout.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))];
  const last = blocks.at(-1)?.[1]?.trim();
  if (!last) throw new Error(`agent emitted no <${tag}> block`);
  try {
    return JSON.parse(last);
  } catch (error) {
    throw new Error(`<${tag}> block is not valid JSON: ${(error as Error).message}`);
  }
};


// ── QA phase ──────────────────────────────────────────────────────────────────
// The [QA] child's description is the checklist; its verdict lines are the
// contract in task-workflow.md "QA". The agent reports verdicts in a <qa>
// block; the orchestrator rewrites the checklist and creates the [FIX] children.

export const QA_FIX_PREFIX = "[FIX]";
export const TRIAGE_AFK = "ready-for-agent";

export type QaVerdict = "pass" | "fail" | "human";

export interface ChecklistItem {
  /** 1-based position among the `- [ ]`/`- [x]` lines, the id the agent reports. */
  index: number;
  text: string;
  /** Verdict already recorded in the description, if any. */
  verdict?: QaVerdict;
  /** The item is verified on this cycle: bare, or ❌ from an earlier cycle. */
  pending: boolean;
}

const CHECKBOX_LINE = /^(\s*)- \[( |x|X)\]\s*(.*)$/;
const VERDICT_LINE = /^\s*→\s*(✅|❌|🙋)/;

const verdictOfMarker = (marker: string): QaVerdict =>
  marker === "✅" ? "pass" : marker === "❌" ? "fail" : "human";

/** Index of the verdict line under the checkbox at `at`, skipping the blank
 *  lines a tracker's markdown round-trip may insert. Undefined when none. */
const verdictLineAfter = (lines: string[], at: number): number | undefined => {
  for (let j = at + 1; j < lines.length; j++) {
    if (lines[j].trim() === "") continue;
    return VERDICT_LINE.test(lines[j]) ? j : undefined;
  }
  return undefined;
};

const LANE_MARKER = /^\[(agente|humano|agent|human)\]\s*/i;

/** Items of a checklist with the verdict each one already carries. ✅ and 🙋
 *  are settled (only a human flips a 🙋); ❌ and bare items are re-verified. */
export const parseChecklist = (description: string): ChecklistItem[] => {
  const lines = description.split("\n");
  const items: ChecklistItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const box = lines[i].match(CHECKBOX_LINE);
    if (!box) continue;
    const verdictAt = verdictLineAfter(lines, i);
    const marker = verdictAt === undefined ? undefined : lines[verdictAt].match(VERDICT_LINE)?.[1];
    const verdict = marker ? verdictOfMarker(marker) : undefined;
    items.push({
      index: items.length + 1,
      text: box[3].trim(),
      verdict,
      pending: verdict === undefined || verdict === "fail",
    });
  }
  return items;
};

export interface QaItemResult {
  index: number;
  verdict: QaVerdict;
  /** pass: what was observed · human: steps / how far the agent got · fail: see expected/observed. */
  evidence: string;
  expected?: string | null;
  observed?: string | null;
  steps?: string | null;
}

/** The checklist with the new verdicts written under their items, everything
 *  else preserved. A settled item (✅/🙋) keeps its line unless re-reported. */
export const applyQaVerdicts = (description: string, results: QaItemResult[]): string => {
  const byIndex = new Map(results.map((r) => [r.index, r]));
  const lines = description.split("\n");
  const out: string[] = [];
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const box = lines[i].match(CHECKBOX_LINE);
    if (!box) {
      out.push(lines[i]);
      continue;
    }
    seen++;
    const verdictAt = verdictLineAfter(lines, i);
    const result = byIndex.get(seen);
    if (!result) {
      out.push(lines[i]);
      continue;
    }
    const indent = box[1];
    const checked = result.verdict === "pass" ? "x" : " ";
    out.push(`${indent}- [${checked}] ${box[3]}`);
    out.push(`${indent}  → ${qaVerdictLine(result)}`);
    if (verdictAt !== undefined) i = verdictAt;
  }
  return out.join("\n");
};

export const qaVerdictLine = (r: QaItemResult): string => {
  if (r.verdict === "pass") return `✅ agente: ${r.evidence}`;
  if (r.verdict === "human") return `🙋 humano: ${r.evidence}`;
  const detail = r.expected || r.observed ? `esperado: ${r.expected ?? "?"} · observado: ${r.observed ?? "?"}` : r.evidence;
  return `❌ FALLÓ: ${detail}`;
};

/** Title + body of the [FIX] child one ❌ earns. The body is a slice spec: a
 *  fresh-context agent must be able to reproduce and fix from it alone. */
export const buildFixChild = (
  item: Pick<ChecklistItem, "text">,
  result: QaItemResult,
  qaId: string,
): { title: string; body: string } => ({
  title: `${QA_FIX_PREFIX} ${item.text.replace(LANE_MARKER, "")}`.slice(0, 120),
  body: [
    `Fallo detectado por la fase de QA (hija [QA] ${qaId}) sobre el item:`,
    "",
    `> ${item.text}`,
    "",
    `- Esperado: ${result.expected ?? result.evidence}`,
    `- Observado: ${result.observed ?? result.evidence}`,
    ...(result.steps ? ["", "Pasos para reproducir:", "", result.steps] : []),
    "",
    "Criterio de aceptación: el item vuelve a pasar en la siguiente corrida de QA, con un test que cubra la regresión cuando sea posible.",
  ].join("\n"),
});

export const qaTotals = (results: QaItemResult[]): { pass: number; fail: number; human: number } => ({
  pass: results.filter((r) => r.verdict === "pass").length,
  fail: results.filter((r) => r.verdict === "fail").length,
  human: results.filter((r) => r.verdict === "human").length,
});

/** Roll-up comment on the [QA] child, in Spanish, one cycle. */
export const buildQaComment = (input: {
  cycle: number;
  items: ChecklistItem[];
  results: QaItemResult[];
  fixes: { id: string; title: string }[];
}): string => {
  const t = qaTotals(input.results);
  const textOf = (index: number): string => input.items.find((i) => i.index === index)?.text ?? `item ${index}`;
  const lines = [
    `🧪 QA — ciclo ${input.cycle}: ✅ ${t.pass} · ❌ ${t.fail} · 🙋 ${t.human}`,
  ];
  const fails = input.results.filter((r) => r.verdict === "fail");
  if (fails.length > 0) {
    lines.push("", "Fallos:", ...fails.map((r) => `- ${textOf(r.index)} — ${qaVerdictLine(r).replace(/^❌ FALLÓ: /, "")}`));
  }
  if (input.fixes.length > 0) {
    lines.push("", "Hijas [FIX] creadas:", ...input.fixes.map((f) => `- ${f.id} ${f.title}`));
  }
  const humans = input.results.filter((r) => r.verdict === "human");
  if (humans.length > 0) {
    lines.push("", "Para humano:", ...humans.map((r) => `- ${textOf(r.index)} — ${r.evidence}`));
  }
  return lines.join("\n");
};

/** The checklist as the agent receives it: only pending items carry an index
 *  to report; settled ones are shown struck through as context. */
export const renderChecklistForAgent = (items: ChecklistItem[]): string =>
  items
    .map((i) =>
      i.pending
        ? `${i.index}. ${i.text}${i.verdict === "fail" ? " (❌ en el ciclo anterior — re-verificar)" : ""}`
        : `~~${i.index}. ${i.text}~~ (${i.verdict === "pass" ? "✅ ya verificado" : "🙋 queda para humano"})`,
    )
    .join("\n");

/** Free-text variant of extractTaggedJson for blocks that carry markdown, not
 *  JSON (the retro proposals). Last occurrence wins, same as the JSON one. */
export const extractTaggedText = (stdout: string, tag: string): string => {
  const blocks = [...stdout.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))];
  const last = blocks.at(-1)?.[1]?.trim();
  if (!last) throw new Error(`agent emitted no <${tag}> block`);
  return last;
};

/** Thrown by the worker when a run keeps dying on the provider's limits after
 *  sleeping through the configured retries: the drain must stop, not cascade
 *  one burnt run per remaining slice. */
export class RateLimitExhaustedError extends Error {}

/** A hard usage/rate limit kills the CLI mid-run and reaches the worker as an
 *  error message carrying the CLI's last output (transient 429s are retried
 *  inside the CLI itself — what surfaces here is the hard stop). Patterns are
 *  broad on purpose: the exact wording is CLI-version-dependent, and the worker
 *  logs the raw message on every hit so the real format gets captured. */
export const detectRateLimit = (message: string): boolean =>
  /usage limit|rate.?limit|overloaded|\b429\b/i.test(message);

/** Reset time in epoch ms when the message carries one — the CLI is known to
 *  append a unix timestamp after a pipe ("…usage limit reached|1755603600") and
 *  other wordings spell it out ("resets at 1755603600"). Undefined when absent,
 *  not an epoch, or already in the past. */
export const rateLimitResetMs = (message: string, now: number): number | undefined => {
  const raw = message.match(/(?:\|\s*|\bresets?(?:\s+at)?\s+)(\d{10,13})\b/i)?.[1];
  if (!raw) return undefined;
  const ms = raw.length >= 13 ? Number(raw) : Number(raw) * 1000;
  return ms > now ? ms : undefined;
};

/** How long to sleep before retrying a rate-limited run: until the reset the
 *  message announces (plus a margin), a blind fallback when it announces none,
 *  never more than the cap. */
export const rateLimitWaitMs = (input: {
  message: string;
  now: number;
  marginMs: number;
  fallbackMs: number;
  maxMs: number;
}): number => {
  const reset = rateLimitResetMs(input.message, input.now);
  if (reset === undefined) return Math.min(input.fallbackMs, input.maxMs);
  return Math.min(reset - input.now + input.marginMs, input.maxMs);
};

export type SliceState = "done" | "gate-red" | "needs-info" | "deferred" | "failed";

/** Token counts of one agent message, as sandcastle reports them per iteration. */
export interface UsageSnapshot {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

export interface SliceOutcome {
  slice: ChildTask;
  state: SliceState;
  detail: string;
  /** Usage of the agent's last message for this slice — the window it ended at,
   *  not the run total: that is the number that says whether a slice is too big. */
  usage?: UsageSnapshot;
  /** Prompt-cache hit rate over the slice's final run, 0..1 — below ~0.6 the
   *  drain is paying cold caches and the invocation cadence is worth a look. */
  cacheHitRate?: number;
  /** Wall-clock of the agent (run + resumes) and of the gate verifications. */
  agentMs?: number;
  gateMs?: number;
  /** Times the worker handed a red gate back to the agent before this outcome. */
  gateRetries?: number;
}

/** Hit rate = tokens read from cache over everything the agent had to feed in.
 *  Aggregated across a run's iterations; undefined until something was read. */
export const cacheHitRate = (usages: UsageSnapshot[]): number | undefined => {
  let read = 0;
  let total = 0;
  for (const usage of usages) {
    read += usage.cacheReadInputTokens;
    total += usage.cacheReadInputTokens + usage.cacheCreationInputTokens + usage.inputTokens;
  }
  return total > 0 ? read / total : undefined;
};

export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
};

/** The `{{...}}` a mandate declares: every one of them has to be supplied by
 *  each consumer, so both mandates must agree on the shared context. */
export const declaredPlaceholders = (md: string): string[] =>
  [...new Set(md.match(/\{\{[A-Z_]+\}\}/g) ?? [])].map((token) => token.slice(2, -2)).sort();

export const contextWindowTokens = (usage: UsageSnapshot): number =>
  usage.inputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;

export const formatTokens = (tokens: number): string =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

const usageLine = (outcome: Pick<SliceOutcome, "usage" | "cacheHitRate" | "agentMs" | "gateMs">): string => {
  const parts = [
    outcome.usage
      ? `ventana final ${formatTokens(contextWindowTokens(outcome.usage))} tok in · ${formatTokens(outcome.usage.outputTokens)} out`
      : "ventana final n/d",
  ];
  if (outcome.cacheHitRate !== undefined) parts.push(`cache ${Math.round(outcome.cacheHitRate * 100)}%`);
  if (outcome.agentMs !== undefined) parts.push(`agente ${formatDuration(outcome.agentMs)}`);
  if (outcome.gateMs !== undefined) parts.push(`gate ${formatDuration(outcome.gateMs)}`);
  return parts.join(" · ");
};

export interface CloseDecision {
  /** Every queued AFK slice landed: the branch is worth reviewing. */
  openMr: boolean;
  /** Nothing unbuilt is left — HITL slices block this, the [QA] subtask does not. */
  setInReview: boolean;
  /** Human-readable reasons the parent is not closing, empty when it is. */
  pending: string[];
}

export const closeDecision = (
  classified: ClassifiedSlices,
  outcomes: SliceOutcome[],
  inReviewStatus: string,
): CloseDecision => {
  const unfinished = outcomes.filter((o) => o.state !== "done");
  const pendingHitl = classified.hitl.filter((s) => !statusIs(s.status, inReviewStatus));
  const openMr = unfinished.length === 0 && classified.needsInfo.length === 0;

  const pending = [
    ...unfinished.map((o) => `slice ${o.slice.id} ${o.state}${o.detail ? ` (${o.detail})` : ""}`),
    ...classified.needsInfo.map((s) => `slice ${s.id} needs-info`),
    ...pendingHitl.map((s) => `slice ${s.id} HITL sin drenar`),
  ];

  return { openMr, setInReview: openMr && pendingHitl.length === 0, pending };
};

/** The close comment is the one thing business reads in the feed: a single
 *  functional paragraph written by the close mandate. Branch, MR and status live
 *  in the description's `### Estado`; pendings and warnings are appended only
 *  when they exist. Aligned with the template in work-task/REFERENCE.md. */
export const buildRollupComment = (input: {
  comment: string | null;
  pending: string[];
  warnings?: string[];
}): string => {
  const warnings = input.warnings ?? [];
  const lines = [input.comment?.trim() || "Trabajo cerrado — el resumen está en la descripción de la tarea."];

  if (input.pending.length > 0) {
    lines.push("", "⏳ Pendiente:", ...input.pending.map((p) => `- ${p}`));
  }
  if (warnings.length > 0) {
    lines.push("", ...warnings.map((w) => `⚠️ ${w}`));
  }

  return lines.join("\n");
};

/** The merge-danger call the closing agent makes over the whole diff: the shape
 *  of the `pr` skill (one-way or two-way door, plus blast radius), in Spanish. */
export interface MergeDanger {
  door: string;
  door_note?: string | null;
  blast_radius: string;
  blast_note?: string | null;
}

/** The "después" half of the MR evidence: the gate the orchestrator itself ran
 *  over the commit that goes up, named command by command. */
export const gateEvidenceLine = (commands: string[], head: string, verdict: "green" | "red" | "skipped" = "green"): string => {
  if (verdict === "green") return `gate verde sobre \`${head}\`: ${commands.map((c) => `\`${c}\``).join(" · ")}`;
  if (verdict === "red") return `gate rojo sobre \`${head}\` — revisar antes de mergear`;
  return `gate sin correr sobre \`${head}\` (quedaron archivos sin commitear) — revisar antes de mergear`;
};

const mergeDangerLines = (danger: MergeDanger | undefined): string[] => {
  if (!danger) return ["**Puerta:** sin evaluar", "", "**Radio de impacto:** sin evaluar"];
  const lines = [`**Puerta:** ${danger.door}`];
  if (danger.door_note) lines.push("", danger.door_note);
  lines.push("", `**Radio de impacto:** ${danger.blast_radius}`);
  if (danger.blast_note) lines.push("", danger.blast_note);
  return lines;
};

const reviewLines = (reviewLine: string | undefined, notes: string[]): string[] => {
  const lines: string[] = [];
  if (reviewLine) lines.push(`🔍 Code review: ${reviewLine}`);
  if (notes.length > 0) lines.push("Hallazgos anotados para el revisor:", ...notes.map((n) => `- ${n}`));
  return lines;
};

/** The MR description carries every technical detail of the close — the tracker
 *  never repeats it. Its shape is the `pr` skill's (summary, before/after
 *  evidence, merge danger) with Spanish headings; aligned with the MR template
 *  in work-task/REFERENCE.md. */
export const buildMrDescription = (input: {
  outcomes: SliceOutcome[];
  reviewLine?: string;
  reviewNotes?: string[];
  handbookLine?: string;
  evidence?: { before?: string | null; after: string };
  mergeDanger?: MergeDanger;
  taskUrl: string;
}): string => {
  const notes = input.reviewNotes ?? [];
  const lines = [
    "## Resumen",
    ...input.outcomes.filter((o) => o.state === "done").map((o) => `- Slice ${o.slice.id}: ${o.detail}`),
  ];
  if (input.handbookLine) lines.push(`📖 Handbook: ${input.handbookLine}`);

  if (input.evidence) {
    lines.push("", "## Evidencia", `- **Antes:** ${input.evidence.before?.trim() || "ver el spec de la tarea"}`, `  **Después:** ${input.evidence.after}`);
  }

  lines.push("", "## Riesgo de merge", ...mergeDangerLines(input.mergeDanger));
  const review = reviewLines(input.reviewLine, notes);
  if (review.length > 0) lines.push("", ...review);

  lines.push("", "## Tarea", input.taskUrl);
  return lines.join("\n");
};

/** Replaces the `heading` section (up to the next `## ` heading or EOF), or
 *  inserts it — so re-runs update the block instead of stacking copies. With
 *  `position: "start"` the section always lands at the top of the document,
 *  even if a previous run left it elsewhere. */
export const upsertSection = (
  markdown: string,
  heading: string,
  body: string,
  position: "start" | "end" = "end",
): string => {
  const section = `${heading}\n\n${body.trim()}`;
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    const existing = markdown.trim();
    if (existing.length === 0) return `${section}\n`;
    return position === "start" ? `${section}\n\n${existing}\n` : `${existing}\n\n${section}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trim();
  const parts =
    position === "start" ? [section, before, after] : [before, section, after];
  return parts.filter((part) => part.length > 0).join("\n\n") + "\n";
};

/** The business-facing close report: the agent's text plus the state block only
 *  the orchestrator knows (branch, MR, what is still pending). A loose task has
 *  no [QA] child, so its block only lists what is really pending. */
export const buildResumenSection = (input: {
  report: string;
  branch: string;
  mrUrl?: string;
  pending: string[];
  withQa?: boolean;
}): string => {
  const pendientes = [...input.pending, ...(input.withQa === false ? [] : ["QA manual (hija [QA] del padre)"])];
  return [
    input.report.trim(),
    "",
    "### Estado",
    "",
    `- Rama: \`${input.branch}\`${input.mrUrl ? ` → MR: ${input.mrUrl}` : ""}`,
    ...(pendientes.length > 0 ? [`- ⏳ Pendiente: ${pendientes.join(" · ")}`] : []),
  ].join("\n");
};

/** The three things a drain has to answer when it ends: what landed (and how big
 *  each slice's window got), whether the MR exists, and whether the parent moved. */
export const buildFinalSummary = (input: {
  parentId: string;
  parentTitle: string;
  branch: string;
  baseBranch: string;
  outcomes: SliceOutcome[];
  mrUrl?: string;
  mrSkippedReason?: string;
  statusSet: boolean;
  statuses: Pick<LifecycleStatuses, "inReview" | "inProgress">;
  pending: string[];
  warnings?: string[];
}): string[] => {
  const done = input.outcomes.filter((o) => o.state === "done");
  const unfinished = input.outcomes.filter((o) => o.state !== "done");

  const lines = [
    `Padre ${input.parentId} — ${input.parentTitle}`,
    `Rama ${input.branch} → ${input.baseBranch}`,
    "",
    `Slices completados (${done.length}):`,
    ...done.map((o) => `  ✅ ${o.slice.id} ${o.slice.title} — ${usageLine(o)}`),
  ];
  if (done.length === 0) lines.push("  (ninguno)");

  if (unfinished.length > 0) {
    lines.push(
      "",
      `Sin completar (${unfinished.length}):`,
      ...unfinished.map(
        (o) => `  ⚠️ ${o.slice.id} ${o.slice.title} — ${o.state}${o.detail ? `: ${o.detail}` : ""}`,
      ),
    );
  }

  if (input.warnings && input.warnings.length > 0) {
    lines.push("", ...input.warnings.map((w) => `  ⚠️ ${w}`));
  }

  lines.push(
    "",
    input.mrUrl
      ? `🔀 MR a ${input.baseBranch}: ${input.mrUrl}`
      : `🔀 MR a ${input.baseBranch}: no creado${input.mrSkippedReason ? ` (${input.mrSkippedReason})` : ""}`,
    input.statusSet
      ? `🔄 Tarea actualizada a "${input.statuses.inReview}"`
      : `🔄 Tarea sigue en "${input.statuses.inProgress}" — pendiente: ${input.pending.join(" · ") || "nada que cerrar"}`,
  );

  return lines;
};

export const buildTriageComment = (reason: string, attempted: string): string =>
  [
    "> *This was generated by AI during triage.*",
    "",
    "## Triage Notes",
    "",
    "**What we've established so far:**",
    `- ${attempted}`,
    "",
    "**What we still need from you (@me):**",
    `- ${reason}`,
  ].join("\n");

/** The branch a parent's work merges into, highest precedence first: an explicit
 *  invocation override (`--base`), the doc's prefix routes (`hotfix/` → `main`),
 *  the doc's base branch. */
export const baseBranchFor = (branch: string, config: WorkflowConfig, override?: string): string =>
  override?.trim() ||
  config.baseBranchOverrides.find((o) => branch.startsWith(o.prefix))?.baseBranch ||
  config.baseBranch;

/** Gate commands may reference `{{BASE_BRANCH}}`; the worker resolves it per parent. */
export const resolveGateCommands = (commands: string[], vars: Record<string, string>): string[] =>
  commands.map((command) => command.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`));

/** A tracker task passed by id to the loose-task drain, with what decides
 *  whether it is one: its place in a plan and whether the tracker closed it. */
export interface LooseTask extends ChildTask {
  parentId?: string;
  subtaskCount: number;
  closed: boolean;
}

/** Why a task cannot run as a loose task, or undefined when it can. Anything
 *  that belongs to a plan goes through the parent drain instead. */
export const looseTaskRejection = (
  task: LooseTask,
  statuses: Pick<LifecycleStatuses, "inReview" | "needsInfo">,
): string | undefined => {
  if (task.subtaskCount > 0) return "tiene hijas: es un padre, se drena con sandcastle-work";
  if (task.parentId) return `es hija de ${task.parentId}: se drena con su padre`;
  if (task.closed) return "está cerrada";
  if (statusIs(task.status, statuses.inReview)) return `ya está en ${statuses.inReview}`;
  if (hasTag(task, TRIAGE_HITL)) return `lleva ${TRIAGE_HITL}: es para un humano`;
  if (hasTag(task, statuses.needsInfo)) return `lleva ${statuses.needsInfo}: espera a un humano`;
  return undefined;
};

/** One MR for loose tasks: every landed task with its summary and link, the
 *  gate as evidence and each task's merge-danger call. Same shape as the
 *  parent MR. */
export const buildLooseMrDescription = (input: {
  outcomes: Array<SliceOutcome & { mergeDanger?: MergeDanger }>;
  reviewNotes: string[];
  evidenceAfter?: string;
  taskUrl: (taskId: string) => string;
}): string => {
  const done = input.outcomes.filter((o) => o.state === "done");
  const lines = [
    "## Resumen",
    ...done.map((o) => `- ${o.slice.title} (${input.taskUrl(o.slice.id)}): ${o.detail}`),
  ];
  if (input.evidenceAfter) {
    lines.push("", "## Evidencia", "- **Antes:** lo que describe cada tarea", `  **Después:** ${input.evidenceAfter}`);
  }
  lines.push("", "## Riesgo de merge");
  if (done.length === 1) {
    lines.push(...mergeDangerLines(done[0].mergeDanger));
  } else {
    lines.push(
      ...done.map((o) =>
        o.mergeDanger
          ? `- ${o.slice.title}: puerta ${o.mergeDanger.door} · radio de impacto ${o.mergeDanger.blast_radius}${o.mergeDanger.blast_note ? ` — ${o.mergeDanger.blast_note}` : ""}`
          : `- ${o.slice.title}: sin evaluar`,
      ),
    );
  }
  const review = reviewLines(undefined, input.reviewNotes);
  if (review.length > 0) lines.push("", ...review);
  return lines.join("\n");
};

/** What a loose-task drain answers when it ends: what landed where, and the MRs. */
export const buildLooseSummary = (input: {
  outcomes: Array<SliceOutcome & { branch?: string; mrUrl?: string }>;
  rejected: Array<{ id: string; reason: string }>;
}): string[] => {
  const done = input.outcomes.filter((o) => o.state === "done");
  const unfinished = input.outcomes.filter((o) => o.state !== "done");
  const lines = [
    `Tareas completadas (${done.length}):`,
    ...done.map(
      (o) =>
        `  ✅ ${o.slice.id} ${o.slice.title}${o.branch ? ` → ${o.branch}` : ""}${o.mrUrl ? ` · MR ${o.mrUrl}` : ""} — ${usageLine(o)}`,
    ),
  ];
  if (done.length === 0) lines.push("  (ninguna)");
  if (unfinished.length > 0) {
    lines.push(
      "",
      `Sin completar (${unfinished.length}):`,
      ...unfinished.map((o) => `  ⚠️ ${o.slice.id} ${o.slice.title} — ${o.state}${o.detail ? `: ${o.detail}` : ""}`),
    );
  }
  if (input.rejected.length > 0) {
    lines.push("", `Descartadas (${input.rejected.length}):`, ...input.rejected.map((r) => `  ⏭ ${r.id} — ${r.reason}`));
  }
  return lines;
};

// ── Retro: the drain reviews how it worked, only when something rubbed ───────

/** The friction a drain produced, one line each. Empty means a clean run: no
 *  retro is worth its tokens, the human review of the MR is the only input left. */
export const frictionEvents = (outcomes: SliceOutcome[], closeEvents: string[] = []): string[] => {
  const events: string[] = [];
  for (const o of outcomes) {
    const retries = o.gateRetries ?? 0;
    if (o.state === "gate-red") events.push(`slice ${o.slice.id} (${o.slice.title}): gate rojo en \`${o.detail}\` tras ${retries} reintento(s)`);
    else if (o.state === "needs-info") events.push(`slice ${o.slice.id} (${o.slice.title}): needs-info — ${o.detail}`);
    else if (o.state === "failed") events.push(`slice ${o.slice.id} (${o.slice.title}): el run falló — ${o.detail}`);
    else if (o.state === "done" && retries > 0) events.push(`slice ${o.slice.id} (${o.slice.title}): gate verde recién tras ${retries} reintento(s)`);
  }
  return [...events, ...closeEvents];
};

/** Prompt for the in-sandbox retro. The upstream `retro` skill is user-invoked,
 *  so the agent loads it by reading its file; the evidence it gets is what the
 *  worker observed plus what the branch itself holds (work log, commits). The
 *  pass is read-only: proposals travel as an MR comment for the human to weigh,
 *  never as edits — the environment changes on another branch, with a human. */
export const buildRetroPrompt = (input: {
  parentId: string;
  parentTitle: string;
  branch: string;
  baseBranch: string;
  workLog: string;
  events: string[];
  reviewNotes?: string[];
}): string =>
  [
    `# Retro del drenaje — padre ${input.parentId}: ${input.parentTitle}`,
    "",
    "Leé `.agents/skills/retro/SKILL.md` y seguilo (es user-invoked: no está en la Skill tool, se carga leyéndolo). La sesión a revisar es el drenaje automatizado que acaba de implementar esta rama.",
    "",
    `Rama: \`${input.branch}\` (base: \`${input.baseBranch}\`). Bitácora: \`${input.workLog}\`. Commits: \`git log origin/${input.baseBranch}..HEAD\`.`,
    "",
    "## Fricción que observó el worker",
    "",
    ...input.events.map((e) => `- ${e}`),
    ...(input.reviewNotes && input.reviewNotes.length > 0
      ? ["", "## Hallazgos que el cierre dejó sin aplicar", "", ...input.reviewNotes.map((n) => `- ${n}`)]
      : []),
    "",
    "## Reglas",
    "",
    "- **Sólo lectura.** No edites ningún archivo, no commitees, no toques el tracker. Propuestas, no cambios: las aplica un humano en otra rama.",
    "- Propuestas sólo al **entorno del agente**: lo mecánico como check del gate o de CI (`docs/agents/task-workflow.md`), lo de juicio como regla en `CODING_STANDARDS.md`, lo de navegación como puntero en `AGENTS.md`, lo de mandato en los prompts que declara `task-workflow.md` § Paths. Nada sobre el código de la app.",
    "- Una propuesta por fricción real, con la evidencia (qué pasó) y el cambio concreto (qué archivo, qué línea agregarías). Sin fricción explicable, decilo en una línea: no inventes.",
    "- Máximo 8 propuestas, ordenadas por severidad. Español de España.",
    "",
    "## Salida",
    "",
    "Emití las propuestas como markdown dentro de `<retro>...</retro>` (lista con **título en negrita**, evidencia y cambio propuesto) y después `<promise>COMPLETE</promise>`.",
  ].join("\n");

/** The MR comment carrying the retro: separate from the MR body on purpose —
 *  the body reviews the code, this reviews the process that produced it. */
export const buildRetroNote = (input: { proposals: string; events: string[] }): string =>
  [
    "## Retro del agente",
    "",
    "> *Generado automáticamente al cerrar el drenaje porque hubo fricción. Son propuestas al entorno del agente (checks, estándares, punteros), no al código de este MR; se aplican en otra rama, con un humano. La retro completa, con los comentarios de esta revisión, es `make sandcastle-retro MR={iid}`.*",
    "",
    "**Fricción observada:**",
    ...input.events.map((e) => `- ${e}`),
    "",
    input.proposals.trim(),
  ].join("\n");
