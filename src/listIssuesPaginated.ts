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

type RelationLike<T> = T | Promise<T> | (() => Promise<T>);
export type IssueLike = {
  id: string;
  title?: string | null;
  identifier?: string | null;
  state?: RelationLike<{ name?: string | null } | null>;
  assignee?: RelationLike<{ name?: string | null } | null>;
  project?: RelationLike<{ name?: string | null } | null>;
};
type IssuesPage<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
};
export type IssuesClient = {
  issues: (args: { first: number; after?: string | null }) => Promise<IssuesPage<IssueLike>>;
};
type Logger = { log: (...args: unknown[]) => void };

/**
 * Resolve relations returned by the SDK.
 * Relations can be: a relation function, a promise, or a resolved object.
 */
export async function resolveRelation<T>(rel: RelationLike<T> | null | undefined): Promise<T | null> { // helper to normalize relation access
  if (!rel) return null; // no relation present -> null
  if (typeof rel === "function") return await rel(); // relation exposed as function -> call it
  if (typeof (rel as Promise<T>).then === "function") return await rel; // promise-like -> await it
  return rel; // already resolved object -> return as-is
}

export function formatIssueLine(input: {
  title: string;
  id: string;
  state?: string;
  project?: string;
  assignee?: string;
}): string {
  const parts = [`- ${input.title} (id: ${input.id})`]; // base display parts for the issue
  if (input.state) parts.push(`[${input.state}]`); // append state if exists
  if (input.project) parts.push(`project: ${input.project}`); // append project if exists
  if (input.assignee) parts.push(`assignee: ${input.assignee}`); // append assignee if exists
  return parts.join(" — ");
}

export async function listIssuesPaginated(
  client: IssuesClient,
  options?: { pageSize?: number; logger?: Logger }
): Promise<number> {
  const pageSize = options?.pageSize ?? 50; // number of issues to fetch per GraphQL page
  const logger = options?.logger ?? console;
  let cursor: string | null | undefined = undefined; // pagination cursor for issues
  let page = 1; // human-readable page counter
  let totalCount = 0; // running total of issues processed

  do { // loop over pages until no next page
    const res = await client.issues({ first: pageSize, after: cursor ?? undefined }); // fetch a page of issues
    const count = res.nodes.length; // number of issues in this page
    logger.log(`Page ${page} — ${count} issue${count !== 1 ? "s" : ""}`); // print page header

    for (const issue of res.nodes) { // iterate each issue node on the page
      totalCount += 1; // increment total count
      const title = issue.title ?? issue.identifier ?? "<untitled>"; // choose a display title
      const id = issue.id; // issue id string

      // Resolve SDK relations which may be lazy LinearFetch<T> types
      const [stateObj, assigneeObj, projectObj] = await Promise.all([
        resolveRelation(issue.state), // resolve state relation (WorkflowState)
        resolveRelation(issue.assignee), // resolve assignee relation (User)
        resolveRelation(issue.project), // resolve project relation (Project)
      ]);

      const state = stateObj?.name ?? ""; // safely read state name if present
      const assignee = assigneeObj?.name ?? ""; // safely read assignee name if present
      const project = projectObj?.name ?? ""; // safely read project name if present

      logger.log("  " + formatIssueLine({
        title,
        id,
        state: state || undefined,
        project: project || undefined,
        assignee: assignee || undefined,
      })); // print assembled issue line
    }

    cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null; // advance cursor if more pages exist
    page += 1; // increment page counter
  } while (cursor); // continue until cursor is null

  logger.log(`\nTotal issues listed: ${totalCount}`); // final total printed
  return totalCount;
}

/**
 * Deterministic key handling:
 * - trims whitespace / CRLF / trailing newlines
 * - fails fast if missing/empty
 * - avoids module-scope client construction (prevents accidental "poisoned" clients)
 */
function getLinearClient(): LinearClient {
  const raw = process.env.LINEAR_API_KEY ?? "";
  const apiKey = raw.trim();

  if (!apiKey) {
    throw new Error("Missing or empty LINEAR_API_KEY after trim (check your .env).");
  }

  return new LinearClient({ apiKey });
}

async function main() { // main entrypoint for the script
  const client = getLinearClient();
  await listIssuesPaginated(client);
}

if (require.main === module) {
  main().catch((e) => { // run main and handle top-level errors
    console.error(e); // print error
    process.exit(1); // exit with failure code
  });
}


