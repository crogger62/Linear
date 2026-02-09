# Test Plan - Provide enumeration of issues (LES-155)

## Goal
Validate issue enumeration for the picker UI, including the backend endpoint,
search behavior, and selection integration.

## Scope
- `GET /api/issues` enumeration behavior
- Issue search and list rendering in `public/picker.html`
- Selection of an issue and handoff to `/api/run`

## Out of scope
- Python analysis pipeline details (beyond basic integration smoke)
- Non-issue workflows (e.g., project-only exports)

## Test environment / setup
- Node.js 20+ with dependencies installed (`npm install`)
- `.env` with a valid `LINEAR_API_KEY`
- Linear workspace with:
  - At least two teams
  - Multiple issues with identifiable titles
  - One known issue identifier (e.g., `ENG-123`)
  - Optional: 500+ issues to exercise pagination/limits

## Test data suggestions
- Issue A: identifier `ENG-123`, title "Alpha onboarding"
- Issue B: identifier `ENG-456`, title "Beta search results"
- Issue C: identifier `OPS-10`, title includes punctuation: `Customer, "quotes", & commas`
- Optional: issue with empty title (if workspace allows) to validate fallback display

## Functional test cases

| ID | Scenario | Steps | Expected |
| --- | --- | --- | --- |
| F1 | Enumerate issues (default) | Start server, call `GET /api/issues` with no params | HTTP 200, `issues` array present, length <= 200, each item has `id`, `identifier`, `title` |
| F2 | UI loads issues list | Open `/picker.html` | Issues list renders with radio options; no console errors |
| F3 | Search by identifier | `GET /api/issues?query=ENG-123` | Response contains the matching issue; list length 1 (or expected matches) |
| F4 | Identifier search is case-insensitive | `GET /api/issues?query=eng-123` | Same result as F3 |
| F5 | Search by title substring | `GET /api/issues?query=alpha` | Issues whose title includes "alpha" (case-insensitive) returned |
| F6 | Search input refreshes list | Type in UI search box | Issue list updates as query changes |
| F7 | Limit parameter applied | `GET /api/issues?limit=1` | Response contains exactly one issue |
| F8 | Upper limit clamp | `GET /api/issues?limit=999` | Response length <= 500 |
| F9 | Selection integration | Select an issue and click "Analyze Customer Requests" | `/api/run` request uses `type="issue"` and selected `id` |
| F10 | Issue-scoped export smoke | After F9 completes | `CustomerRequests.csv` contains only needs for the selected issue |

## Edge cases
- Query with leading/trailing whitespace (e.g., `"  ENG-123  "`): should be trimmed and match.
- Query with no results: returns `issues: []` and UI remains usable.
- Titles with punctuation/quotes: display correctly in the list.
- Workspaces with >500 issues: only the first 500 are considered; UI remains responsive.
- Issues missing a title: list label should still include the identifier without breaking UI.

## Error scenarios
- Missing or empty `LINEAR_API_KEY`: server fails fast with clear error logging.
- Invalid API key: `/api/issues` returns HTTP 500; UI should not crash.
- Linear API downtime/rate limit: endpoint returns HTTP 500; UI displays empty list or error state.
- Malformed `limit` (e.g., `limit=abc`): verify behavior (should clamp to default or return 400); file a follow-up if behavior is undefined.

## Integration points
- Express server (`customerRequests-server.ts`) calling Linear SDK (`linear.issues`)
- UI (`public/picker.html`) consuming `/api/issues` for issue enumeration
- `/api/run` integration to pass the selected issue id to `customerRequests.ts`

## Performance considerations
- `GET /api/issues` returns within ~2s for 200 issues and ~5s for 500 issues.
- Consecutive searches do not leak memory or grow response times.
- UI remains responsive while typing and rendering up to 200-500 items.

## Regression checks
- `/api/projects` continues to load and render in the picker.
- Workspace-wide selection remains default and functional.
