# LES-177 Test Plan - Provide enumeration of issues

## Overview
The "enumeration of issues" feature lists Linear issues page-by-page, resolves
related entities (state, project, assignee), formats each issue line, and prints
summary counts. This plan focuses on verifying correct pagination, relation
handling, output formatting, and error propagation without calling the live
Linear API.

## Test Setup & Data
- Use mocked Linear SDK client responses (no network calls).
- Provide issues that exercise relation shapes:
  - relation function returning a promise
  - relation promise
  - already-resolved object
  - null/undefined relation
- Capture logger output for assertion.

## Unit Test Scenarios
### Relation resolution (`resolveRelation`)
| Scenario | Input | Expected Output |
| --- | --- | --- |
| Null/undefined relation | `null` / `undefined` | `null` |
| Relation function | `() => Promise.resolve(obj)` | `obj` |
| Promise relation | `Promise.resolve(obj)` | `obj` |
| Resolved object | `{ name: "Backlog" }` | same object |

### Issue line formatting (`formatIssueLine`)
| Scenario | Input | Expected Output |
| --- | --- | --- |
| Full detail | title + state + project + assignee | `"  - Title (id: X) — [State] — project: P — assignee: A"` |
| Missing title | identifier provided | falls back to identifier |
| Missing title + identifier | none provided | uses `"<untitled>"` |
| Missing optional fields | blank state/project/assignee | omit those segments |

## Integration Test Scenarios
### Paginated listing (`listIssuesPaginated`)
- **Pagination**: multiple pages returned by the mocked client.
  - Verify page headers (`Page N — X issue(s)`).
  - Verify cursor usage (`after` passed on subsequent calls).
  - Verify total count summary.
- **Relation resolution**: mix relation types in the same run.
  - Ensure resolved names are used in output.
- **Error propagation**: client `issues()` rejects.
  - Ensure the error surfaces to the caller (CLI handler logs and exits).

## Edge Cases
- Issue missing both title and identifier (prints `<untitled>`).
- Issue relations resolve to null (omit state/project/assignee segments).
- Empty page (0 issues) still prints a page header and returns total count.

## Error Scenarios
- Missing `LINEAR_API_KEY` in environment for CLI execution (fails fast).
- Linear client throws/rejects on `issues()` (error propagates to main handler).
- Relation function throws (error surfaces to caller).

## Integration Points to Validate
- Linear SDK pagination contract (`nodes`, `pageInfo`, `endCursor`).
- Relation resolution behavior for Linear SDK lazy relations.
- Logger/console output formatting.

## Performance Considerations
- Large number of pages: loop must terminate when `hasNextPage` is false.
- Default page size (50) should keep API calls bounded for large workspaces.
