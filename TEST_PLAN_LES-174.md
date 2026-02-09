# Test Plan - Provide enumeration of issues (LES-155)

## Goal
Validate that the issue enumeration CLI correctly paginates, resolves relations,
formats output, and handles empty and error cases.

## Scope
- Script under test: `src/listIssuesPaginated.ts`
- Output formatting for issue lines and summary totals
- Integration with the Linear SDK connection shape (issues pagination and lazy
  relations)

Out of scope:
- Live Linear API calls and rate limiting behavior (manual only)
- Auth and permissions beyond input validation

## Test environment
- Node 18+
- `LINEAR_API_KEY` only required for manual CLI runs
- Automated tests use mocked clients (no network calls)

## Unit test scenarios
1. `resolveRelation`
   - Null or undefined returns null
   - Relation functions resolve to expected values
   - Promise relations resolve to expected values
   - Direct objects are returned as-is
   - Errors from relation resolution are propagated
2. `formatIssueLine`
   - Base line with title and id
   - Optional segments rendered in order: state, project, assignee

## Integration test scenarios
1. Multi-page enumeration
   - Issues returned across multiple pages
   - Correct `after` cursor values passed to subsequent calls
   - Page header pluralization matches counts
   - Issue lines include resolved state, project, and assignee
   - Final total count matches number of issues
2. Empty result set
   - Prints a single page header with 0 issues
   - Total count is 0
3. Missing title and identifier
   - Falls back to "<untitled>" in output
4. Client error propagation
   - Errors from `issues` are surfaced to the caller

## Edge cases and error conditions
- Issues missing optional relations (state, project, assignee)
- Missing title and identifier for an issue
- Client failures or network errors during pagination

## Integration points to test
- `client.issues` pagination with `pageInfo.hasNextPage` and `endCursor`
- Lazy relation resolution patterns:
  - Function relations
  - Promise relations
  - Already-resolved objects

## Performance considerations
- Ensure pagination requests are chunked by `pageSize` (default 50)
- Avoid loading all issues at once; verify multiple page fetches on large sets
