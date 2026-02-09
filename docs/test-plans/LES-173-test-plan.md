# Test Plan: LES-155 Issue Enumeration (LES-173)

## Scope
Validate the issue enumeration flow used by the picker UI. The scope focuses on
the `/api/issues` endpoint in `src/customerRequests-server.ts`, including:

- Identifier lookup (TEAM-123 style)
- Title/identifier search with case-insensitive matching
- Pagination and result limiting
- Error handling and response shape

## Out of Scope
- End-to-end UI rendering
- Linear API auth/permissions beyond basic error handling
- Python analysis pipeline

## Test Data
- Issue fixtures with `id`, `identifier`, and `title`
- Multiple pages of issue results (to validate pagination and limiting)

## Unit Test Scenarios
1. **UT-1: API key normalization**
   - **Input:** `LINEAR_API_KEY` with leading/trailing whitespace and newline
   - **Expected:** trimmed key returned and `process.env.LINEAR_API_KEY` updated
2. **UT-2: Missing API key**
   - **Input:** `LINEAR_API_KEY` unset or whitespace only
   - **Expected:** throws error indicating missing/empty key
3. **UT-3: Pagination aggregation**
   - **Input:** paged fetch function returning two pages of nodes
   - **Expected:** aggregated results returned in order; fetch called with cursors

## Integration Test Scenarios
1. **IT-1: Identifier lookup**
   - **Input:** `GET /api/issues?query=eng-101&limit=2`
   - **Expected:** Linear issues called with team key `ENG` and number `101`;
     response includes up to 2 issues with `{ id, identifier, title }`.
2. **IT-2: Title/identifier search (case-insensitive)**
   - **Input:** `GET /api/issues?query=fix&limit=abc`
   - **Expected:** issues filtered by title or identifier match; invalid limit
     defaults to 200; response contains all matches.
3. **IT-3: Linear API error**
   - **Input:** Linear issues call throws
   - **Expected:** `500` response with `{ error: "Failed to fetch issues" }`.

## Edge Cases and Error Scenarios
- Query with only whitespace should behave like no query (returns recent issues)
- Limit clamped to [1, 500]; invalid limit defaults to 200
- No matches returns empty `issues` array
- Linear API failures return `500` with consistent error payload

## Integration Points
- Linear SDK `issues` API (pagination and filtering)
- Picker UI search box (uses `/api/issues` with `query` and `limit`)

## Performance Considerations
- Endpoint caps fetch to 500 issues per request to prevent large payloads
- Verify response remains fast with multiple pages (simulated in tests)

## Automated Test Files
- `src/__tests__/customerRequests-server.unit.test.ts`
- `src/__tests__/integration/customerRequests-server.integration.test.ts`
