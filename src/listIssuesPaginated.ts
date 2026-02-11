/** 
 * listIssuesPaginiated.ts
 * 
 * List issues paginated and print counts
*
* Shows how to use cursors/pagination with the Linear SDK
* 
*  */

import "dotenv/config"; // load .env into process.env
import { LinearClient } from "@linear/sdk"; // Linear SDK client type

// Uncomment if Node lacks global fetch
// import fetch from "cross-fetch"; // polyfill fetch for older Node
// (globalThis as any).fetch ??= fetch; // assign polyfill to global if needed

export type IssueRelation<T> = T | Promise<T> | (() => Promise<T>) | null | undefined;

export type IssueNode = {
  id: string;
  identifier?: string | null;
  title?: string | null;
  state?: IssueRelation<{ name?: string | null }>;
  assignee?: IssueRelation<{ name?: string | null }>;
  project?: IssueRelation<{ name?: string | null }>;
};

export type IssuesClient = {
  issues: (args: {
    first: number;
    after?: string | null | undefined;
  }) => Promise<{
    nodes: IssueNode[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  }>;
};

export type ListIssuesOptions = {
  pageSize?: number;
  logger?: { log: (message: string) => void };
};

/**
 * Resolve relations returned by the SDK.
 * Relations can be: a relation function, a promise, or a resolved object.
 */
export async function resolveRelation<T>(rel: IssueRelation<T>): Promise<T | null> { // helper to normalize relation access
  if (!rel) return null; // no relation present -> null
  if (typeof rel === "function") return await rel(); // relation exposed as function -> call it
  if (typeof (rel as Promise<T>)?.then === "function") return await rel; // promise-like -> await it
  return rel; // already resolved object -> return as-is
}

export function formatIssueLine(
  issue: { id: string; title?: string | null; identifier?: string | null },
  state?: string,
  project?: string,
  assignee?: string
): string {
  const title = issue.title ?? issue.identifier ?? "<untitled>";
  const parts = [`- ${title} (id: ${issue.id})`];
  if (state) parts.push(`[${state}]`);
  if (project) parts.push(`project: ${project}`);
  if (assignee) parts.push(`assignee: ${assignee}`);
  return "  " + parts.join(" — ");
}

export async function listIssuesPaginated(
  client: IssuesClient,
  options: ListIssuesOptions = {}
): Promise<number> {
  const pageSize = options.pageSize ?? 50;
  const logger = options.logger ?? console;
  let cursor: string | null | undefined = undefined;
  let page = 1;
  let totalCount = 0;

  do {
    const res = await client.issues({ first: pageSize, after: cursor ?? undefined });
    const count = res.nodes.length;
    logger.log(`Page ${page} — ${count} issue${count !== 1 ? "s" : ""}`);

    for (const issue of res.nodes) {
      totalCount += 1;
      const [stateObj, assigneeObj, projectObj] = await Promise.all([
        resolveRelation(issue.state),
        resolveRelation(issue.assignee),
        resolveRelation(issue.project),
      ]);

      const state = (stateObj as { name?: string | null } | null)?.name ?? "";
      const assignee = (assigneeObj as { name?: string | null } | null)?.name ?? "";
      const project = (projectObj as { name?: string | null } | null)?.name ?? "";

      logger.log(formatIssueLine(issue, state, project, assignee));
    }

    cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null;
    page += 1;
  } while (cursor);

  logger.log(`\nTotal issues listed: ${totalCount}`);
  return totalCount;
}

function getClientFromEnv(): LinearClient {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env");
  return new LinearClient({ apiKey });
}

async function main() {
  const client = getClientFromEnv();
  await listIssuesPaginated(client);
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}


