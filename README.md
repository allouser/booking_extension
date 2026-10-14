# booking_extension — Allo Booking Exporter

A lightweight Chromium (Manifest V3) extension for Allo Cabs booking workspaces. It extracts structured booking rows from the bookings list and booking detail views and produces clean, tab-separated (TSV) output optimized for direct pasting into Excel.

## Project Overview

`booking_extension` bridges the Allo Cabs web app and spreadsheet reporting. It parses the bookings table DOM, enriches each row with user, driver, and vehicle details from the corresponding booking detail page, verifies data integrity per row via CRN matching, and copies the final dataset to the clipboard in an Excel-ready format.

Built for high-volume back-office workflows where bulk exports must stay in list order and each enriched row must provably belong to the correct booking.

## Key Capabilities

- **Single-row export** — Per-row copy control with automatic detail-page enrichment for user, driver, and vehicle.
- **Bulk export** — Multi-row collection from the visible bookings table with background detail fetching and guided detail navigation fallback.
- **Order-preserving bulk output** — Bulk datasets are ordered in reverse at clipboard time so pasting into Excel restores the exact on-screen list order.
- **CRN-verified enrichment** — Every enriched row is verified by comparing the list-row CRN against the detail-page CRN. Mismatched details are never applied; the row is re-verified via navigation.
- **Detail-page awareness** — Native support for `/bookingsView/{id}` detail views, including direct row copy and back-to-list restoration with pagination memory.
- **Excel-aligned schema** — Fixed 10-column TSV output: `DATE | TIME | CRN | FROM | TO | DRIVER | USER | VEHICLE | STATUS | NOTE`.
- **Configurable columns** — Column visibility controlled via popup field pills and synced to the content layer.
- **Non-intrusive UI** — Floating control panel, row-level copy buttons, progress toasts, and stop control for long bulk runs.

## Technology Stack

- **Platform:** Google Chrome / Microsoft Edge (Manifest V3)
- **Core:** Vanilla JavaScript (content script + service worker), CSS, HTML
- **APIs:** Chrome Storage, Tabs, Commands, Clipboard (`execCommand` + `navigator.clipboard` fallback), DOMParser + `fetch` for background detail resolution
- **Maps integration:** Page-world hook (`poi-page-hook.js`) for Google Maps place-name resolution

## Repository Structure

```
booking_extension/
├── manifest.json      — MV3 manifest (permissions, modular content scripts, commands)
├── background.js      — Command relay (Alt+S / Alt+A) and message handling
├── popup.html         — Extension popup shell
├── popup.js           — Power toggle, field-pill configuration, action triggers
├── content.css        — Injected row buttons, panels, toasts, snip overlay
├── poi-page-hook.js   — MAIN-world Google Maps hook for place-name copy
├── icons/             — Extension icons (16 / 48 / 128)
├── src/               — Feature-based modular architecture
│   ├── config/        — Configuration constants and runtime state
│   ├── utils/         — DOM, formatting, and clipboard helpers
│   ├── core/          — Page detection, table parsing, and mutation observation
│   ├── features/      — Floating panel, row actions, snip tool, detail extractor, bulk queue, maps POI
│   └── main.js        — Content script entry point and orchestrator
├── ARCHITECTURE.md    — Developer & AI agent architecture reference guide
└── README.md          — Project documentation
```

## Data Schema

| Col | Field | Source |
|-----|-------|--------|
| A | DATE | Bookings table date cell / detail trip date |
| B | TIME | Bookings table time cell |
| C | CRN | Bookings table CRN cell / detail `CRN Number` |
| D | FROM | Bookings table FROM cell / detail `From` |
| E | TO | Bookings table TO cell / detail `To` |
| F | DRIVER | Provider / Driver details (First + Last Name) |
| G | USER | User / Passenger details (First + Last Name) |
| H | VEHICLE | Service / Vehicle Type |
| I | STATUS | Status cell (`completed` / `cancelled` / `pending`) |
| J | NOTE | Reserved |

## Version

Current: **2.3.2** (see `manifest.json`)

