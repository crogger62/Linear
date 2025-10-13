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

const apiKey = process.env.LINEAR_API_KEY; // read LINEAR_API_KEY from env
if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env"); // bail if missing

const client = new LinearClient({ apiKey }); // construct SDK client with the API key

/**
 * Resolve relations returned by the SDK.
 * Relations can be: a relation function, a promise, or a resolved object.
 */
async function resolveRelation<T = any>(rel: any): Promise<T | null> { // helper to normalize relation access
  if (!rel) return null; // no relation present -> null
  if (typeof rel === "function") return await rel(); // relation exposed as function -> call it
  if (typeof rel.then === "function") return await rel; // promise-like -> await it
  return rel; // already resolved object -> return as-is
}

async function main() { // main entrypoint for the script
  const pageSize = 50; // number of issues to fetch per GraphQL page
  let cursor: string | null | undefined = undefined; // pagination cursor for issues
  let page = 1; // human-readable page counter
  let totalCount = 0; // running total of issues processed

  do { // loop over pages until no next page
    const res = await client.issues({ first: pageSize, after: cursor ?? undefined }); // fetch a page of issues
    const count = res.nodes.length; // number of issues in this page
    console.log(`Page ${page} — ${count} issue${count !== 1 ? "s" : ""}`); // print page header

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

      const parts = [`- ${title} (id: ${id})`]; // base display parts for the issue
      if (state) parts.push(`[${state}]`); // append state if exists
      if (project) parts.push(`project: ${project}`); // append project if exists
      if (assignee) parts.push(`assignee: ${assignee}`); // append assignee if exists
      console.log("  " + parts.join(" — ")); // print assembled issue line
    }

    cursor = res.pageInfo.hasNextPage ? res.pageInfo.endCursor : null; // advance cursor if more pages exist
    page += 1; // increment page counter
  } while (cursor); // continue until cursor is null

  console.log(`\nTotal issues listed: ${totalCount}`); // final total printed
}

main().catch((e) => { // run main and handle top-level errors
  console.error(e); // print error
  process.exit(1); // exit with failure code
});


