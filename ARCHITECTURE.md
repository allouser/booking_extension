# Architecture & Module Guide

This codebase has been refactored into a **Feature-Based Modular Architecture**. No single file exceeds ~200 lines. Every module has a distinct single responsibility.

---

## 📁 Directory Structure & Responsibilities

```
Booking extension/
├── manifest.json              # Extension manifest (defines content scripts execution pipeline)
├── background.js              # Service worker handling Chrome keyboard commands
├── popup.html / popup.js      # User options popup (field toggles & extension power)
├── content.css                # Visual styles for panels, buttons, toasts, and overlays
├── poi-page-hook.js           # Page-world script injected into Google Maps
├── test-demo.html             # Standalone test table
└── src/
    ├── config/
    │   ├── constants.js       # Default fields schema, sessionStorage & chrome.storage keys
    │   └── state.js           # Runtime state container (active flags, tokens, memory)
    ├── utils/
    │   ├── dom.js             # Toast alerts & stop button injection
    │   ├── formatters.js      # Address cleaning, date normalization, vehicle & name sanitation
    │   └── clipboard.js       # TSV generator and clipboard copy mechanisms
    ├── core/
    │   ├── page-detector.js   # URL & DOM fingerprinting to detect booking workspaces
    │   ├── table-parser.js    # Multi-theme table parsing & header mapping
    │   └── observer.js        # Debounced MutationObserver with filter for internal DOM changes
    ├── features/
    │   ├── floating-panel/
    │   │   └── panel.js       # Vertical floating sidebar widget
    │   ├── row-actions/
    │   │   ├── copy-button.js # In-row "📋 Copy" button & single-row instant enrichment
    │   │   └── checkboxes.js  # Row checkbox injection with event-propagation protection
    │   ├── snip-tool/
    │   │   └── snip.js        # Alt+S drag-to-select table area tool
    │   ├── detail-extractor/
    │   │   ├── live-extract.js# Live extraction from /bookingsView detail views
    │   │   ├── bg-fetch.js    # Background fetch + DOMParser detail resolver
    │   │   └── detail-banner.js# On-page detail copy banner
    │   ├── bulk-queue/
    │   │   ├── cancel.js      # Cancel token, stop button, and abort memory
    │   │   ├── pagination.js  # Pagination memory & restoration across page navigations
    │   │   └── queue.js       # Multi-row batch queue state machine
    │   └── maps-poi/
    │       └── poi-detector.js# Google Maps POI detection & 1-click place-name chip
    └── main.js                # Extension orchestrator, storage sync, and event routing
```

---

## 🧠 Namespace Convention

Modules attach to the shared global `window.Allo` namespace:

- `Allo.Config` — Constants & storage keys
- `Allo.State` — Active flags, run tokens, and snip state
- `Allo.Utils.DOM` — `showToast`, `showProgressToast`, `hideProgressToast`
- `Allo.Utils.Formatters` — Text/date cleaning utilities
- `Allo.Utils.Clipboard` — TSV generation and clipboard copying
- `Allo.Core.PageDetector` — URL & page validation
- `Allo.Core.TableParser` — Row and cell extraction
- `Allo.Core.Observer` — DOM mutation observation
- `Allo.Features.FloatingPanel` — Vertical floating panel control
- `Allo.Features.RowActions` — `CopyButton` and `Checkboxes`
- `Allo.Features.SnipTool` — Area drag selection
- `Allo.Features.DetailExtractor` — `Live`, `BgFetch`, and `Banner`
- `Allo.Features.BulkQueue` — `Queue`, `Cancel`, and `Pagination`
- `Allo.Features.MapsPoi` — Maps place-name chip and hook

---

## ⚡ Key Rules for Future Modifications

1. **Keep files small**: Do not aggregate multiple features into a single file. Keep UI components separate from extraction logic.
2. **Prevent Event Bubbling**: In-row buttons and checkboxes must always call `e.stopPropagation()` and `e.preventDefault()` to prevent triggering the host website's row click handlers.
3. **No Build Step Required**: Scripts are loaded sequentially by Chrome via `manifest.json`. Any changes take effect immediately upon reloading in `chrome://extensions`.

