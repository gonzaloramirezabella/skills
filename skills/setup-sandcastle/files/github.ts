// Tracker adapter: everything GitHub-shaped lives here, so the worker only
// speaks in operations (get task, get children, set status, add tag, comment,
// task URL). Swapping the tracker means rewriting this file and nothing else.
//
// Mapping: task = issue (id = issue number), children = sub-issues, lifecycle
// status = the issue's `status:*` label, tags = the other labels, blocked by =
// native issue dependencies, description = issue body (markdown).
import { execFileSync } from "node:child_process";
import type { ChildTask, LooseTask } from "./lib.ts";

const API_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";
export const STATUS_LABEL_PREFIX = "status:";

interface RawLabel {
  name: string;
}

interface RawIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: RawLabel[];
  created_at: string;
  sub_issues_summary?: { total: number };
}

const isStatusLabel = (name: string): boolean => name.startsWith(STATUS_LABEL_PREFIX);

export const statusFromLabels = (labels: string[]): string =>
  labels.find(isStatusLabel) ?? "";

const toChildTask = (raw: RawIssue, blockedBy: string[]): ChildTask => {
  const labels = raw.labels.map((l) => l.name);
  return {
    id: String(raw.number),
    title: raw.title,
    status: statusFromLabels(labels),
    tags: labels.filter((name) => !isStatusLabel(name)),
    blockedBy,
    dateCreated: Date.parse(raw.created_at),
    body: raw.body ?? "",
  };
};

/** `owner/repo` from the origin remote (https or ssh), unless overridden. */
export const repoFromRemote = (remoteUrl: string): string => {
  const match = remoteUrl.trim().match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) throw new Error(`origin remote is not a GitHub repo: ${remoteUrl.trim()}`);
  return `${match[1]}/${match[2]}`;
};

/** The token the worker uses: the shell, then `.sandcastle/.env`, then `gh`'s own login. */
export const resolveGitHubToken = (env: Record<string, string | undefined>): string => {
  const fromEnv = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("No GitHub token: set GH_TOKEN in .sandcastle/.env or log in with `gh auth login`");
  }
};

export class GitHubClient {
  private readonly token: string;
  private readonly repo: string;

  constructor(token: string, repo: string) {
    this.token = token;
    this.repo = repo;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private issuePath(issueNumber: string | number, suffix = ""): string {
    return `/repos/${this.repo}/issues/${issueNumber}${suffix}`;
  }

  private async rawIssue(issueNumber: string | number): Promise<RawIssue> {
    return this.request<RawIssue>("GET", this.issuePath(issueNumber));
  }

  private async blockedBy(issueNumber: string | number): Promise<string[]> {
    const blockers = await this.request<RawIssue[]>(
      "GET",
      this.issuePath(issueNumber, "/dependencies/blocked_by?per_page=100"),
    );
    return blockers.map((b) => String(b.number));
  }

  async getTask(issueNumber: string): Promise<ChildTask> {
    return toChildTask(await this.rawIssue(issueNumber), await this.blockedBy(issueNumber));
  }

  /** The parent's sub-issues as neutral queue items. The list carries labels
   *  and bodies; only the blocking edges need one more call per child. */
  async getChildren(parentNumber: string): Promise<ChildTask[]> {
    const subIssues = await this.request<RawIssue[]>(
      "GET",
      this.issuePath(parentNumber, "/sub_issues?per_page=100"),
    );
    const children: ChildTask[] = [];
    for (const raw of subIssues) {
      children.push(toChildTask(raw, await this.blockedBy(raw.number)));
    }
    return children;
  }

  /** A task passed by id to the loose-task drain, with its place in a plan. */
  async getLooseTask(issueNumber: string): Promise<LooseTask> {
    const raw = await this.rawIssue(issueNumber);
    const parent = await this.request<RawIssue | null>("GET", this.issuePath(issueNumber, "/parent")).catch(
      () => null,
    );
    return {
      ...toChildTask(raw, await this.blockedBy(issueNumber)),
      parentId: parent ? String(parent.number) : undefined,
      subtaskCount: raw.sub_issues_summary?.total ?? 0,
      closed: raw.state === "closed",
    };
  }

  /** A sub-issue of `parentNumber` in the same repo, created with the status
   *  label and tags the queue expects, then linked to the parent. */
  async createChildTask(
    parentNumber: string,
    child: { title: string; body: string; status: string; tags: string[] },
  ): Promise<ChildTask> {
    const created = await this.request<RawIssue>("POST", `/repos/${this.repo}/issues`, {
      title: child.title,
      body: child.body,
      labels: [child.status, ...child.tags].filter((name) => name.length > 0),
    });
    await this.request("POST", this.issuePath(parentNumber, "/sub_issues"), { sub_issue_id: created.id });
    return toChildTask(created, []);
  }

  /** One status label at a time: the new one replaces whatever `status:*` the issue had. */
  async setStatus(issueNumber: string, status: string): Promise<void> {
    const current = (await this.rawIssue(issueNumber)).labels.map((l) => l.name);
    const kept = current.filter((name) => !isStatusLabel(name));
    await this.request("PUT", this.issuePath(issueNumber, "/labels"), { labels: [...kept, status] });
  }

  async addTag(issueNumber: string, tag: string): Promise<void> {
    await this.request("POST", this.issuePath(issueNumber, "/labels"), { labels: [tag] });
  }

  async comment(issueNumber: string, text: string): Promise<void> {
    await this.request("POST", this.issuePath(issueNumber, "/comments"), { body: text });
  }

  /** Full replacement of the issue body. */
  async updateDescription(issueNumber: string, markdown: string): Promise<void> {
    await this.request("PATCH", this.issuePath(issueNumber), { body: markdown });
  }

  taskUrl(issueNumber: string): string {
    return `https://github.com/${this.repo}/issues/${issueNumber}`;
  }
}

/** The client for this checkout: token from the env file, shell or `gh`; repo
 *  from `GITHUB_REPO` or the origin remote. */
export const createGitHubClient = (env: Record<string, string | undefined>): GitHubClient => {
  const repo =
    env.GITHUB_REPO ??
    repoFromRemote(execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }));
  return new GitHubClient(resolveGitHubToken(env), repo);
};
