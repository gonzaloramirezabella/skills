// Sandbox-bound steps shared by every entry point that drains work in a
// sandbox (worker.ts for a planned parent, tasks.ts for loose tasks): the gate,
// the leftovers check and the rate-limit sleep-and-retry. Orchestration — what
// the queue is, which status each outcome earns — stays in each entry point.
import { execFileSync } from "node:child_process";
import type { Sandbox } from "@ai-hero/sandcastle";
import {
  worktreeHolding,
  detectRateLimit,
  rateLimitWaitMs,
  formatDuration,
  RateLimitExhaustedError,
} from "./lib.ts";

// A hard usage/rate limit kills the agent run; the caller sleeps until the
// limit resets and relaunches, instead of cascading one burnt run per item.
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_MARGIN_MS = 60_000;
const RATE_LIMIT_FALLBACK_WAIT_MS = 30 * 60_000;
const RATE_LIMIT_MAX_WAIT_MS = 6 * 60 * 60_000;

export const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8" }).trim();

export const refExists = (ref: string): boolean => {
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

/** A crashed run can leave a worktree holding a mirror branch, which would
 *  block the forced reset that rebuilds it; a clean leftover is removed, a dirty
 *  one carries work. Returns the reason the mirror cannot be rebuilt, if any. */
export const releaseStaleWorktree = (branch: string): string | undefined => {
  const staleWorktree = worktreeHolding(git("worktree", "list", "--porcelain"), branch);
  if (!staleWorktree) return undefined;
  if (git("-C", staleWorktree, "status", "--porcelain")) {
    return (
      `Mirror branch '${branch}' is held by ${staleWorktree} with uncommitted changes; ` +
      `inspect it, then 'git worktree remove ${staleWorktree}'.`
    );
  }
  git("worktree", "remove", staleWorktree);
  console.log(`Removed stale clean worktree ${staleWorktree} holding '${branch}'.`);
  return undefined;
};

/** Opens the MR with the repo's CLI; on a re-run the branch already has one,
 *  whose URL is returned instead. Undefined when neither exists. */
export const openMergeRequest = (
  mrCli: string,
  mr: { branch: string; baseBranch: string; title: string; description: string },
): string | undefined => {
  try {
    const created = execFileSync(
      mrCli,
      [
        "mr", "create",
        "--source-branch", mr.branch,
        "--target-branch", mr.baseBranch,
        "--title", mr.title,
        "--description", mr.description,
        "--yes",
      ],
      { encoding: "utf8" },
    );
    return created.match(/https:\/\/\S+/)?.[0];
  } catch {
    const existing = execFileSync(mrCli, ["mr", "list", "--source-branch", mr.branch], {
      encoding: "utf8",
    });
    const url = existing.match(/https:\/\/\S+/)?.[0];
    console.warn(`⚠️ MR create failed; existing MR: ${url ?? "none found"}`);
    return url;
  }
};

/** Posts a comment on the MR behind `mrUrl`. GitLab's glab takes the URL
 *  directly; gh wants `pr comment`. Failure is reported, never fatal: a lost
 *  retro note must not undo a finished drain. */
export const commentMergeRequest = (mrCli: string, mrUrl: string, body: string): boolean => {
  const args = mrCli === "gh" ? ["pr", "comment", mrUrl, "--body", body] : ["mr", "note", mrUrl, "--message", body];
  try {
    execFileSync(mrCli, args, { encoding: "utf8" });
    return true;
  } catch (error) {
    console.warn(`⚠️ could not comment on the MR: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
};

export interface GateResult {
  ok: boolean;
  failed?: string;
  output: string;
}

/** Runs one tier of the quality gate. Exit codes, not claims. */
export const runGate = async (sandbox: Sandbox, commands: string[]): Promise<GateResult> => {
  for (const command of commands) {
    console.log(`   gate: ${command}`);
    const tail: string[] = [];
    const result = await sandbox.exec(command, {
      onLine: (line) => {
        tail.push(line);
        if (tail.length > 40) tail.shift();
      },
    });
    if (result.exitCode !== 0) {
      return { ok: false, failed: command, output: tail.join("\n") || result.stderr };
    }
  }
  return { ok: true, output: "" };
};

/** Work an agent left behind: the gate saw it, the MR will not. */
export const uncommittedFiles = async (sandbox: Sandbox): Promise<string[]> => {
  const lines: string[] = [];
  await sandbox.exec("git status --porcelain", { onLine: (line) => lines.push(line) });
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
};

/** Drops a dead or blocked run's uncommitted leftovers. No -x: ignored paths
 *  (the materialized spec, .sandcastle/logs) survive, and so do commits. */
export const discardLeftovers = (sandbox: Sandbox): void => {
  execFileSync("git", ["-C", sandbox.worktreePath, "checkout", "--", "."]);
  execFileSync("git", ["-C", sandbox.worktreePath, "clean", "-fd"]);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RateLimitGuard {
  run: <T>(launch: () => Promise<T>) => Promise<T>;
  /** Slept-out rate limits are dead time, not agent time: callers subtract the
   *  delta of this counter from their wall-clock so agent time keeps measuring cost. */
  sleptMs: () => number;
}

// A limit-killed run loses its context but not its commits, and the error path
// exposes no session to resume (sandcastle's AgentError carries only text). So
// the retry is a fresh launch of the same mandate: discard the dead run's
// uncommitted leftovers, sleep the limit out, relaunch against the real
// worktree state. Past the retries every further run would die the same way,
// so the drain stops instead of failing item by item.
export const createRateLimitGuard = (sandbox: Sandbox): RateLimitGuard => {
  let slept = 0;
  const run = async <T>(launch: () => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await launch();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!detectRateLimit(message)) throw error;
        if (attempt >= RATE_LIMIT_RETRIES) {
          throw new RateLimitExhaustedError(
            `still rate-limited after ${RATE_LIMIT_RETRIES} sleep-and-retry attempts: ${message}`,
          );
        }
        console.error(`   rate limit hit: ${message}`);
        discardLeftovers(sandbox);
        const waitMs = rateLimitWaitMs({
          message,
          now: Date.now(),
          marginMs: RATE_LIMIT_MARGIN_MS,
          fallbackMs: RATE_LIMIT_FALLBACK_WAIT_MS,
          maxMs: RATE_LIMIT_MAX_WAIT_MS,
        });
        console.log(
          `   sleeping ${formatDuration(waitMs)} until the limit resets (retry ${attempt + 1}/${RATE_LIMIT_RETRIES})`,
        );
        slept += waitMs;
        await sleep(waitMs);
      }
    }
  };
  return { run, sleptMs: () => slept };
};
