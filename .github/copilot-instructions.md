This repository is a small TypeScript-based CLI and examples for interacting with the Linear API.

Key points for an AI coding agent working here:

- Big picture
  - The codebase contains small, standalone scripts (under `src/`) that each demonstrate a single Linear API interaction: `createIssue.ts`, `issuesFiltered.ts`, `teams.ts`, `me.ts`, `webhook-server.ts`, and helpers like `paginatedIssues.ts`.
  - Scripts are intended to run with `npx ts-node src/<script>.ts` or be compiled with a standard TypeScript toolchain. They rely on runtime env vars (not a build-time config) for secrets.

- Environment & secrets
  - All scripts expect a `.env` file with `LINEAR_API_KEY` set. `webhook-server.ts` also requires `WEBHOOK_SECRET` when running the webhook server.
  - Node 18+ is assumed (some files mention a `fetch` polyfill for older nodes). If targeting older Node versions, preserve the commented `cross-fetch` polyfill lines.

- Running & dev workflow
  - Run scripts directly with ts-node: `npx ts-node src/me.ts`, `npx ts-node src/createIssue.ts`, etc.
  - For the webhook server: `npx ts-node src/webhook-server.ts` then expose locally via `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000` if you need external callbacks.

- Patterns and conventions
  - Each script initializes a `LinearClient` from `@linear/sdk` using `process.env.LINEAR_API_KEY`.
  - Pagination: use the SDK's GraphQL-style cursors (`first`, `after`) and `pageInfo.endCursor` to iterate. Examples: `teams.ts`, `issuesFiltered.ts`.
  - Lazy relations: the SDK returns fetchable relations (e.g., `issue.state`, `issue.team`) that must be `await`ed. Code often does `const issue = await result.issue;` and then `await issue.labels()`.
  - Raw body handling for webhooks: `webhook-server.ts` uses `bodyParser.raw({ verify })` and stores `req.rawBody` for HMAC-SHA256 signature checks. Preserve raw-body capture when editing that file.
  - Security: `webhook-server.ts` verifies `Linear-Signature` using `crypto.timingSafeEqual` against HMAC-SHA256 hex digest; do not change that verification to a non-constant-time compare.

- Files worth referencing in PRs / edits
  - `src/webhook-server.ts` — SSE broadcast pattern, raw-body HMAC verification, static `public/` serving expectations.
  - `src/issuesFiltered.ts` — argument parsing conventions (`--flag value`, `--boolean-flag`), client-side filters after fetching pages, and label/state helpers.
  - `src/createIssue.ts` & `src/teams.ts` — examples of creating mutations and paginated reads.
  - `src/me.ts` — canonical viewer lookup (`client.viewer`) and minimal output format.

- Error handling and behavior
  - Scripts log and exit with non-zero on unhandled errors (`process.exit(1)`) — keep this behavior for CLI-like scripts.
  - Webhook endpoint returns 401 for invalid signatures and 200 quickly on success; heavy work should be offloaded (this repo prefers quick ACKs).

- Tests & build
  - No test or build configuration exists in this repo root. Avoid adding heavy infra; prefer small, runnable examples and keep changes minimal and self-contained.

- When modifying code
  - Match the existing concise-comment style. Many files include commented polyfill lines and usage examples — preserve them where relevant.
  - Retain explicit environment error checks (e.g., `if (!apiKey) throw new Error("Missing LINEAR_API_KEY in .env")`).

If anything here is unclear or you'd like more detail on a specific script (e.g., the webhook flow or pagination examples), tell me which file to expand and I'll update this guidance.
