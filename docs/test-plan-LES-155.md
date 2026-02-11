# Test Plan - Provide enumeration of issues (LES-155)

## Scope
This plan covers the workspace snapshot CLI that enumerates open issues and
produces aggregated views:

- Open issues grouped by **Project → State**
- Active projects (planned/started) with open-issue counts
- Assignee load (open issues per user)

Primary implementation: `src/workspaceSnapshot.ts`

## Entry Points & Inputs
- CLI flags:
  - `--format md|csv` (default `md`)
  - `--out <pathPrefix>` (writes `<prefix>.md` or `<prefix>.csv`)
  - `--include-team` (adds Team column in outputs)
- Environment:
  - `LINEAR_API_KEY` (required)
- External dependency:
  - Linear SDK (`client.issues`, `client.project`)

## Unit Test Scenarios
### Formatting helpers
1. **CSV escape**
   - Input: plain string → output unchanged.
   - Input: contains commas/quotes/newlines → output quoted and quotes doubled.
   - Input: `null/undefined` → output empty string.
2. **Markdown escape**
   - Input: string with `|` → output escapes pipes.
   - Input: `undefined` → output empty string.

### Pagination & concurrency utilities
3. **Paginator (`paginate`)**
   - Input: mock paginated fetch (2 pages).
   - Output: concatenated list in the original order.
4. **Concurrency mapper (`mapLimit`)**
   - Input: list of items with artificial delay, limit `N`.
   - Output: results aligned to input order; max concurrent tasks ≤ `N`.

### Aggregations
5. **Group by project/state**
   - Input: issues with missing project/state.
   - Output: `(No Project)` / `(No State)` buckets created correctly.
6. **Active projects computation**
   - Input: projects with states `planned`, `started`, `completed`, archived.
   - Output: only non-archived `planned|started` projects included; counts accurate.
7. **Assignee load**
   - Input: mix of assignees + unassigned issues.
   - Output: counts by assignee; `(unassigned)` bucket present when needed.

### Output builders
8. **Markdown builder**
   - Input: aggregated data and fixed timestamp.
   - Output: includes headers, counts, and optional Team column when enabled.
9. **CSV builder**
   - Input: aggregated data with `includeTeam`.
   - Output: includes correct section headers and team column when enabled.

## Integration Test Scenarios
1. **End-to-end snapshot pipeline (mocked Linear SDK)**
   - Inputs: paginated issues with mixed archived/non-archived, projects with
     various states, assignees/teams present.
   - Expected output:
     - Archived issues filtered out.
     - Relations (state/project/team/assignee) resolved into issue rows.
     - Active projects list only includes `planned|started` and non-archived.
     - Markdown output includes expected sections and rows.

## Edge Cases & Error Scenarios
1. **No issues returned**
   - Output contains headers but no issue rows; counts show zero.
2. **Missing relations**
   - Issue without project/state/assignee → uses `(No Project)`, `(No State)`,
     `(unassigned)` placeholders.
3. **All projects inactive**
   - Active project section empty; output still well-formed.
4. **Special characters in titles**
   - CSV fields escaped; markdown pipes escaped.
5. **Missing LINEAR_API_KEY**
   - CLI exits with clear error message.
6. **SDK errors**
   - Errors from `client.issues` or `client.project` surface and exit non-zero.

## Integration Points to Validate
- Linear SDK pagination (`client.issues`) with `pageInfo` handling.
- Project lookup (`client.project`) for active project computation.
- File output when `--out` is specified.
- `--include-team` flag toggles team column for both CSV and Markdown.

## Performance Considerations
- Pagination should process large workspaces without loading all relations at once.
- `mapLimit` concurrency cap prevents overloading the API.
- For large datasets, ensure output generation remains linear in issue count.
