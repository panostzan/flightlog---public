# Semantic Galaxy prototype

`semantics.js` is a pure, rebuildable client-side projection, version `semantic-context-v2`. It writes neither observations nor inferred labels to SQLite. No external model, network service, embedding system, or dependency is involved. ChatGPT evidence is read through the existing local evidence API and remains immutable.

Known hosts support platform/function groupings. Captured query terms support conservative subject rules. Google and ChatGPT are sources, not interests: unidentified queries, conversation subjects, ambiguous matches and unknown hosts remain Unresolved. Platform labels do not assert which videos, messages or documents were consumed. Search-to-site adjacency never transfers a subject or proves a result click. Recognizable collector checks remain diagnostic evidence.

Each node has a stable rule-path ID, parent, depth (at most three), selected and lifetime timestamps, UTC active days, measured magnitude, source durations, provenance rules/basis and categorical confidence. `classificationEvidenceIds` identify subject support; `durationEvidenceIds` identify interval confirmations, which can include an ending observation about another subject. `evidenceIds` is their inspection union; `lifetimeEvidenceIds` preserves history. All IDs resolve through `evidenceById`. Identical duplicate IDs are collapsed; conflicting duplicates fail explicitly.

Magnitude is confirmed browser foreground milliseconds from the existing `sample-pairs-v1` reconstruction. Each interval is allocated once, using its starting foreground state, then rolled up to ancestors. Windows duration is not added. Unknown gaps, excluded intervals, background time, callback counts and classification confidence add no magnitude. Direct broad-topic time remains `unallocatedMs` when no child is justified. The model reconciles exactly with the browser summary API.

The established cluster material, hover, camera and dive remain in place. Radius uses a small discoverability floor, then area proportional to duration relative to the largest sibling: `sqrt(14² + (84² - 14²) * relativeDuration)`. Light prominence also follows measured duration. Zero-duration evidence can therefore remain visible but does not gain measured attention. Artistic position/depth do not imply similarity. Stable sibling layout slots are independent of measured sorting. There are currently no inferred cross-topic edges or trails. Semantic leaves open the existing evidence HUD instead of generating raw-record nodes.

All time is the default. `loadGalaxy(token, progress, {from,to})` also supports selected windows without introducing timeline controls. A lifetime catalog preserves node identities; previously observed inactive worlds become dormant and future worlds are hidden. This supplies a foundation, not a complete time-travel UI. Requests respect the existing seven-day API bounds, with pagination and confirming-sample padding. The loader deduplicates overlapping event windows and permits up to 1,000,000 observations or intervals before failing explicitly rather than showing partial history. Reads are a live snapshot, not an atomic database transaction; refresh includes late arrivals. Larger histories will eventually benefit from a derived cache.

Missing historical page titles/paths, conversation content, cross-tab origins and outage activity cannot be recovered by classification. Rule coverage is deliberately incomplete. Broad host rules identify platform function more confidently than subject, and keyword matches remain interpretations of captured terms, not proof of intent.

Validation from `extension`: `npm.cmd test`, `node tests/semantic-live.mjs`, `node tests/galaxy-live.mjs`, `node tests/galaxy-visual.mjs`, `node tests/launcher.mjs`. Live checks read local history and write private reports/screenshots under `.test-data`; they do not write observations. The semantic live report includes the actual tree, source-duration breakdown, provenance and summary reconciliation.

The production projection loads `/api/v1/chatgpt/evidence` and builds a
deterministic prompt-context hierarchy. Conversation IDs, observed timestamps,
repeated terms and nearby agreeing prompts support short follow-up inheritance.
Prompt evidence never contributes milliseconds by itself. ChatGPT foreground
milliseconds are assigned to a subject only when at least two nearby prompts
agree on that subject; otherwise the interval remains under Unresolved → AI
conversations. Subtopic duration is retained only when the nearby prompt
sequence agrees at that deeper path. Prompt and interval IDs remain available
through the evidence inspector.
