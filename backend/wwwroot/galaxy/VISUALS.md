This static/hover pass follows the supplied Flightlog node-design sheet, especially its neural nucleus, idle/hover panels and floating instrumentation.

`matter.js` contains visual material, not semantic data. Every labelled cluster still belongs to an existing node from `data.js`. A major cluster has 28–40 seeded luminous anchors, central warm-white/amber concentration, occasional cool peripheral anchors, sparse curved internal filaments, anisotropic haze, faint veils and decorative dust. Internal particles and filaments do not stand for recorded events or relationships. The real child and evidence collections are untouched.

The layout uses irregular islands, different prominence and a separate portrait composition. Position/depth are artistic presentation, not similarity, duration or inferred topics. Low-priority overlapping labels are hidden until hover/focus; nodes remain keyboard accessible. External filaments use only the existing evidence-backed edges.

Depth comes from three separately drawn star layers, distant dust strands, softer small structures, crisp bright nuclei and a foreground star pass over the clusters. Pointer and pan parallax differ by layer. Idle displacement is subpixel and slow; reduced motion disables drifting and pointer parallax.

Hover/focus blends an additional cached material layer into the nucleus, resolves faint particles/filaments, brightens relevant real edges and fades in four thin targeting corners. Labels acquire brackets, with no native tooltip or hover scaling. Zoom reveals more of the same material. Existing enter/return transition timing and navigation code remain intact; no new dive sequence is implemented.

The floating HUD and header use dark translucent panels, mint accents, readable local system typography, and explicit button surfaces. The summary separates the selected topic from its confirmed duration and observed days. The default camera leaves room for the larger evidence dock. Narrow screens retain the inspection link and collapse secondary controls. No remote images, fonts or assets are required. Materials are drawn once per node layout into local canvases and composited during frames.

Limitations: this is procedural Canvas 2D depth, not volumetric rendering; the reference's painted nebular intricacy is approximated with layers. At extreme zoom, cached material softens. Labels now identify evidence-backed semantic worlds, and dense/long labels may resolve only on hover. Decorative points are not child identities for a future dive.

Read-only checks (from `extension`, with the existing backend running): `node tests/galaxy-live.mjs` and `node tests/galaxy-visual.mjs`. The latter saves real-data idle/hover/mobile screenshots in `.test-data/galaxy-visual`; those screenshots can contain personal activity. Neither suite writes observations or changes collector settings.

The semantic prototype preserves this visual system. Cluster radius and prominence now bind to confirmed browser foreground duration; stable rule IDs seed the existing material. See `SEMANTICS.md` for the measured-area mapping and discoverability floor.
