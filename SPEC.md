# Flightlog: collection-first V1

Status: design specification, September 8, 2026. A prototype implementation now exists in this workspace; see README.md for current status and run instructions. The requirements below remain the design target, not a record of completed acceptance testing.

> Record the trail. Don't invent the story.

## Priority and scope

Get useful real Windows and Chrome observations into local SQLite quickly, then inspect whether they are accurate. A visual frontend must not be on the critical path. Optimize for data integrity, objective measurement, privacy, simplicity, and evolution, in that order.

- **OBSERVED:** timestamped API callbacks and sampled states, including unavailable states. A sensor reports a foreground application at a point in time.
- **COMPUTED:** durations, transitions, and other reproducible results with explicit rules and input references. An interval between observations belongs here.
- **INFERRED:** probabilistic interpretations. None in V1. Future inference must have separate storage, provenance, model version, and uncertainty.

Foreground time does not establish attention, usefulness, reading, or work. Gaps remain unknown. Do not store subjective labels in sensor events.

The first milestone supports one Windows user, one running backend, and one enrolled regular Chrome profile. Other profiles/browsers may appear as Windows applications but have no page attribution. No cloud, accounts, syncing, telemetry, Vercel, Supabase, Postgres, screenshots, keystrokes, clipboard, forms, cookies, messages, page bodies, DOM capture, or history import. No productivity scores, distraction/drift detection, motivational features, or AI narratives.

## Components and exact recommended stack

1. **One headless local backend:** C# / .NET 10 LTS, ASP.NET Core Minimal APIs with Kestrel, Win32 P/Invoke for collection, and Microsoft.Data.Sqlite for SQLite. Run manually as a console application initially. A hosted background worker samples Windows; one serialized writer owns database writes. No Windows service, tray app, WPF, ORM, or dependency-heavy architecture.
2. **One Chrome extension:** Manifest V3, TypeScript compiled with `tsc`, Chrome APIs, and IndexedDB for a small durable outgoing queue. No React or content scripts. A small options page sets the local connection token and capture preferences; a popup shows collection/connection status.
3. **One local SQLite file:** `%LOCALAPPDATA%\Flightlog\flightlog.sqlite3`. This is the authoritative accepted observation store, outside the repository. Pending extension events are not a second source of truth.
4. **One local HTTP interface:** `http://127.0.0.1:43123/api/v1`. Both the extension and future frontend use it. Initial inspection uses JSON plus a tiny static HTML/JavaScript table served by the backend. The table has no privileged database access.

.NET 10 is the recommended LTS baseline; pin the installed supported patch and package versions during implementation. [Microsoft support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core)

Logical separation within one project is sufficient: `Collection/`, `Storage/`, `Computation/`, `Api/`, and `wwwroot/`. Collectors produce event records; storage knows nothing about HTML or visualization. API DTOs are explicit contracts, not SQLite rows serialized indiscriminately. Do not introduce separate services or generic plugin frameworks.

```text
Windows sample -> privacy filter -------------------+
                                                   v
Chrome APIs -> privacy filter -> local outbox -> loopback API
                                                   |
                                           validate + commit
                                                   |
                                                 SQLite
                                                   |
                                     deterministic interval queries
                                                   |
                                               local API
                                                   |
                                   debug table now / galaxy later
```

## Minimum event contract

All events have this envelope. All fields are required; nullable fields use JSON null. UUIDs are strings. Times are Unix UTC milliseconds except `mono_ms`, which is elapsed monotonic milliseconds in one sensor session.

```json
{
  "v": 1,
  "id": "UUID",
  "source_id": "UUID",
  "session_id": "UUID",
  "seq": 1,
  "observed_at_ms": 1788868800000,
  "mono_ms": 0,
  "kind": "windows.state",
  "data": {}
}
```

`source_id` identifies an installation, not a person/email. `session_id` changes on backend collection start, extension worker start, pause/resume, or lost continuity. `seq` increases within that source/session and is allocated with the queue append. `id` never changes on retry. The receiver adds `received_at_ms`. Sequence determines within-session order, not HTTP arrival order. Native tab/window IDs are scoped to the source/session; PID/HWND are not permanent identities.

Only five raw event types are needed initially:

