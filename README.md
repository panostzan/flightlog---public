# Flightlog

**Record the trail. Don't invent the story.**

Flightlog is a personal, local-first record of Windows foreground applications and Chrome activity, built to help reconstruct where attention went over time. Foreground time is evidence about software state, not proof of attention or useful work.

- **OBSERVED:** sensor reports.
- **COMPUTED:** reproducible durations and transitions.
- **INFERRED:** probabilistic interpretation; outside V1.

The current prototype includes a .NET 10 console backend, Chrome extension, local SQLite database, and loopback API with a Galaxy explorer and inspection dashboard. Collection stays independent of presentation, allowing a future interactive galaxy frontend without rewriting collectors.

No cloud service, accounts, syncing, productivity scores, screenshots, clipboard capture, or keystroke logging. The Chrome extension does capture submitted ChatGPT user prompts from rendered pages after a submit gesture, including message/conversation identifiers. Prompts, retained titles, and optional URL paths and search queries are sensitive local data. Pause the extension to stop browser and ChatGPT capture.

**Status: implemented prototype, September 8, 2026.** Windows collection, Chrome capture, privacy filtering, durable browser queuing, SQLite storage, interval computation, and the inspection page are saved in this workspace. See [SPEC.md](SPEC.md) for the design target; it is not a claim that every acceptance criterion has been verified.

**After the first-time setup below, double-click `Flightlog.cmd` in this folder.** It starts the backend if needed and opens the Galaxy already connected. Leave an existing backend console open if you started it manually. Chrome website capture still requires the extension setup below.

Opening the web address in an unpaired browser now offers **Open Flightlog** instead of requesting a token. This opens the local launcher through `flightlog://open`, which connects your default browser automatically. Windows registers this app link when you run `Flightlog.cmd` or install login startup. The browser may ask permission to open the app. Already-open Flightlog tabs in that browser connect too.

**Reliability:** install automatic startup with `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\install-startup.ps1`. The backend then starts hidden at this user's login, including after reboot; Chrome must still be open with its extension enabled. Double-click `Flightlog Health.cmd` to check fresh Windows and Chrome recording independently. Persistent diagnostic logs are stored alongside the database. See [RELIABILITY.md](RELIABILITY.md) for exact startup/retry behavior, log locations, removal, and verification after reboot.

After a successful connection, the Galaxy and inspection page remember the local token in this browser profile's local storage, including across new tabs and browser restarts. Refreshing an already connected older tab migrates its connection automatically. Disconnect clears the saved connection across open Flightlog tabs; it does not stop collection. Clearing browser site data or using a different browser profile requires connecting again.

The semantic Galaxy is at http://127.0.0.1:43123/galaxy/. Open it through `Flightlog.cmd` for automatic local connection. Drag to pan, scroll to zoom, and click a world to enter its supported topics or platforms. A semantic leaf opens its raw evidence in the existing bottom HUD. Emerge or use breadcrumbs to return. The inspection dashboard is at http://127.0.0.1:43123/.

All time is the default. Local deterministic rules derive subjects from captured queries and platform/function groups from known hosts. Uncertain subjects remain Unresolved. Cluster magnitude follows confirmed browser foreground duration, never callback counts or semantic importance. Unknown collection gaps contribute no activity. Refresh rebuilds the live snapshot; raw history is unchanged. No external AI service is used. See [the semantic model](backend/wwwroot/galaxy/SEMANTICS.md) for provenance, time windows, limitations and checks.

The replaceable client lives in `backend/wwwroot/galaxy`: `data.js` adapts API observations into an evidence-backed hierarchy; `space.js` owns Canvas rendering and camera motion; `app.js` owns navigation and the HTML HUD. There are no additional runtime dependencies or collector changes. To run the read-only live UI checks with the backend running and Playwright Chromium installed, run `node tests/galaxy-live.mjs` from `extension`. This reads the local token without printing it and saves screenshots under `.test-data/galaxy-review` (screenshots can contain recorded activity).

The inspection dashboard shows Windows and Chrome recording status, selected-period foreground and unknown time, and expandable evidence for each interval. Its technical details section retains the raw API health and summary responses. Both views use responsive dark layouts; reload an open tab after a frontend update.

Prerequisites: Windows, PowerShell, Chrome, Node.js with npm, and the .NET SDK specified in [global.json](global.json) (10.0.400 with latest-patch roll-forward). Local SDKs, dependencies, and build output are not included.

Manual setup and development commands:

1. Run `.\scripts\check.ps1` to build the backend and extension and run their unit checks. The script uses the workspace SDK in `.tools\dotnet` when present, otherwise `dotnet`. Extension dependencies must be installed with `npm install --no-audit --no-fund` from `extension` if absent.
2. Run `.\scripts\start.ps1` and keep the console open, or use `.\scripts\start.ps1 -Background` for a hidden background process. Windows collection begins on startup. Use `-NoCollector` to inspect without Windows collection.
3. Run `Flightlog.cmd` to register the app link and open the connected Galaxy. The inspection dashboard is at http://127.0.0.1:43123/ in the same browser profile.
4. In Chrome, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select this workspace's `extension\dist` folder. Open the extension, enter the `token` from `%LOCALAPPDATA%\Flightlog\settings.local.json`, and choose Save and connect. Only one regular Chrome profile can enroll.
5. Use `.\scripts\stop.ps1` to stop the backend. Pause browser capture in the extension separately; otherwise it continues buffering observations.

Data and settings default to `%LOCALAPPDATA%\Flightlog`; `FLIGHTLOG_DATA_DIR` overrides this location. Browser titles are enabled by default; Windows titles, URL paths, and search queries are disabled by default. The inspection page shows raw observations and computed intervals; the Galaxy explores derived interests and platforms with raw evidence in its HUD.

For the browser/API/SQLite integration suite, run `npm run test:integration` from `extension` after building the backend. It requires Playwright Chromium installed in `.tools\browsers` and port 43123 free. It uses an isolated test profile and database under `.test-data` and briefly runs the Windows collector.

This public source copy excludes local settings and tokens, databases, activity exports, screenshots, browser profiles, diagnostic captures, and generated build/dependency files. Keep those files private, including the runtime `capture-settings-history.json`. Tests already use synthetic fixtures; no personal data is needed to build or start the app. Settings and a random local token are generated on first launch; no `.env` file is required. Set `FLIGHTLOG_DATA_DIR` in the process environment if you need a different data directory. Live browser checks can read your existing local activity and produce sensitive captures under `.test-data/`.
