 # Test Plan: LES-155 — Provide enumeration of issues (myIssues)
 
 ## Overview
 LES-155 adds 1-based enumeration to each issue line printed by `src/myIssues.ts`.
 The change should prefix every listed issue with an incrementing number that
 continues across pagination, while preserving existing output details.
 
 ## Scope
 **In scope**
 - CLI output formatting for `myIssues.ts` (issue enumeration).
 - Correct numbering across pagination.
 - No regressions in viewer info, issue details, or total count.
 
 **Out of scope**
 - Changes to Linear API data, issue assignment behavior, or UI features.
 - Analyzer/picker server flows unrelated to `myIssues.ts`.
 
 ## Test Environment / Setup
 - Node.js 18+ (20+ recommended).
 - `npm install`.
 - `.env` with a valid `LINEAR_API_KEY`.
 - Linear workspace with:
   - At least 3 issues assigned to the authenticated user.
   - At least one archived issue assigned to the user (to confirm inclusion).
   - Optional: an issue missing title/identifier (if possible in test data).
 - For pagination tests: assign 51+ issues to the same user (or use a test workspace).
 
 ## Functional Test Cases
 
 ### F1: Basic enumeration output
 **Steps**
 1. Run: `npm run my-issues`.
 2. Observe the list of issues.
 
 **Expected**
 - Each issue line starts with `1.`, `2.`, `3.`, etc.
 - Enumeration is strictly increasing by 1 per issue.
 - Output format stays: `<N>. <IDENTIFIER> <TITLE> [<STATE>]`.
 - Viewer header and "Issues assigned to you:" section remain unchanged.
 
 ### F2: Enumeration matches total count
 **Steps**
 1. Run: `npm run my-issues`.
 2. Note the last enumerated issue number.
 3. Compare with the final `Total issues: X` line.
 
 **Expected**
 - The last enumerated number equals `Total issues: X`.
 
 ### F3: Enumeration across pagination
 **Precondition**
 - User has 51+ assigned issues (forces pagination).
 
 **Steps**
 1. Run: `npm run my-issues`.
 2. Observe the output after the first 50 issues.
 
 **Expected**
 - Issue 51 appears as `51.` (not reset to `1.`).
 - Enumeration continues without gaps across pages.
 
 ### F4: Archived issues are still included
 **Steps**
 1. Ensure at least one assigned issue is archived.
 2. Run: `npm run my-issues`.
 
 **Expected**
 - Archived issues appear in the list with enumeration (no filtering change).
 
 ## Edge Cases
 
 ### E1: No assigned issues
 **Precondition**
 - Test user has zero assigned issues.
 
 **Steps**
 1. Run: `npm run my-issues`.
 
 **Expected**
 - No enumerated issue lines are printed.
 - Final output reads `Total issues: 0`.
 
 ### E2: Missing identifier or title
 **Steps**
 1. Use a test issue lacking a title or identifier (if possible).
 2. Run: `npm run my-issues`.
 
 **Expected**
 - Enumeration still appears.
 - Placeholder values are used (`<no-id>`, `<untitled>`).
 
 ### E3: Missing or unresolved issue state
 **Steps**
 1. Use an issue with missing state relation (if possible).
 2. Run: `npm run my-issues`.
 
 **Expected**
 - Enumeration still appears.
 - State renders as `(No State)` without crashing.
 
 ## Error Scenarios
 
 ### ER1: Missing or blank LINEAR_API_KEY
 **Steps**
 1. Remove `LINEAR_API_KEY` from `.env` or set it to whitespace.
 2. Run: `npm run my-issues`.
 
 **Expected**
 - Script fails fast with a clear error about missing/empty API key.
 - Non-zero exit code.
 
 ### ER2: Invalid/expired LINEAR_API_KEY
 **Steps**
 1. Set `LINEAR_API_KEY` to an invalid value.
 2. Run: `npm run my-issues`.
 
 **Expected**
 - Linear SDK throws an auth error.
 - Error is printed and process exits non-zero.
 
 ### ER3: Network/API failures
 **Steps**
 1. Simulate network outage or block API access.
 2. Run: `npm run my-issues`.
 
 **Expected**
 - Script reports the error and exits non-zero.
 - Enumeration should not be partially corrupted (no duplicate numbering on retry).
 
 ## Integration Points
 - Linear GraphQL API via `@linear/sdk`:
   - `viewer` fetch for user context.
   - `issues` pagination.
   - `issue.state` relation resolution.
 - `.env` loading at runtime (`dotenv`).
 - CLI entrypoints: `npx ts-node src/myIssues.ts` and `npm run my-issues`.
 
 ## Performance Considerations
 - Enumeration adds O(1) work per issue; no additional API calls.
 - Validate runtime with 500+ issues to ensure pagination and output remain stable.
 - Watch for API rate limiting (not introduced by enumeration, but large lists may expose it).
 
 ## Notes / Assumptions
 - Issue ordering is determined by Linear API defaults; enumeration follows returned order.
 - There is no sorting change in LES-155; only output format changes.