| Kind | Exact `data` fields |
| --- | --- |
| `windows.state` | `status: available/excluded/unavailable`, `exe: string?`, `pid: integer?`, `hwnd: string?`, `title: string?` |
| `browser.state` | `status: foreground/background/excluded/unavailable`, `window_id: integer?`, `tab_id: integer?`, `document_id: string?`, `page: Page?`, `reason: snapshot/focus/activation/update` |
| `browser.navigation` | `tab_id: integer`, `document_id: string?`, `navigation_kind: committed/history_state/fragment`, `api_at_ms: number?`, `page: Page` |
| `browser.tab` | `action: created/removed/replaced/opener`, `tab_id: integer`, `related_tab_id: integer?`, `relation: opener_tab_id/navigation_target/replacement/null` |
| `sensor.boundary` | `state: started/paused/locked/resumed/gap/stopped`, `reason: string` from fixed diagnostic codes, `lost_count: integer?` |

`Page` is exactly `{scheme: string?, host: string?, path: string?, title: string?, search_provider: string?, search_query: string?, status: allowed/excluded/unsupported/unavailable}`. Scheme is http/https when allowed. Host is normalized lowercase ASCII, without port. No raw full URL is stored. Excluded/unsupported pages have all metadata null. Excluded Windows states have all identity fields null. Excluded browser state has null IDs and page; no ancestry events for excluded tabs. Null means unavailable, disabled, or redacted; the status and configured capture policy distinguish these where possible, without revealing excluded identities.

`browser.tab` rules: created/removed have null relation and related ID; opener has a related parent tab and one of the two opener evidence types; replaced has the removed tab as `tab_id`, new tab as `related_tab_id`, and relation replacement. Missing parents stay unknown. An opener relationship is API evidence, not intent. No attempt to deduce every navigation origin.

No raw duration, category, attention score, canonical page identity, or inferred relationship. Search text is captured only from an enabled provider URL adapter as part of a navigation, not by reading input fields; a separate search event would duplicate that observation.

Set practical bounds before persistence: title/query 512 characters, path 2,048, event 16 KiB, request 256 KiB. Reject invalid/oversized envelopes with a visible error; never truncate a JSON message into an accepted event. Text fields may be clipped before envelope construction. Validate type-specific fields and producer/type combinations in backend code.

## Minimal SQLite schema

One raw table plus schema version is enough for the first milestone. No normalized page graph, projection framework, or derived materialization yet.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  v INTEGER NOT NULL CHECK(v = 1),
  source_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq > 0),
  observed_at_ms INTEGER NOT NULL,
  mono_ms REAL NOT NULL CHECK(mono_ms >= 0),
  received_at_ms INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN (
    'windows.state','browser.state','browser.navigation',
    'browser.tab','sensor.boundary')),
  data_json TEXT NOT NULL CHECK(json_valid(data_json)),
  UNIQUE(source_id, session_id, seq)
);
CREATE INDEX observations_time ON observations(observed_at_ms, id);
CREATE INDEX observations_kind_time ON observations(kind, observed_at_ms, id);
PRAGMA user_version = 1;
```

Use parameterized SQL and transactions. ACK only committed IDs. Identical retries are successful no-ops; an ID or sequence collision with different content is an error. Raw records remain unchanged except explicit deletion. Settings live in a local JSON file; capture-setting changes start a new sensor session. Keep a local settings version/history without activity payloads so collection defaults remain explainable.

Compute initial intervals on demand over bounded ranges, including the immediately preceding state and following boundary/confirmation needed for clipping. Return algorithm version and parameters. Later, add rebuildable `computed_*` tables and separate `inferred_*` tables through migrations when needed. Never amend raw JSON with computed fields. SQLite schema is an implementation detail behind the API.

WAL and FULL favor durable acknowledgement and concurrent reads; they do not make faulty storage infallible. Use SQLite's backup API when adding live backup support. [SQLite pragmas](https://www.sqlite.org/pragma.html#pragma_synchronous)

## Phase 1 sensor behavior

### Windows

Poll `GetForegroundWindow` every 1 second, then read process identity and optional window title. Emit a `windows.state` every poll, even unchanged: samples also confirm coverage. Recheck the HWND after metadata lookup to avoid pairing one window's title with another process. Unknown/null/access-denied state stays unavailable; do not elevate. Store executable basename, not executable path. Group by basename initially, acknowledging collisions and hosted applications.

Observe lock/unlock and suspend/resume notifications in the worker, emitting boundaries and sampling again after resume. A small hidden message window may be used to receive those notifications; it is collection plumbing, not a UI framework. Shutdown emits a best-effort boundary. No idle detection/subtraction. Foreground may remain unchanged while the person is away.

Polling is the deliberate first implementation: switches shorter than a second may be missed, boundaries are sample times, and scheduler delays can be longer. Do not call this exact switch capture. Add `EVENT_SYSTEM_FOREGROUND` hooks only after the vertical slice works if the pilot shows a need. Null foreground is a valid API outcome. [GetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getforegroundwindow)

### Chrome

Manifest permissions: `tabs`, `webNavigation`, `storage`, `alarms`, plus host permission restricted to `http://127.0.0.1/*` for backend requests (Chrome host match patterns are not a port security boundary). Requests come from the extension worker, never content scripts. Server validation restricts the actual port and enrolled client. [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)

Listen for focused-window changes, tab activation and retained URL/title updates, tab creation/removal/replacement, and top-level webNavigation committed/history-state/fragment callbacks. Ignore subframes. URL metadata updates do not create an extra navigation count. Fragment values are discarded. Use openerTabId and target-creation callbacks only as explicit relationship evidence. Filter events before writing to IndexedDB.

Capture current foreground browser state on startup, relevant callbacks, and a 30-second alarm. Selected tabs in unfocused windows are not foreground. State reads are asynchronous: serialize processing and resample if callbacks change state during a query. Unresolved races produce unavailable state. On removal/replacement, immediately refresh foreground state. A startup snapshot observes the current tab now; it never backfills earlier history.

Every worker start opens a new session and confirms fresh state. Persist queued records before sending; do not rely on globals surviving worker suspension. Alarm cadence is approximate, not a heartbeat guarantee. [Chrome worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

Search adapters initially recognize exact Google `/search?q=`, Bing `/search?q=`, and DuckDuckGo `/?q=` URLs for explicitly configured hosts. Query capture is opt-in. Reject ambiguous repeated query values. No POST searches, autocomplete, typed-but-unsubmitted text, or semantic search sessions. Preserve observed query order; do not pretend to see missing intermediate searches. Chrome API timestamps can differ from extension clock time, so retain navigation `api_at_ms` only as evidence and use callback capture time for V1 boundaries. [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)

## Privacy before persistence

Default fields: application basename, timing, HTTP(S) host, and browser page title. Optional paths, search queries, and non-browser window titles are off until explicitly enabled. Windows Chrome titles are always suppressed, avoiding leakage of incognito or excluded browser titles through the desktop collector. Browser titles can themselves contain search text or message previews; disabling query extraction cannot guarantee that titles contain no such text. Offer a title-off switch and domain exclusions from the beginning.

Never collect content scripts, DOM, bodies, forms, cookies, clipboard, messages, keystrokes, or screenshots. Reading metadata is not a guarantee that metadata contains no sensitive text. Strip URL credentials, query strings, fragments, and ports before queuing; enabled search adapters may retain only their one approved query value. Paths can also contain secrets and stay off by default.

Disable incognito in the manifest and reject it at runtime. Exclude non-HTTP(S), localhost, loopback/private IP literals, user-listed hosts, and user-listed executables before any persistence. No DNS lookups or remote enrichment. Emit an anonymous excluded state when necessary to stop the previous allowed interval; do not store identifying hashes or excluded ancestry. Backend validates the filtered schema again; it never requires raw URLs for filtering.

Capture preferences and exclusions are local to each sensor in Phase 1, avoiding configuration synchronization. Changing settings clears pending events for that sensor, starts a new session, and shows a coverage break. Each sensor has a pause switch; stopping the backend stops Windows capture, but Chrome may still buffer, so its status must say so. Do not advertise backend exit as global pause. Stop both sensors to stop all collection.

Use user-restricted runtime files. SQLite is not application-encrypted in this prototype; rely on Windows account/device protection and state this plainly. No activity text in logs, request logging, error reports, or Git. No remote assets, favicons, fonts, or analytics.

Phase 1 supports a documented destructive local reset rather than a complex deletion UI: disable the extension, stop the backend, clear its IndexedDB queue, remove the SQLite file and WAL/SHM sidecars, then restart with fresh sessions. Clearing the queue is required to prevent replay. Fine-grained deletion, exports, backups, and retention controls follow later; retained local records otherwise have no automatic expiry. No forensic-erasure guarantee or automatic deletion of independent backups.

## Local API and inspection

Bind only to `127.0.0.1`, never wildcard/LAN interfaces. Generate a random installation token stored in a user-restricted local config; paste it once into extension settings and the debug viewer. Require it in an Authorization header for every data/control endpoint. This is local process access control, not a user account system. Keep it out of URLs and logs. A process with full access to the same Windows account is outside this prototype's security boundary.

Validate Host against `127.0.0.1:43123`; reject unapproved browser Origins, allow the enrolled extension and same-origin viewer, and allow authenticated CLI requests without Origin. No wildcard CORS. Mutating requests require JSON and the header token. CORS alone is not protection. Serve the debug shell without activity data; keep its entered token in memory. Do not expose arbitrary SQL or file paths through the API. Port conflict fails visibly rather than falling back to a public bind.

Initial endpoints:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/events` | Bounded event batch; per-ID commit acknowledgements or validation errors |
| `GET /api/v1/status` | Backend/sensor last received times, storage health, counts, configured sampling thresholds; disconnected reason may be unknown |
| `GET /api/v1/events?from=&to=&kind=&cursor=&limit=` | Filtered observations with stable event IDs and cursor pagination |
| `GET /api/v1/intervals?from=&to=&lane=` | Computed foreground/unknown intervals, durations, evidence IDs, algorithm version, boundary quality |
| `GET /api/v1/summary?from=&to=&lane=` | App/host duration totals, observed switches, valid coverage and unknown time |

`from` inclusive / `to` exclusive are UTC milliseconds. Require bounded ranges (initially at most 7 days), cap event pages at 1,000, and return explicit range/size errors rather than silent truncation. Cursor ordering is `(observed_at_ms, id)`; queries are live, not snapshot-isolated across HTTP pages, so late arrivals may require refreshing a range. Return that limitation in API documentation. Escape all retained text in the debug table.

The debug viewer only needs date/time range, raw-event table, interval table, totals, and health. No design system or animation. It must be removable without changing collectors or storage.

## Basic reconstruction and truthful limits

Intervals are half-open `[start,end)`. Reconstruct each source/session separately in sequence order. A changed state closes the previous state at its capture time. Repeated samples confirm elapsed continuity under the assumption no transition was missed. Durations use monotonic time; wall-clock UTC places them on the timeline. Never compare monotonic clocks across processes or sessions.

If Windows confirmations are more than 5 seconds apart, or browser confirmations more than 75 seconds apart, end coverage at the last confirmed observation and leave the rest unknown. Sequence holes, session changes, unavailable/excluded state, lock, pause, suspend, and known loss also break continuity. Never fill a gap because states on either side match. A current open interval is counted only through its latest confirmation, not through wall-clock now. Navigation in a background tab does not confirm foreground state.

A wall-clock delta differing from monotonic delta by more than 2 seconds splits a clock segment. Preserve timestamps, flag uncertainty, and exclude ambiguous spans from time-of-day totals; never create negative durations. Timezone affects display, not elapsed duration. Use UTC API ranges; later local-day summaries must handle DST explicitly.

Minimum computations:

- Application and browser-host foreground durations, reported with valid coverage and unknown duration.
- Application switches: adjacent valid application states with different executable basenames and no gap. Domain switches similarly use different exact normalized hosts. Same-app window changes and same-host page changes are separate concepts.
- Foreground blocks: contiguous same-app or same-tab/retained-address state, broken by any gap. Title changes alone do not split a block.
- Navigation/search chronology and explicit opener evidence.

Windows and browser lanes remain separate in Phase 1. Never sum browser time on top of Chrome application time. Do not join Chrome window IDs to Windows HWND by guesswork. A future correlated lane may intersect Chrome-reported focus with Windows Chrome foreground while marking timing and profile ambiguity. Browser-only measurements are labeled as such, and do not prove the person attended to the page.

Later deterministic metrics, after real data validates coverage:

- Switching rate = observed switches / covered foreground hours; zero denominator is N/A.
- Entropy = `-sum(p * log2(p))` over foreground duration fractions by app or exact host; report keys and coverage, never a score of quality.
- Short visit/bounce = completed browser foreground episode under a declared threshold (proposed 10 seconds), excluding gap-ended or range-clipped episodes. No claim of distraction.
- Return = re-entry to a previously observed retained address after a different address, with continuity known; host returns reported separately. With paths disabled, page identity is unavailable and only host returns qualify. Stripped query/fragment values can still conflate pages.

## Categories and future galaxy

No category work is required to get the first data flowing. Next, add a local rule file matching executable basename or exact/dot-boundary-suffix host. Lower priority number wins; deterministic rule-ID tie break. Unmatched is Uncategorized. Suggested labels: Development, Reference, Communication, Music Creation, Entertainment. Each computed assignment must expose rule ID/version and `provenance: rule`; a category does not establish what happened inside an app. Never put it in observed events.

The future primary experience may be an infinitely zoomable hierarchical galaxy with clusters, semantic zoom, sidebars, animated transitions, time navigation, and large histories. Preserve its freedom without implementing it now:

- Stable observation IDs and timestamped relationships support detail links and trails.
- Versioned API DTOs expose data, not screen coordinates or a fixed tree hierarchy.
- Future aggregate endpoints can return time buckets, clusters, and counts; bounded detail endpoints retrieve individual observations on zoom/click. Do not ship the whole database to the browser.
- Add indexes/materialized computed aggregates when measured workloads require them. Layout state and coordinates belong to the frontend or a separate disposable cache.
- Multiple hierarchies may coexist (time, application, domain, rule category). Any semantic/model-generated clustering is INFERRED with provenance, not raw truth.
- React + TypeScript is a suitable future client, but renderer/animation/graph library selection waits for actual interaction experiments. No React setup is required now.

## Prototype reliability and recovery

The extension queues filtered events transactionally in IndexedDB, batches every few seconds/on activity, and retries with capped backoff. Worker starts/alarms resume delivery. Pending events keep original IDs. Cap the queue at 10 MiB; on full, stop new capture, show degraded status, preserve queued records, and start a new session after recovery. Do not silently evict history. A crash before queue append can lose events; exactly-once sensing is not promised.

Windows submits through the same validation/writer path in process, committing at least once per sample. Disk-full/storage error stops successful ingestion and shows failure; do not pretend to persist a health marker when disk writes fail. Backend shutdown/crash leaves the last confirmation as the end of known coverage. A failed HTTP response after a commit is harmless on identical retry.

Late events cause on-demand computations to be rerun; no derived cache invalidation machinery is needed yet. Missing sequences remain gaps until missing observations arrive. Corruption is a visible stop condition; never silently replace the database. Migrations use `user_version`, transactions, and a backup before destructive changes. No automatic recovery daemon, high availability, distributed ordering, or perfect power-loss guarantee.

## Implementation phases

### Phase 1: one working vertical slice on this computer

Deliver the .NET console backend, SQLite schema, 1-second Windows polling with session boundaries, Chrome extension with navigation/search adapters and filtered durable queue, authenticated loopback API, and primitive inspection table together. Default privacy controls must exist before collecting personal data. Include straightforward manual startup, extension-loading, pause, and reset instructions. Do not wait for category systems, galaxy work, packaging, or a tray app.

Acceptance on a short scripted real session:

1. Start backend, load extension, connect locally, and see current Windows/browser observations committed to SQLite.
2. Alternate Code/Chrome/another app, switch Chrome tabs, navigate, and make an explicitly enabled provider search. Compare sample timestamps, URLs-as-retained-fields, transitions, and durations in API/table results. Polling uncertainty is shown.
3. Confirm a background tab accrues no browser foreground duration, a disabled query field is absent, an excluded host/app is redacted, incognito metadata never arrives, and Windows never persists Chrome titles. Inspect queue, DB, and logs for these checks.
4. Stop/restart backend and extension; replay one batch twice; confirm no duplicates and no invented downtime. Lock/resume and an intentional observation gap produce unknown coverage, not inflated time.
5. Run small synthetic reconstruction tests for sequence holes, repeated states, sample gaps, and clock jumps. Build/typecheck both projects. No large test infrastructure is necessary.

Success means useful evidence is flowing and inspectable on this machine, with known collection limits. It does not mean complete capture of all short switches or a finished application.

### Phase 2: improve what the pilot shows is missing

Add foreground hooks if needed, clearer health/pause controls, optional sign-in startup, backup/restore and date-range deletion, category rules, and the later deterministic metrics. Measure disk growth before changing retention/sampling. Add computed caches only for demonstrated query latency.

### Phase 3: ambitious replaceable frontend

Build React/TypeScript experiments against the existing API; develop galaxy interactions and aggregation endpoints incrementally. Collection continues independently. No backend rewrite should be necessary just to replace the debug table.

## Complexity intentionally removed

WPF, native messaging bridge/registration, named pipes, installer/service/tray requirements, hooks before polling validation, whole-tab heartbeat snapshots, elaborate raw-event taxonomy, projection-run/evidence tables, category tables, distributed policy leases, deletion generations, global pause synchronization, and upfront analytics/graph/renderer infrastructure. Retained essentials: pre-storage privacy filtering, SQLite commit acknowledgements, deduplication, bounded queue, explicit gaps, basic local API protection, stable IDs, and separable computation.

## Next build instruction

“Implement Phase 1 of SPEC.md: the .NET 10 local backend and SQLite store, Windows foreground sampling, Chrome extension, authenticated loopback API, and minimal debug table. Keep privacy filtering before persistence, preserve unknown gaps, and verify the vertical slice on my Windows computer. Do not build the galaxy or add Phase 2 features yet.”
