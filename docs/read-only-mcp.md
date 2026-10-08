# Read-only Offer Intelligence MCP

## Implementation and scope

`/mcp` and `/api/mcp` use a stateless Streamable HTTP adapter with JSON responses.
The existing `api/db/index.py` WSGI function hosts the adapter on Vercel; the local
`server.py` uses the same handler. The deployment still has seven functions.
No new runtime dependencies, frontend changes, LLM calls, or business-data writes
are required. Existing data-service caches may continue their normal refresh.

Supported protocol versions: `2025-11-25`, `2025-06-18`, and `2025-03-26`.
The implementation supports `initialize`, `ping`, `tools/list`, `tools/call`, and
client notifications. It advertises only tools. No sessions, unsolicited SSE,
resources, prompts, subscriptions, or arbitrary SQL/URL execution are offered.
GET/DELETE return 405; accepted notifications return 202 with no response body.

| Tool | Required argument | Optional controls |
|---|---|---|
| `search_merchants` | `query` | `limit` ≤ 50 |
| `get_merchant` | `merchantId` | `minimal`, `months` ≤ 24, `productLimit` ≤ 50 |
| `get_asin_details` | `asins` (1–25) | `months`, `offset`, `limit` |
| `search_offers` | none | `query`, `category`, `network`, `tier`, `fields`, `offset`, `limit` |
| `get_tier_report` | `tier` | `month`, `query`, `category`, `sortBy`, `descending`, `offset`, `limit` |
| `get_data_status` | none | none |

List limits default to 20, capped at 100 unless stated otherwise. Pagination is
applied after authorization filtering, query filtering and sorting. `nextOffset`
is null on the final page. Offset pagination is best effort across source updates;
it does not lock a snapshot. Search merchants is a bounded search (up to 200 source
candidates), explicitly marked `exhaustive: false`; use the Offer catalogue for
paginated catalogue exploration. `search_offers` exposes current cached metadata,
not dated revenue/EPC; use `get_tier_report` for performance metrics. Category
matching is case-insensitive exact matching; name/ID search is substring matching.

Tier metrics reuse `tier_sheet_payload` rather than recomputing commission or
EPC. EPC sorting uses `EPC(Aff)`. Tier commission columns are percentage points;
`Conversion Rate` is a ratio. Monetary values retain source units. Preserve AOV
provenance/type when presenting estimated AOV. Returned timestamps distinguish
retrieval time from source check time. Cached data is not represented as live data;
`get_data_status` provides underlying source dates. No new data cache is introduced.

## Credential and permission model

MCP never accepts browser cookies, `OFFER_DB_API_TOKEN`, or local disabled-auth
access as authentication. Use a dedicated high-entropy bearer token. Server
configuration stores only SHA-256 digests, credential labels, usernames, explicit
tool grants and expiry timestamps. Each request reloads the existing user from
`cnpscy_oi_user`; disabled/missing users and invalid levels fail closed. Level 2
cannot access this first set of tools. Tool grants intersect current page access.
Tools unavailable to the user are hidden and cannot be called by guessing names.

This release follows existing level 0/1 internal account-wide read permissions;
it is **not a new tenant/brand authorization model**. Merchant detail/list/ASIN/Tier
results are additionally restricted to `read_static_merchant_ids()`, matching the
published merchant boundary. Global freshness status is available to dashboard
readers. Do not issue these credentials to external partners requiring isolated
brand/account data. Fine-grained row entitlements require a separate implementation.

## Deploy and connect

1. Deploy the code through the normal repository/Vercel workflow.
2. Confirm that the existing DB configuration and application account work.
3. Generate a token locally (never in CI logs):

   ```bash
   python scripts/create_mcp_credential.py --id analyst-mcp --username EXISTING_USERNAME \
     --tool search_merchants --tool get_merchant --tool get_asin_details \
     --tool search_offers --tool get_tier_report --tool get_data_status
   ```

4. Store `bearerToken` only in the MCP client's secret store. Put the `credential`
   object inside a JSON array in the deployment environment variable
   `OI_MCP_CREDENTIALS`. For multiple clients, create separate entries. Never
   commit this output, token, or deployment configuration.
5. Apply the deployment environment change/redeploy. Configure the client with
   URL `https://www.yeahpromo.asia/mcp`, transport Streamable HTTP, and
   `Authorization: Bearer <token>`. This URL becomes usable only after deployment
   and credential setup. A client must support custom bearer headers.

This first release uses operator-provisioned credentials. It does **not** provide
OAuth discovery, consent, dynamic client registration or an authorization server.
Clients requiring an OAuth flow need that integration before they can connect.
It should not be presented as universally plug-and-play for every hosted AI app.

POST requests use `Content-Type: application/json` and
`Accept: application/json, text/event-stream`. After initialization send the
negotiated `MCP-Protocol-Version` header. Example request bodies:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"internal-client","version":"1.0"}}}
```

```json
{"jsonrpc":"2.0","method":"notifications/initialized"}
```

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_tier_report","arguments":{"tier":"Tier 2","month":"2026-09","category":"Beauty","sortBy":"epc","limit":20}}}
```

## Operations and limits

- Missing/malformed credential configuration returns 503. Missing/invalid/expired
  credentials return 401; denied accounts return 403; unavailable auth DB returns
  503. No source exception text, SQL or credentials are returned.
- Revoke a token by removing its configuration entry and applying the deployment
  configuration. Rotate with a new entry/token, verify it, then remove the old one.
  Disabling its user in the database takes effect on the next request.
- Origin is checked against exact `OI_MCP_ALLOWED_ORIGINS` entries (comma-separated).
  Defaults allow the two production domain variants and localhost:8765. Requests
  without Origin are accepted for server-to-server clients. CORS browser access
  is intentionally not enabled. Do not use `*` or accept `null` origins.
- Requests are capped at 32 KiB and tool data at 256 KiB before the text/structured
  result wrapper. Reduce limits/months/fields if a response is too large.
- Audit logs include credential label, known operation, outcome and elapsed time,
  never tokens, request arguments or returned data. Retain deployment logs under
  the existing internal log policy. Configure edge rate limits for public traffic;
  there is no distributed per-credential quota in this release.
- Cold starts and slow existing SQL remain possible; MCP reduces browser/LLM
  roundtrips and output size, not underlying database latency. `minimal=true`
  bypasses merchant profile/product queries when only trends are needed.

## Validation

```bash
python scripts/test_mcp.py
python scripts/test_auth_helpers.py
python scripts/test_vercel_db_wsgi.py
python scripts/test_vercel_function_budget.py
python scripts/test_page_access_routes.py
```

Tests use synthetic data and a real local HTTP roundtrip, and stop their server.
They do not require production credentials or mutate business data. Production
DB results, hosted transport and client credentials must still be smoke-tested
following deployment. Optional official SDK interoperability test:

```bash
python -m pip install mcp==2.3.0
python scripts/test_mcp_sdk.py
```

Protocol references:
- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle
