// Tracker adapter: everything ClickUp-shaped lives here, so the worker only
// speaks in operations (get task, get children, set status, add tag, comment,
// task URL). Swapping the tracker means rewriting this file and nothing else.
import type { ChildTask, LooseTask } from "./lib.ts";

const BASE_URL = "https://api.clickup.com/api/v2";
const WEB_URL = "https://app.clickup.com/t";

interface RawDependency {
  task_id: string;
  depends_on: string;
}

interface RawTask {
  id: string;
  name: string;
  status: { status: string; type?: string };
  tags: { name: string }[];
  date_created: string;
  description?: string;
  text_content?: string;
  markdown_description?: string;
  parent?: string | null;
  list?: { id: string };
  dependencies?: RawDependency[];
  subtasks?: { id: string }[];
}

const bodyOf = (raw: RawTask): string =>
  raw.markdown_description ?? raw.text_content ?? raw.description ?? "";

const toChildTask = (raw: RawTask): ChildTask => ({
  id: raw.id,
  title: raw.name,
  status: raw.status.status,
  tags: raw.tags.map((t) => t.name),
  // A dependency row where this task is the waiting side means "blocked by".
  blockedBy: (raw.dependencies ?? [])
    .filter((d) => d.task_id === raw.id)
    .map((d) => d.depends_on),
  dateCreated: Number(raw.date_created),
  body: bodyOf(raw),
});

export class ClickUpClient {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ClickUp ${method} ${path} failed (${response.status}): ${text}`);
    }
    return (await response.json()) as T;
  }

  async getTask(taskId: string): Promise<RawTask> {
    return this.request<RawTask>(
      "GET",
      `/task/${taskId}?include_markdown_description=true`,
    );
  }

  /** The parent's children as neutral queue items. The subtask stubs in the
   *  parent payload lack tags/dependencies, so each child is fetched in full. */
  async getChildren(parentId: string): Promise<ChildTask[]> {
    const parent = await this.request<RawTask>(
      "GET",
      `/task/${parentId}?include_subtasks=true`,
    );
    const children: ChildTask[] = [];
    for (const stub of parent.subtasks ?? []) {
      children.push(toChildTask(await this.getTask(stub.id)));
    }
    return children;
  }

  /** A task passed by id to the loose-task drain, with its place in a plan. */
  async getLooseTask(taskId: string): Promise<LooseTask> {
    const raw = await this.request<RawTask>(
      "GET",
      `/task/${taskId}?include_subtasks=true&include_markdown_description=true`,
    );
    return {
      ...toChildTask(raw),
      parentId: raw.parent ?? undefined,
      subtaskCount: raw.subtasks?.length ?? 0,
      closed: raw.status.type === "closed" || raw.status.type === "done",
    };
  }

  /** A child of `parentId` in the parent's own list, created with the status
   *  and tags the queue expects (ClickUp would otherwise apply the list default). */
  async createChildTask(
    parentId: string,
    child: { title: string; body: string; status: string; tags: string[] },
  ): Promise<ChildTask> {
    const parent = await this.getTask(parentId);
    if (!parent.list?.id) throw new Error(`ClickUp task ${parentId} has no list id`);
    const created = await this.request<RawTask>("POST", `/list/${parent.list.id}/task`, {
      name: child.title,
      markdown_description: child.body,
      parent: parentId,
      status: child.status,
      tags: child.tags,
    });
    return toChildTask(await this.getTask(created.id));
  }

  async setStatus(taskId: string, status: string): Promise<void> {
    await this.request("PUT", `/task/${taskId}`, { status });
  }

  async addTag(taskId: string, tag: string): Promise<void> {
    await this.request("POST", `/task/${taskId}/tag/${encodeURIComponent(tag)}`, {});
  }

  async comment(taskId: string, text: string): Promise<void> {
    await this.request("POST", `/task/${taskId}/comment`, { comment_text: text });
  }

  /** Full replacement of the task description; `markdown_content` is ClickUp's
   *  field for the markdown body on update. */
  async updateDescription(taskId: string, markdown: string): Promise<void> {
    await this.request("PUT", `/task/${taskId}`, { markdown_content: markdown });
  }

  taskUrl(taskId: string): string {
    return `${WEB_URL}/${taskId}`;
  }
}
