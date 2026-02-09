# LES-164 Test Plan - LES-155 Provide enumeration of issues

## Scope
- Validate the CLI that enumerates issues assigned to the authenticated user.
- Output includes viewer identity, per-issue lines (identifier/title/state), and a total count.
- Read-only behavior (no issue mutation).

## References
- Script: `src/myIssues.ts` (run via `npm run my-issues`)
- Dependencies: `@linear/sdk`, `dotenv`, `ts-node`

## Preconditions / Test Data
- Node 18+ and `npm install` completed.
- `.env` contains `LINEAR_API_KEY` with read access to issues.
- Test Linear workspace with:
  - Issues assigned to the test user in multiple workflow states.
  - At least 55 assigned issues to force pagination.
  - At least 1 archived issue assigned to the test user (if possible).

## Functional Test Cases
| ID | Scenario | Steps | Expected Result |
|---|---|---|---|
| F1 | Basic enumeration | Run `npm run my-issues` | Viewer line prints. Each issue line is `IDENTIFIER title [State]`. Total count matches Linear UI count for "assigned to me". |
| F2 | Alternate invocation | Run `npx ts-node src/myIssues.ts` | Output matches `npm run my-issues`. |
| F3 | Pagination | Ensure >50 assigned issues, run script | All issues are printed with no duplicates or missing entries; total count matches Linear UI. |
| F4 | State resolution | Ensure issues span multiple states | Each issue line includes the correct state name in brackets. |
| F5 | Archived inclusion | Ensure an archived issue is assigned to the user | Archived issue appears in output (script includes archived). |
| F6 | Placeholder behavior | If possible, use an issue with missing identifier/title | Script prints `<no-id>` or `<untitled>` and continues without crashing. |

## Edge Cases
- E1: No assigned issues -> output shows total `0` with no issue lines.
- E2: API key contains whitespace/newlines -> script trims and succeeds.
- E3: Very large issue set (>=1000) -> completes without excessive memory use.
- E4: Titles with commas/emoji/special characters -> output remains readable.

## Error Scenarios
- R1: Missing `.env` or `LINEAR_API_KEY` -> error "Missing or empty LINEAR_API_KEY after trim..." and exit code 1.
- R2: Invalid/expired API key -> SDK error surfaces; exit non-zero.
- R3: Network failures/timeouts -> error logged; exit non-zero.
- R4: Insufficient permissions -> error logged; exit non-zero.

## Integration Points
- Linear SDK calls: `viewer` and `issues` with pagination.
- `dotenv` loads `.env` from project root.
- `ts-node` execution via `npm run my-issues`.
- Node fetch availability (polyfill only needed on older Node versions).

## Performance Considerations
- Requests scale with issue count (page size = 50).
- Expected runtime: <30s for ~500 issues on typical network.
- Watch for rate limiting or timeouts on large workspaces.

## Post-Run Validation
- Compare total count to Linear UI "assigned to me".
- Spot-check several issues for correct identifier/title/state.
