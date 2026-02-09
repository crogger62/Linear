# Test Plan: Provide enumeration of issues (LES-155)

## Overview
This test plan validates the ability to enumerate Linear issues for selection in
the Customer Request Analyzer picker UI and related API endpoints. The goal is
to ensure issue lists are accurate, searchable, bounded, and usable for follow-on
export actions.

## Scope
In scope:
- Issue enumeration API (`GET /api/issues`) and its filtering/limit behaviors.
- Picker UI issue list population and search behavior (`public/picker.html`).
- Integration of selected issue IDs with the export runner (`POST /api/run`).

Out of scope:
- Full export/analyzer correctness (covered by other plans).
- Linear API availability beyond basic error handling expectations.

## Preconditions / Test Data
- Valid `LINEAR_API_KEY` configured in `.env`.
- Workspace with multiple teams and issues.
- At least one issue per team (for identifier search).
- At least one issue with:
  - Long title (100+ characters)
  - Empty/untitled title (if possible)
  - Archived status (if applicable)
- Optional: workspace with >500 issues for pagination/limit tests.

## Functional Test Cases
| ID | Scenario | Steps | Expected Result |
| --- | --- | --- | --- |
| F1 | Load issues list (no search) | Start server; open picker UI; observe issues list | Issues list loads; entries show `identifier — title`; count <= default limit (200) |
| F2 | Search by identifier (TEAM-123) | Enter valid `TEAM-123` in search | List contains the matching issue (and only matches); identifier casing is normalized |
| F3 | Search by partial title | Enter a substring of an issue title | List filters to issues containing substring (case-insensitive) |
| F4 | Search by identifier lowercase | Enter `team-123` | Returns the matching issue (team key normalized to uppercase) |
| F5 | Limit parameter honored | Call `/api/issues?limit=1` and `/api/issues?limit=500` | Returns 1 and up to 500 issues respectively |
| F6 | Issue selection used in run | Select an issue and click "Analyze Customer Requests" | `/api/run` invoked with selected issue ID; run logs show correct ID usage |

## Edge Cases
- E1: Workspace has >500 issues; verify enumeration caps at 500 fetched and 200 default display.
- E2: Issue without title; list still renders with identifier only (no UI break).
- E3: Duplicate titles; list remains uniquely identifiable via identifier.
- E4: Search input with leading/trailing whitespace; results match trimmed query.
- E5: Query with special characters (`[]`, `#`, `:`); request succeeds, returns safe filtered list.
- E6: Identifier-like input that is invalid (e.g., `TEAM-ABC`); falls back to title search and does not error.

## Error Scenarios
- R1: Missing or empty `LINEAR_API_KEY`:
  - `/api/issues` responds `500` with error JSON.
  - UI displays empty list; server logs provide error context.
- R2: Linear API timeout or network error:
  - `/api/issues` responds `500` and logs error.
  - UI does not crash; user can retry.
- R3: Invalid `limit` value (non-numeric, 0, negative):
  - Server clamps or defaults; does not crash; response is bounded.
- R4: Rate limit response from Linear API:
  - `/api/issues` responds `500`; log includes rate limit error details.

## Integration Points
- Linear API: `linear.issues` pagination and filtering.
- Picker UI: `loadIssues()` and issue search input (`public/picker.html`).
- Export runner: selected issue ID passed through `/api/run` to `customerRequests.ts`.

## Performance Considerations
- P1: Enumeration of 500 issues completes within acceptable latency (target < 3s on typical network).
- P2: Rapid search input changes do not lock UI or leak event handlers.
- P3: Response payload remains bounded by server limit (<=500 items).

## Test Notes / Observability
- Validate server logs for errors or unexpected warnings during enumeration.
- Confirm no secrets (API key) are emitted in responses or logs.
