/**
 * Allo Cabs to Excel Exporter - Content Script v2.3.1
 * 
 * Includes:
 * 1. Single Row Copy Button: "Copy to Excel" injected on each row / action column
 * 2. Click-to-Detail Workflow: Automatically clicks row -> opens detail page -> copies exact First + Last name -> navigates back!
 * 3. In-Detail Page Copy Banner: If you are already on a /bookingsView page, 1-click copies the full details.
 * 4. Multi-Row Checkbox / Snip mode.
 */

(function () {
  // Terminal-safe guard: content.js is a BROWSER content script.
  // `node content.js` has no window/document \u2014 exit quietly instead of
  // throwing "ReferenceError: window is not defined".
  // (Use `node --check content.js` for syntax validation.)
  if (typeof window === "undefined" || typeof document === "undefined") {
    try {
      if (typeof process !== "undefined" && process.versions && process.versions.node) {
        console.log("[Allo Exporter] content.js is a browser content script - skipping execution under Node. Use `node --check content.js` for syntax validation.");
      }
    } catch (e) {}
    return;
  }
  // Bulk-cancel memory must exist before ANY listener/boot code below uses it
  let bulkCancelMemory = false;
  try {
    if (sessionStorage.getItem("ALLO_BULK_CANCEL") === "1") bulkCancelMemory = true;
  } catch (e) {}
  // Run token: every new bulk run bumps this. Any timer/poll from an older run
  // (or after Stop) sees a stale token and aborts instead of clicking/navigating.
  let bulkRunToken = 0;
  try {
    const t = parseInt(sessionStorage.getItem("ALLO_BULK_TOKEN") || "0", 10);
    if (!isNaN(t) && t > 0) bulkRunToken = t;
  } catch (e) {}
  let isExtensionActive = true;
  let isSnipping = false;
  let startX = 0;
  let startY = 0;
  let overlayEl = null;
  let snipBoxEl = null;

  let enabledFields = {
    date: true,
    time: true,
    crn: true,
    from: true,
    to: true,
    driver: true,
    user: true,
    vehicle: true,
    status: true,
    note: true,
    userMobile: true,
    driverMobile: true
  };

  let copySettings = {
    removeExtraSpaces: false
  };

  // Retrieve initial enabled status & enabledFields
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({ extensionEnabled: true, enabledFields: enabledFields, copySettings: copySettings }, (data) => {
      isExtensionActive = data.extensionEnabled;
      if (data.enabledFields) enabledFields = data.enabledFields;
      if (data.copySettings) copySettings = data.copySettings;
      syncVisibility();
      if (isBookingPage()) {
        initFloatingControl();
        injectRowCopyButtons();
      }
    });
  }

  // Listen to chrome.storage changes dynamically
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.enabledFields && changes.enabledFields.newValue) {
        enabledFields = changes.enabledFields.newValue;
      }
      if (changes.copySettings && changes.copySettings.newValue) {
        copySettings = changes.copySettings.newValue;
      }
      if (changes.extensionEnabled !== undefined) {
        isExtensionActive = changes.extensionEnabled.newValue;
        syncVisibility();
      }
      // Instant cross-document cancel: fires even mid-navigation
      try {
        if (changes.alloBulkCancel && changes.alloBulkCancel.newValue) {
          bulkCancelMemory = true;
          try { sessionStorage.setItem("ALLO_BULK_CANCEL", "1"); } catch (e) {}
          handleBulkStopped(true);
        }
      } catch (e) {}
    });
  }

  // Listen for runtime messages (copy settings from popup)
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "SET_COPY_SETTINGS" && request.copySettings) {
        copySettings = request.copySettings;
      }
    });
  }

  /**
   * Helper function to detect if the current page or active tab is booking-related.
   * Matches /bookings, /bookingsView, /ride-later-bookings, /statement, or active Booking sidebar tabs.
   * Excludes /provider/list, /Users, /dashboard, etc.
   */
  function isBookingPage() {
    const href = window.location.href.toLowerCase();
    const path = window.location.pathname.toLowerCase();

    // 1. Explicit NON-booking paths FIRST (Providers, Users, Dashboard, etc.)
    //    Must win over any fallback text match \u2014 e.g. /provider/view/4 also
    //    contains tabs like "Ride History" that could confuse heuristics.
    if (
      path.includes("/provider") ||
      path.includes("/user") ||
      path.includes("/dashboard") ||
      path.includes("/setting") ||
      path.includes("/vehicle") ||
      path.includes("/driver/") ||
      path.includes("/admin")
    ) {
      return false;
    }

    // 2. Explicit Booking path matches
    if (
      path.includes("/booking") ||
      path.includes("/ride-later") ||
      path.includes("/ridelater") ||
      path.includes("/statement")
    ) {
      return true;
    }

    // 3. Booking-table fingerprint: only treat as booking page if the DOM has
    //    a booking-like table (CRN / Booking + Pickup/From + Drop/To + Status).
    //    This stops Provider Detail / Vehicle / Document tables getting Copy buttons.
    function hasBookingTableFingerprint() {
      try {
        const ths = Array.from(document.querySelectorAll("thead th, table thead td")).map(
          el => ((el.innerText || el.textContent) || "").toLowerCase()
        );
        if (!ths.length) return false;
        const hasCrn = ths.some(t => /crn|booking.?id|ref/.test(t));
        const hasRoute = ths.some(t => /pick.?up|from|source/.test(t)) && ths.some(t => /drop|\bto\b|destination/.test(t));
        const hasStatus = ths.some(t => /status/.test(t));
        if (hasCrn && hasRoute && hasStatus) return true;
        // fallback: any row containing 179 + CRN pattern
        const bodyText = (document.body.innerText || "").slice(0, 20000);
        return /crn[\s\S]{0,40}179\d{8,}/i.test(bodyText);
      } catch (e) { return false; }
    }

    // 3. Fallback check for URL query string or hash (same path guard applies)
    if (
      href.includes("booking") ||
      href.includes("ride-later") ||
      href.includes("statement")
    ) {
      return true;
    }

    // 4. Check active DOM navigation item (e.g. sidebar menu in Allo Cabs)
    //    Only trust this if a booking table actually exists (Provider Detail also
    //    highlights sidebar items / contains "Ride History" tabs).
    const activeNav = document.querySelector(
      ".sidebar .active, .nav-item.active, .nav-link.active, a.active, li.active > a, [class*='active']"
    );
    if (activeNav) {
      const navText = (activeNav.innerText || "").toLowerCase();
      if (navText.includes("provider") || navText.includes("user") || navText.includes("dashboard")) {
        return false;
      }
      if ((navText.includes("booking") || navText.includes("ride later")) && hasBookingTableFingerprint()) return true;
    }

    // 5. Check main page headings \u2014 same fingerprint guard
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, .page-title, .title"));
    for (const h of headings) {
      const txt = (h.innerText || "").toLowerCase();
      if (txt.includes("provider") || txt.includes("user") || txt.includes("dashboard")) return false;
    }
    for (const h of headings) {
      const txt = (h.innerText || "").toLowerCase();
      if ((txt.includes("booking") || txt.includes("ride later")) && hasBookingTableFingerprint()) return true;
    }

    return false;
  }

  // Listen for messages from popup or background script
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "SET_ENABLED") {
        isExtensionActive = request.enabled;
        syncVisibility();
        if (isBookingPage()) {
          initFloatingControl();
          injectRowCopyButtons();
        }
        sendResponse({ status: "updated", enabled: isExtensionActive });
        return true;
      }
      if (request.action === "SET_ENABLED_FIELDS") {
        enabledFields = request.enabledFields;
        sendResponse({ status: "updated_fields", enabledFields });
        return true;
      }
      if (!isExtensionActive) { sendResponse({ status: "extension_disabled" }); return true; }
      if (!isBookingPage()) {
        showToast("\u26a0\ufe0f Booking Pages Only", "This extension feature is only available on Bookings pages.");
        sendResponse({ status: "not_booking_page" });
        return true;
      }

      if (request.action === "START_SNIP") { startSnipMode(); sendResponse({ status: "started" }); }
      else if (request.action === "COPY_ALL") { copyAllVisibleBookings(); sendResponse({ status: "copied_all" }); }
      else if (request.action === "TOGGLE_CHECKBOXES") { toggleRowCheckboxes(); sendResponse({ status: "toggled" }); }
      else if (request.action === "STOP_BULK") { requestBulkCancel(); handleBulkStopped(true); sendResponse({ status: "stopped" }); }
      return true;
    });
  }

  function syncVisibility() {
    const onBooking = isBookingPage();
    const visible = isExtensionActive && onBooking;

    const panel = document.getElementById("allo-floating-panel");
    if (panel) panel.style.display = visible ? "flex" : "none";
    const detailBar = document.getElementById("allo-detail-bar");
    if (detailBar) detailBar.style.display = visible ? "flex" : "none";
    if (!onBooking) {
      // Hard cleanup on non-booking tabs (Provider Detail, Users, Dashboard...):
      // remove any row copy buttons / checkboxes injected earlier.
      try {
        document.querySelectorAll(".allo-row-copy-btn").forEach(btn => btn.remove());
        document.querySelectorAll(".allo-row-checkbox-wrap").forEach(w => w.remove());
        document.querySelectorAll(".allo-row-selected").forEach(r => r.classList.remove("allo-row-selected"));
      } catch (e) {}
      return;
    }
    const buttons = document.querySelectorAll(".allo-row-copy-btn");
    buttons.forEach(btn => btn.style.display = visible ? "inline-flex" : "none");
    const checkboxes = document.querySelectorAll(".allo-row-checkbox-wrap");
    checkboxes.forEach(cb => cb.style.display = (visible && typeof checkboxesActive !== "undefined" && checkboxesActive) ? "inline-flex" : "none");
  }

  // Keyboard shortcuts (active ONLY on booking pages)
  window.addEventListener("keydown", (e) => {
    if (!isExtensionActive || !isBookingPage()) return;
    if (e.key === "Escape" && (sessionStorage.getItem("ALLO_BULK_QUEUE") || sessionStorage.getItem("ALLO_PENDING_COPY"))) {
      e.preventDefault(); requestBulkCancel(); handleBulkStopped(true); return;
    }
    if (e.altKey && (e.key === "s" || e.key === "S")) { e.preventDefault(); startSnipMode(); }
    else if (e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); copyAllVisibleBookings(); }
  });

  // ============================================================
  //  DETAIL PAGE AUTO-EXTRACTION & RETURN (If user or app is on bookingsView)
  // ============================================================
  if (isBookingPage()) {
    checkDetailPageAutoCopy();
    // If we just came back from a detail page, re-apply the page the user was on
    setTimeout(() => { try { maybeRestorePageOnListLoad(); } catch (e) {} }, 400);
  }

  // Monitor SPA route changes (Angular pushState / replaceState + popstate + polling)
  let lastObservedUrl = window.location.href;
  function handleUrlChange() {
    if (window.location.href !== lastObservedUrl) {
      lastObservedUrl = window.location.href;
      syncVisibility();
      if (isBookingPage()) {
        checkDetailPageAutoCopy();
        syncDetailPageBanner();
        initFloatingControl();
        injectRowCopyButtons();
        setTimeout(() => { try { maybeRestorePageOnListLoad(); } catch (e) {} }, 400);
      } else {
        // Leaving Bookings (e.g. /provider/view/4 without full reload):
        // ensure no Copy buttons / panels linger.
        syncVisibility();
      }
    } else {
      // Same-URL DOM swaps (Angular tab switch Provider \u2194 Ride History):
      // keep non-booking tabs clean without full reload.
      if (!isBookingPage()) syncVisibility();
    }
  }

  // Intercept history navigation methods used by Angular router
  try {
    const origPushState = history.pushState;
    history.pushState = function (...args) {
      const res = origPushState.apply(this, args);
      setTimeout(handleUrlChange, 0);
      return res;
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const res = origReplaceState.apply(this, args);
      setTimeout(handleUrlChange, 0);
      return res;
    };
  } catch (e) {}

  window.addEventListener("popstate", () => setTimeout(handleUrlChange, 0));
  window.addEventListener("hashchange", () => setTimeout(handleUrlChange, 0));

  // High-frequency polling fallback (every 50ms) to detect any URL change immediately
  setInterval(handleUrlChange, 50);

  // ---- Google Maps POI Single-Click Copy Button (NO auto-copy) ----
  let _lastPoiName = "";

  function processMapInfoWindows() {
    if (!isExtensionActive) return;
    var topHref = "";
    try { topHref = window.top.location.href; } catch (e) { topHref = window.location.href; }
    var selfHref = "";
    try { selfHref = window.location.href; } catch (e) { selfHref = ""; }
    // Run on: top-level /bookingsView detail page (list page excluded to
    // avoid row-click toast), OR inside the embedded Google Maps iframe
    // whose top page is the detail page.
    var onDetailTop = /bookingsView/i.test(topHref) || /bookingsView/i.test(selfHref);
    if (!onDetailTop) {
      // Inside google maps embed (cross-origin: topHref falls back to self)?
      var looksLikeMap = false;
      try { looksLikeMap = !!document.querySelector(".gm-style"); } catch (e) {}
      if (!looksLikeMap) return;
    }

    // Strategy 1: ONLY real Google Maps link anchors \u2014 never generic
    // a[target="_blank"] (that was hijacking normal clicks / cards).
    // EXCLUDE map footer chrome: "Open this area in Google Maps" link,
    // Terms / Map Data / keyboard-shortcut controls live in
    // .gmnoprint / .gm-style-cc / .gmnoscreen \u2014 those are NOT popups.
    const mapLinks = Array.from(document.querySelectorAll('a[href*="maps.google"], a[href*="google.com/maps"]'))
      .filter(function (a) {
        try {
          var lbl = ((a.getAttribute("aria-label") || "") + " " + (a.getAttribute("title") || "")).toLowerCase();
          if (lbl.indexOf("open this area") !== -1) return false;
          if (a.closest(".gmnoprint, .gm-style-cc, .gmnoscreen, .gm-bundled-control, gmp-internal-camera-control")) return false;
        } catch (e) {}
        return true;
      });

    // Strategy 2: Maps popup containers \u2014 search WHOLE document (not just
    // .gm-style prefix; new vector bubbles sometimes sit outside it).
    // Covers old .gm-style-iw-c AND new POI bubble like
    // "Pattanichchippuliyankulam, Vavuniya, Sri Lanka".
    // NOTE: plain div[role="dialog"] is too broad (matches Angular dialogs),
    // so non-map dialogs are filtered out below.
    const infoWindows = Array.from(document.querySelectorAll(
      '.gm-style-iw-c, .gm-style-iw-d, .gm-style-iw, .gm-style-iw-t, ' +
      '.gm-style div[role="dialog"], .gm-style div[role="alertdialog"], ' +
      'div[role="dialog"], div[role="alertdialog"]'
    )).filter(function (el) {
      try {
        if (el.closest(".gm-style, .gm-style-iw-c, .gm-style-iw")) return true;
        if (el.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]')) return true;
        if (el.className && /gm-|iw|poi|place/i.test(el.className.toString())) return true;
        return false;
      } catch (e) { return false; }
    });

    // Combine candidate popup card elements
    // Plus: fallback \u2014 any small white bubble card containing the open-in-new
    // icon (your screenshot: title + address + \u2197 blue icon on the right).
    const cards = [];

    mapLinks.forEach(link => {
      // Find top-level popup card container (go up 2 to 5 parent levels or use closest card/popup class)
      let card = link.closest(".gm-style-iw-c, .gm-style-iw, [class*='iw'], [class*='popup'], [class*='card']") ||
                 link.parentElement?.parentElement?.parentElement ||
                 link.parentElement?.parentElement ||
                 link.parentElement;
      if (card && !cards.includes(card)) cards.push(card);
    });

    infoWindows.forEach(iw => {
      if (!cards.includes(iw)) cards.push(iw);
    });

    // Fallback: small bubble cards with an open-in-new icon or short
    // title + locality text (your Pattanichchippuliyankulam screenshot).
    try {
      var allDivs = Array.from(document.querySelectorAll("div"));
      for (var di = 0; di < allDivs.length; di++) {
        var d = allDivs[di];
        if (cards.includes(d)) continue;
        var dt = (d.innerText || "").trim();
        if (!dt || dt.length > 200 || dt.length < 3) continue;
        var lines = dt.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        if (lines.length < 1 || lines.length > 4) continue;
        // Looks like: Title + ", Vavuniya, Sri Lanka" / plus-code, with an icon button/link
        var hasIcon = !!(d.querySelector('button, a[href*="maps"], a[href*="google.com/maps"], [aria-label*="map" i]'));
        if (!hasIcon) continue;
        if (!/sri lanka|vavuniya|\+[A-Z0-9]{2,}/i.test(dt)) continue;
        // Skip huge layout containers \u2014 want the small bubble only
        try {
          var r = d.getBoundingClientRect();
          if (r.width > 420 || r.height > 220 || r.width < 60) continue;
        } catch (e) {}
        cards.push(d);
        if (cards.length > 25) break;
      }
    } catch (e) {}

    cards.forEach(card => {
      if (!card) return;

      // ---- Extract place title robustly ----
      // New vector POI bubble has NO h1-h4, just divs/spans:
      //   <div>Pattanichchippuliyankulam</div><div>...Vavuniya, Sri Lanka</div>
      // + an icon button (open-in-maps). So find title by text match too.
      let titleEl = null;
      try {
        titleEl = card.querySelector("h1, h2, h3, h4");
        if (titleEl && (titleEl.innerText || "").length > 80) titleEl = null;
      } catch (e) { titleEl = null; }

      // Extract text content from the card
      const textLines = (card.innerText || "")
        .split("\n")
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/^(map|satellite|zoom|close|terms|google|keyboard shortcuts|map data|terms of use|report a map error|\+|\-)$/i.test(s) && !/map data \u00a9/i.test(s) && !/^terms$/i.test(s));

      if (textLines.length === 0 && !titleEl) return;

      // Fallback for new vector bubble: no h1-h4 \u2014 first short line is title.
      // Prefer a real element matching that text so button can sit inline.
      if (!titleEl && textLines.length) {
        try {
          var firstLine = textLines[0];
          var cands = Array.from(card.querySelectorAll("div, span, font"));
          for (var i = 0; i < cands.length; i++) {
            var ct = ((cands[i].innerText || cands[i].textContent) || "").trim().split("\n")[0].trim();
            if (ct && ct === firstLine && ct.length <= 80 && !cands[i].querySelector("div, span, h1, h2, h3, button, a")) {
              titleEl = cands[i];
              break;
            }
          }
        } catch (e) { /* keep titleEl null */ }
      }

      // First non-empty line is the place title (or titleEl text)
      let cleanName = titleEl ? (titleEl.innerText || "").trim().split("\n")[0].trim() : textLines[0];
      if (!cleanName && textLines.length) cleanName = textLines[0];
      if (cleanName.includes("|")) {
        cleanName = cleanName.split("|")[0].trim();
      }

      if (!cleanName || cleanName.length < 2) return;

      // Skip OUR OWN bubble (page-hook InfoWindow content) \u2014 it already
      // has its Copy button. Processing it again creates the double
      // "Copy / Copy place name" row from your screenshot.
      try {
        if (card.querySelector && card.querySelector("[data-allo-bubble], [data-allo-copy]")) return;
        if (card.hasAttribute && (card.hasAttribute("data-allo-bubble") || card.hasAttribute("data-allo-copy"))) return;
      } catch (e) {}

      // REJECT map footer / chrome text \u2014 never a place name.
      // Your bug: "Map data \u00a92026" link text became the "place" and a
      // "\ud83d\udccd Place | Map data \u00a92026 | Copy" chip appeared on every reload.
      if (/map data \u00a9|open this area|keyboard shortcuts|report a map error|terms of use|^terms$/i.test(cleanName)) return;
      if (/map data \u00a9|open this area|keyboard shortcuts|report a map error/i.test((card.innerText || ""))) {
        var looksLikeRealBubble = false;
        try {
          looksLikeRealBubble = !!(
            card.querySelector(".gm-style-iw-c, .gm-style-iw, h1, h2, h3") ||
            /sri lanka|vavuniya|\+[A-Z0-9]{2,}/i.test(card.innerText || "")
          );
        } catch (e) {}
        if (!looksLikeRealBubble) return;
      }

      // If button exists: refresh name (popup reuses DOM for next place)
      const existingBtn = card.querySelector(".allo-poi-copy-btn");
      if (existingBtn) {
        existingBtn.dataset.placename = cleanName;
        existingBtn.title = 'Copy "' + cleanName + '"';
        return;
      }

      // Create SMALL inline copy icon (fits inside white bubble)
      const copyBtn = document.createElement("button");
      copyBtn.className = "allo-poi-copy-btn";
      copyBtn.type = "button";
      copyBtn.dataset.placename = cleanName;
      copyBtn.title = 'Copy "' + cleanName + '"';
      copyBtn.textContent = "\u29c9 Copy";
      copyBtn.style.cssText = "display:inline-flex !important;align-items:center;justify-content:center;height:24px;padding:0 8px;margin-left:6px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;vertical-align:middle;position:relative;z-index:2147483647;white-space:nowrap;";
      copyBtn.onmousedown = function (e) { e.stopPropagation(); };
      copyBtn.onmouseover = function () { copyBtn.style.background = "#0369a1"; };
      copyBtn.onmouseout = function () { if (copyBtn.textContent !== "\u2713 Copied") copyBtn.style.background = "#0284c7"; };
      copyBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nm = copyBtn.dataset.placename || cleanName;
        copyToClipboard(nm);
        showToast("Copied Place Name!", nm);
        copyBtn.textContent = "\u2713 Copied";
        copyBtn.style.background = "#10b981";
      };

      // Insertion: inline next to title so it lives INSIDE the bubble
      var placed = false;
      if (titleEl && titleEl.parentNode) {
        try {
          titleEl.parentNode.insertBefore(copyBtn, titleEl.nextSibling);
          placed = true;
        } catch (e) { placed = false; }
      }
      if (!placed) {
        var linkBtn = card.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]');
        if (linkBtn && linkBtn.parentNode) {
          try {
            linkBtn.parentNode.style.display = "flex";
            linkBtn.parentNode.style.alignItems = "center";
            linkBtn.parentNode.insertBefore(copyBtn, linkBtn);
            placed = true;
          } catch (e) { placed = false; }
        }
      }
      if (!placed) {
        try { card.appendChild(copyBtn); } catch (e) {}
      }

      // NOTE: No auto-copy here on purpose. Copy ONLY when the user
      // explicitly clicks the copy button above. Auto-copy was
      // overwriting the Excel row clipboard + showing
      // "Copied Place Name!" on every plain row click.
      _lastPoiName = cleanName;
      try { showPoiFloatChip(cleanName); } catch (e) {}
    });

    // If nothing found, hide the floating chip (popup closed)
    try {
      if (cards.length === 0) hidePoiFloatChip();
    } catch (e) {}
  }

  // ---- Floating fallback chip: ALWAYS visible even if Google clips
  // the inline button (overflow:hidden / re-render wipes it). ----
  function showPoiFloatChip(placeName) {
    // Disabled: the place-click popup (poi-page-hook.js openBubble) now
    // opens its own InfoWindow and auto-copies the name, so this floating
    // chip was a redundant SECOND popup. Keep the fn as a no-op for compat.
    return;
    if (!placeName || placeName.length < 2) return;
    // REJECT footer chrome even if a caller forgot to filter.
    if (/map data \u00a9|open this area|keyboard shortcuts|report a map error|terms of use|^terms$/i.test(placeName)) return;
    // Never on the list page
    try {
      var hrefNow = window.top.location.href;
      if (!/bookingsView/i.test(hrefNow) && !/bookingsView/i.test(window.location.href)) return;
    } catch (e) {
      if (!/bookingsView/i.test(window.location.href)) {
        try { if (!document.querySelector(".gm-style")) return; } catch (e2) { return; }
      }
    }
    var chip = document.getElementById("allo-poi-float-chip");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "allo-poi-float-chip";
      chip.style.cssText = "position:fixed;bottom:88px;right:24px;z-index:2147483647;background:#0f172a;color:#fff;border:1px solid #334155;border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;box-shadow:0 15px 30px rgba(0,0,0,.45);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;max-width:340px;";
      chip.innerHTML = '<span style="color:#38bdf8;font-weight:700;white-space:nowrap;">\ud83d\udccd Place</span><span id="allo-poi-float-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;color:#e2e8f0;"></span>';
      var cb = document.createElement("button");
      cb.id = "allo-poi-float-copy";
      cb.type = "button";
      cb.textContent = "\u29c9 Copy";
      cb.style.cssText = "background:#0284c7;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;";
      cb.onmouseover = function () { cb.style.background = "#0369a1"; };
      cb.onmouseout = function () { cb.style.background = "#0284c7"; };
      cb.onclick = function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        var nm = (document.getElementById("allo-poi-float-name") || {}).textContent || placeName;
        copyToClipboard(nm);
        showToast("Copied Place Name!", nm);
        cb.textContent = "\u2713 Copied";
        setTimeout(function () { cb.textContent = "\u29c9 Copy"; }, 1500);
      };
      chip.appendChild(cb);
      var x = document.createElement("button");
      x.type = "button"; x.textContent = "\u2715"; x.title = "Hide";
      x.style.cssText = "background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0 2px;";
      x.onclick = function (ev) { ev.stopPropagation(); hidePoiFloatChip(); };
      chip.appendChild(x);
      document.body.appendChild(chip);
    }
    var nmEl = document.getElementById("allo-poi-float-name");
    if (nmEl) { nmEl.textContent = placeName; nmEl.title = placeName; }
    chip.style.display = "flex";
    // auto-hide after 20s so it never lingers forever
    try {
      clearTimeout(chip._hideT);
      chip._hideT = setTimeout(function () { hidePoiFloatChip(); }, 20000);
    } catch (e) {}
  }

  function hidePoiFloatChip() {
    try {
      var chip = document.getElementById("allo-poi-float-chip");
      if (chip) chip.style.display = "none";
    } catch (e) {}
  }

  // ---- Angular <google-map mapId=...> vector maps: POI clicks do NOT open
  // a native popup at all (IconMouseEvent with placeId, default suppressed).
  // Hook the map click ourselves and show OUR OWN copyable bubble.
  // (Your Trip Route map is exactly this: <google-map mapid="AIza...">)
  // NOTE: content scripts run in an ISOLATED world \u2014 wrapping
  // google.maps.Map here cannot see the page's own Maps objects, so the
  // real hook lives in poi-page-hook.js injected below into MAIN world.
  var _poiHookInstalled = false;
  var _poiPageHookInjected = false;

  // Bridge: page-hook posts ALLO_POI_COPIED / ALLO_POI_OPENED.
  // Toast + clipboard live here in the content-script world.
  try {
    window.addEventListener("message", function (ev) {
      try {
        var d = ev && ev.data;
        if (!d || (d.type !== "ALLO_POI_COPIED" && d.type !== "ALLO_POI_OPENED")) return;
        if (!isExtensionActive) return;
        var nm = d.name || "";
        if (/map data \u00a9|open this area|keyboard shortcuts|report a map error|terms of use|^terms$/i.test(nm)) return;
        if (d.type === "ALLO_POI_COPIED") {
          if (nm) {
            try { copyToClipboard(nm); } catch (e) {}
            showToast("Copied Place Name!", nm);
          }
        } else if (d.type === "ALLO_POI_OPENED") {
          // Floating chip removed: the name auto-copies on bubble open
          // (ALLO_POI_COPIED above) so a second "\ud83d\udccd Place" chip is redundant.
          // Do nothing here \u2014 one popup (the Copied toast) is enough.
        }
      } catch (e) {}
    });
  } catch (e) {}

  function injectPoiPageHook() {
    if (_poiPageHookInjected) return;
    _poiPageHookInjected = true;
    try {
      var s = document.createElement("script");
      try { s.src = chrome.runtime.getURL("poi-page-hook.js"); } catch (e) { return; }
      s.onload = function () { try { s.remove(); } catch (e) {} };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }
  try { injectPoiPageHook(); } catch (e) {}
  try {
    var _injN = 0;
    var _injT = setInterval(function () {
      _poiPageHookInjected = false;
      try { injectPoiPageHook(); } catch (e) {}
      if (++_injN > 5) clearInterval(_injT);
    }, 2000);
  } catch (e) {}

  // Isolated-world stub (kept for compat): real POI hook runs in
  // poi-page-hook.js (MAIN world). This is intentionally a no-op.
  function attachPoiListener(nativeMap) { return; }

  function hookVectorPoiClicks() { return; }

  // Show our own bubble at the clicked POI with a Copy button.
  // Uses Places fetchFields(displayName, formattedAddress) so we get the
  // REAL name even though the map never opened its own popup.
  function showPoiCopyBubble(map, infoWin, event) {
    var latLng = event.latLng;
    var placeId = event.placeId;
    var bubble = document.createElement("div");
    bubble.style.cssText = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-width:180px;max-width:280px;padding:2px;";
    bubble.innerHTML = '<div style="font-weight:700;font-size:14px;color:#0f172a;">Loading place\u2026</div>';
    try {
      infoWin.setOptions({ position: latLng, pixelOffset: new google.maps.Size(0, -30), headerDisabled: false });
      infoWin.setContent(bubble);
      infoWin.open(map);
      try { map.panTo(latLng); } catch (e) {}
    } catch (e) {}

    resolvePoiName(placeId, function (name, addr) {
      var safeName = (name || "Unknown place").replace(/</g, "&lt;");
      var safeAddr = (addr || "").replace(/</g, "&lt;");
      bubble.innerHTML =
        '<div style="font-weight:700;font-size:14px;color:#0f172a;margin-bottom:2px;">' + safeName + '</div>' +
        (safeAddr ? '<div style="font-size:12px;color:#64748b;margin-bottom:8px;">' + safeAddr + '</div>' : '') +
        '<button type="button" data-allo-copy style="display:inline-flex;align-items:center;gap:6px;background:#0284c7;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;">\u29c9 Copy place name</button>';
      try { showPoiFloatChip(name); } catch (e) {}
      var btn = bubble.querySelector("[data-allo-copy]");
      if (btn) {
        btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
        btn.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          copyToClipboard(name);
          showToast("Copied Place Name!", name);
          btn.textContent = "\u2713 Copied";
        });
      }
    });
  }

  // Resolve placeId -> displayName via new Places library (fallback: Geocoder)
  function resolvePoiName(placeId, cb) {
    try {
      google.maps.importLibrary("places").then(function (lib) {
        try {
          var place = new lib.Place({ id: placeId });
          place.fetchFields({ fields: ["displayName", "formattedAddress"] }).then(function () {
            var nm = (place.displayName || "").toString();
            var ad = (place.formattedAddress || "").toString();
            cb(nm || "Unknown place", ad);
          }).catch(function () { geocodeFallback(placeId, cb); });
        } catch (e) { geocodeFallback(placeId, cb); }
      }).catch(function () { geocodeFallback(placeId, cb); });
    } catch (e) { geocodeFallback(placeId, cb); }
  }

  function geocodeFallback(placeId, cb) {
    try {
      var geo = new google.maps.Geocoder();
      geo.geocode({ placeId: placeId }, function (results, status) {
        if (status === "OK" && results && results[0]) {
          cb(results[0].formatted_address || "Unknown place", "");
        } else {
          cb("Unknown place", "");
        }
      });
    } catch (e) { cb("Unknown place", ""); }
  }

  // Monitor POI map popups with both MutationObserver and high-frequency interval
  const poiObs = new MutationObserver(() => {
    clearTimeout(poiObs._t);
    poiObs._t = setTimeout(processMapInfoWindows, 80);
    try { hookVectorPoiClicks(); } catch (e) {}
  });
  poiObs.observe(document.body, { childList: true, subtree: true });
  setInterval(processMapInfoWindows, 200);

  // ============================================================
  //  PAGINATION-STATE HELPERS (site has no state mgmt \u2014 back-nav resets to page 1)
  //  We snapshot the active page before leaving, then click it back after return.
  // ============================================================
  function getActivePageNumber() {
    try {
      // 1. active pagination button / container / link
      const activeBtn = document.querySelector(
        ".pagination .active, .pagination li.active, .page-item.active .page-link, .page-item.active, " +
        ".ngx-pagination .current, ul.pagination li.current, [class*='pagination'] .active, [class*='pagination'] .current, " +
        "[class*='pagination'] [aria-current='page'], [aria-current='page']"
      );
      if (activeBtn) {
        const n = parseInt((activeBtn.innerText || activeBtn.textContent || "").trim(), 10);
        if (!isNaN(n) && n > 0) return n;
      }
      // 2. Any pagination item with blue/highlighted background or aria-current
      const candidates = Array.from(document.querySelectorAll(
        ".pagination * , [class*='pagination'] * , ul[class*='page'] *"
      ));
      for (const el of candidates) {
        const t = (el.innerText || el.textContent || "").trim();
        if (/^\d+$/.test(t)) {
          const isAct = el.classList.contains("active") || el.classList.contains("current") ||
            el.getAttribute("aria-current") === "page" ||
            (el.parentElement && (el.parentElement.classList.contains("active") || el.parentElement.classList.contains("current")));
          if (isAct) {
            const n = parseInt(t, 10);
            if (!isNaN(n) && n > 0) return n;
          }
        }
      }
      // 3. URL query (?page=2 / pageNumber=2 / pageNo=2)
      const m = window.location.href.match(/[?&](page(?:No|Num(?:ber)?)?)=(\d+)/i);
      if (m && parseInt(m[2], 10) > 0) return parseInt(m[2], 10);
    } catch (e) {}
    return 1;
  }

  function buildPageUrl(pageNum) {
    try {
      const u = new URL(window.location.href);
      const keys = ["page", "pageNo", "pageNum", "pageNumber"];
      for (const k of keys) {
        if (u.searchParams.has(k)) { u.searchParams.set(k, String(pageNum)); return u.toString(); }
      }
    } catch (e) {}
    return null;
  }

  function findPageButton(pageNum) {
    try {
      const pageStr = String(pageNum);
      // Scan all potential pagination containers or any link/button containing numbers
      const els = Array.from(document.querySelectorAll(
        "ul.pagination li a, ul.pagination li button, ul.pagination li span, " +
        ".pagination a, .pagination button, .pagination span, .pagination li, " +
        ".page-item a, .page-item button, .page-item span, " +
        "[class*='pagination'] a, [class*='pagination'] button, [class*='pagination'] li, [class*='pagination'] span"
      ));

      // 1. Exact-number match on clickable or anchor elements
      for (const el of els) {
        const txt = (el.innerText || el.textContent || "").trim();
        if (txt === pageStr) {
          // If el is an <li>, look for clickable child first
          const clickable = el.querySelector("a, button, span") || el;
          return clickable;
        }
      }

      // 2. Look for elements whose direct text is the number (avoiding parent container text)
      for (const el of els) {
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join("");
        if (directText === pageStr) return el;
      }

      // 3. aria-label fallback ("Go to page 2", "Page 2", "2")
      for (const el of els) {
        const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").toLowerCase().trim();
        if (aria === pageStr || aria === `page ${pageStr}` || aria === `go to page ${pageStr}`) {
          return el;
        }
      }
    } catch (e) {}
    return null;
  }

  // After we navigate back to the list, re-click the saved page.
  // Returns true if a restore was attempted.
  function restoreListPage(savedPage, done) {
    const target = Math.max(1, parseInt(savedPage, 10) || 1);
    if (target <= 1) { if (done) done(false); return false; }
    let settled = false;
    const finish = (ok) => { if (!settled) { settled = true; if (done) done(ok); } };
    // If we already landed on the right page, done.
    if (getActivePageNumber() === target) { finish(true); return true; }
    let tries = 0;
    let clicked = false;
    let stepNavAttempts = 0;
    const timer = setInterval(() => {
      tries++;
      if (getActivePageNumber() === target) { clearInterval(timer); finish(true); return; }
      const btn = findPageButton(target);
      if (btn) {
        try {
          btn.scrollIntoView?.({ block: "nearest" });
          btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          btn.click();
          clicked = true;
        } catch (e) {}
        // After clicking, keep verifying for a while — Angular may take time
        if (clicked && tries > 50) { clearInterval(timer); finish(true); return; }
        return;
      }
      // Target button NOT in DOM — use step-navigation via Next/Last/Previous/First
      // ngb-pagination only renders nearby pages; we must navigate closer first
      if (!clicked && tries % 5 === 0) {
        stepNavAttempts++;
        const currentPage = getActivePageNumber();
        try {
          if (target > currentPage) {
            // Try clicking "Last" (»») first to jump near the end quickly
            // Then use "Next" (») for fine-tuning
            const navBtn = stepNavAttempts <= 2
              ? findNavButton("Last", "»»")
              : findNavButton("Next", "»");
            if (navBtn) {
              navBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              navBtn.click();
            }
          } else if (target < currentPage) {
            const navBtn = stepNavAttempts <= 2
              ? findNavButton("First", "««")
              : findNavButton("Previous", "«");
            if (navBtn) {
              navBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              navBtn.click();
            }
          }
        } catch (e) {}
      }
      if (tries >= 120) { // ~18s: generous timeout
        clearInterval(timer);
        const url = buildPageUrl(target);
        if (url && url !== window.location.href) {
          try { window.location.href = url; } catch (e) {}
          finish(true);
        } else {
          // Even if URL fallback unavailable, call done so bulk queue can proceed
          finish(false);
        }
      }
    }, 150);
    return true;
  }

  // Find navigation buttons in ngb-pagination (First/Previous/Next/Last)
  function findNavButton(ariaLabel, symbolText) {
    try {
      // 1. Try aria-label match
      const byAria = document.querySelector(
        `ul.pagination a[aria-label="${ariaLabel}"], ul.pagination button[aria-label="${ariaLabel}"], ` +
        `[class*='pagination'] a[aria-label="${ariaLabel}"], [class*='pagination'] button[aria-label="${ariaLabel}"]`
      );
      if (byAria && !byAria.closest('.disabled') && byAria.closest('li')?.classList.contains('disabled') !== true) {
        return byAria;
      }
      // 2. Try symbol text match (»», «, etc.)
      if (symbolText) {
        const allLinks = document.querySelectorAll('ul.pagination a, ul.pagination button, [class*="pagination"] a, [class*="pagination"] button');
        for (const el of allLinks) {
          const txt = (el.innerText || el.textContent || "").trim();
          if (txt === symbolText || txt.includes(symbolText)) {
            const li = el.closest('li');
            if (!li || !li.classList.contains('disabled')) return el;
          }
        }
      }
    } catch (e) {}
    return null;
  }

  function navigateBackToList(returnUrl, savedPage, fallbackPath) {
    // Never navigate away after user pressed Stop — navigation is what makes
    // "Stop not working when screen quickly changes" happen.
    if (isBulkCancelRequested()) { handleBulkStopped(false); return; }
    const target = Math.max(1, parseInt(savedPage, 10) || 1);

    // ALWAYS persist the desired page so any load path can restore it
    if (target > 1) {
      sessionStorage.setItem("ALLO_RESTORE_PAGE", JSON.stringify({ page: target, ts: Date.now() }));
    }

    // PRIMARY: Use history.back() — this preserves Angular SPA component state
    // including the active pagination page (e.g. page 169).
    // window.location.href would cause a full page reload, resetting to page 1.
    if (window.history.length > 1) {
      try {
        const currentUrl = window.location.href;
        window.history.back();
        // Safety net: if history.back() didn't navigate away within 1.5s, force via URL
        setTimeout(() => {
          if (window.location.href === currentUrl) {
            // history.back() didn't work — fall back to URL
            const withPage = buildPageUrl(target);
            if (withPage) { window.location.href = withPage; }
            else { window.location.href = returnUrl || fallbackPath || "/bookings"; }
          }
        }, 1500);
        return;
      } catch (e) {}
    }

    // FALLBACK: direct URL navigation (will lose SPA state)
    const goViaUrl = (url) => {
      try { window.location.href = url; } catch (e) {}
    };
    const withPage = buildPageUrl(target);
    if (withPage) { goViaUrl(withPage); return; }
    if (returnUrl) { goViaUrl(returnUrl); return; }
    goViaUrl(fallbackPath || "/bookings");
  }

  // On every list-page load: if a bulk/single flow asked for a page restore, do it.
  function maybeRestorePageOnListLoad() {
    try {
      const raw = sessionStorage.getItem("ALLO_RESTORE_PAGE");
      if (!raw) return;
      let info = null;
      try { info = JSON.parse(raw); } catch (e) { sessionStorage.removeItem("ALLO_RESTORE_PAGE"); return; }
      if (!info || !info.page || info.page <= 1) { sessionStorage.removeItem("ALLO_RESTORE_PAGE"); return; }
      // stale guard (10 min)
      if (info.ts && Date.now() - info.ts > 10 * 60 * 1000) { sessionStorage.removeItem("ALLO_RESTORE_PAGE"); return; }
      // only on list pages (not detail)
      const isDetail = /bookingsView\/\d+/i.test(window.location.href);
      if (isDetail) return;
      if (!document.querySelector("tbody tr, table tr")) return;
      sessionStorage.removeItem("ALLO_RESTORE_PAGE");
      restoreListPage(info.page, null);
    } catch (e) {}
  }

  function checkDetailPageAutoCopy() {
    try {
      // User pressed Stop while a detail page was loading \u2014 abort before anything else
      if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
      const bulkQueueRaw = sessionStorage.getItem("ALLO_BULK_QUEUE");
      const pendingRaw = sessionStorage.getItem("ALLO_PENDING_COPY");

      // Handle single row auto-copy
      if (pendingRaw && !bulkQueueRaw) {
        processSingleDetailAutoCopy(JSON.parse(pendingRaw));
        return;
      }

      // Handle bulk queue auto-copy
      if (bulkQueueRaw) {
        ensureStopBulkButton();
        const isDetailPage = /bookingsView\/\d+/i.test(window.location.href) || 
                             !!document.querySelector("h4, h3, h5, .card-title, .box-title")?.innerText?.match(/Booking Details/i);
        
        if (isDetailPage) {
          processBulkQueueAutoCopy(JSON.parse(bulkQueueRaw));
        } else {
          // We are back on the list page: restore saved pagination first, then next item!
          const _qs = JSON.parse(bulkQueueRaw);
          const _saved = _qs.listPage || 1;
          if (_saved > 1 && getActivePageNumber() !== _saved) {
            restoreListPage(_saved, () => resumeBulkQueueNextRow(_qs));
          } else {
            resumeBulkQueueNextRow(_qs);
          }
        }
        return;
      }
    } catch (e) {
      console.error("[Allo Exporter] Detail flow error:", e);
      sessionStorage.removeItem("ALLO_PENDING_COPY");
      sessionStorage.removeItem("ALLO_BULK_QUEUE");
    }
  }

  function resumeBulkQueueNextRow(queueState) {
    if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
    const currentIndex = queueState.currentIndex || 0;
    const items = queueState.items || [];
    if (currentIndex >= items.length) {
      finishBulkQueue(queueState);
      return;
    }

    const currentItem = items[currentIndex];
    showProgressToast(`⚡ Processing ${currentIndex + 1}/${items.length}...`, `Opening row CRN: ${currentItem.crn || ""} · <b>⛔ Press Esc to Stop</b>`);

    // Wait for list DOM to settle (and saved pagination to restore) then click target row
    let attempts = 0;
    let pageRestoreTriggered = false;
    const savedPage = queueState.listPage || 1;
    const clickTimer = setInterval(() => {
      if (isBulkCancelRequested()) { clearInterval(clickTimer); handleBulkStopped(true); return; }
      attempts++;

      // If we landed on wrong page, trigger restoreListPage ONCE — it handles
      // step-navigation (Next/Last buttons) internally for hidden page numbers
      if (savedPage > 1 && getActivePageNumber() !== savedPage) {
        if (!pageRestoreTriggered && attempts >= 3) {
          pageRestoreTriggered = true;
          restoreListPage(savedPage, null);
        }
        // Wait up to 25s for pagination to settle
        if (attempts >= 250) {
          clearInterval(clickTimer);
          // Skip this item as last resort
          queueState.currentIndex = currentIndex + 1;
          sessionStorage.setItem("ALLO_BULK_QUEUE", JSON.stringify(queueState));
          resumeBulkQueueNextRow(queueState);
        }
        return;
      }

      const rows = getAllPossibleRows();
      if (rows.length > 0) {
        let targetRow = null;
        if (currentItem.crn) {
          // CRN-only exact match: never fall back to position when CRN is known.
          // Position fallback is what caused "wrong unmatched data" in bulk copy.
          targetRow = rows.find(r => {
            const crn = getCrnFromRow(r);
            return crn && currentItem.crn && digitsOnly(crn) === digitsOnly(currentItem.crn);
          }) || null;
        } else if (rows[currentIndex]) {
          targetRow = rows[currentIndex];
        }

        if (targetRow) {
          clearInterval(clickTimer);
          if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
          const allTds = Array.from(targetRow.querySelectorAll("td"));
          const clickTarget = allTds.length > 1 ? allTds[1] : allTds[0] || targetRow;
          try {
            // Re-check cancel right before the click — rapid Stop presses land here
            if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
            clickTarget.click();
          } catch (e) {}
          return;
        }
      }

      if (attempts >= 120) { // ~12 seconds: generous wait for DOM rows to appear
        clearInterval(clickTimer);
        // Skip this item if row not found in DOM
        queueState.currentIndex = currentIndex + 1;
        sessionStorage.setItem("ALLO_BULK_QUEUE", JSON.stringify(queueState));
        resumeBulkQueueNextRow(queueState);
      }
    }, 100);
  }

  function processSingleDetailAutoCopy(pending) {
    if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
    const isDetailPage = /bookingsView\/\d+/i.test(window.location.href) || 
                         !!document.querySelector("h4, h3, h5, .card-title, .box-title")?.innerText?.match(/Booking Details/i);
    if (!isDetailPage) return;

    console.log("[Allo Exporter] Single detail page detected! Starting extraction...");
    showProgressToast("\ud83d\udccb Extracting details...", "Waiting for page to render...");

    let extractionDone = false;

    function finishExtraction(details) {
      if (extractionDone) return;
      if (isBulkCancelRequested()) { extractionDone = true; handleBulkStopped(true); return; }
      extractionDone = true;

      sessionStorage.removeItem("ALLO_PENDING_COPY");

      pending.user = cleanName(details.userName);
      pending.driver = cleanName(details.driverName);
      pending.vehicle = cleanVehicle(details.vehicleType || pending.vehicle);
      pending.userMobile = details.userMobile || "No Details";
      pending.driverMobile = details.driverMobile || "No Details";

      const rowTsv = buildRowTsv({
        date: pending.date || todayStr(),
        time: pending.time || "",
        crn: pending.crn || "",
        from: pending.from || "",
        to: pending.to || "",
        driver: pending.driver,
        user: pending.user,
        vehicle: pending.vehicle,
        status: pending.status || "",
        note: pending.note || "",
        userMobile: pending.userMobile,
        driverMobile: pending.driverMobile
      });

      copyToClipboard(rowTsv);
      sessionStorage.setItem("ALLO_COPY_SUCCESS", JSON.stringify({
        crn: pending.crn,
        user: pending.user,
        driver: pending.driver
      }));

      console.log("[Allo Exporter] Extracted! User:", pending.user, "Driver:", pending.driver);
      showToast(`\u2705 Copied!`, `User: ${pending.user} | Driver: ${pending.driver}`);

      setTimeout(() => {
        if (isBulkCancelRequested()) { handleBulkStopped(false); return; }
        if (pending.returnUrl) {
          navigateBackToList(pending.returnUrl, pending.listPage || 1, "/bookings");
        } else {
          navigateBackToList(null, pending.listPage || 1, "/bookings");
        }
      }, 60);
    }

    runDetailPolling(finishExtraction);
  }

  function processBulkQueueAutoCopy(queueState) {
    if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
    const isDetailPage = /bookingsView\/\d+/i.test(window.location.href) || 
                         !!document.querySelector("h4, h3, h5, .card-title, .box-title")?.innerText?.match(/Booking Details/i);
    if (!isDetailPage) return;

    const currentIndex = queueState.currentIndex || 0;
    const items = queueState.items || [];
    const total = items.length;

    if (currentIndex >= total) {
      // Completed all queue items! Finish bulk copy.
      finishBulkQueue(queueState);
      return;
    }

    const currentItem = items[currentIndex];
    showProgressToast(`\u26a1 Extracting row ${currentIndex + 1}/${total}...`, `CRN: ${currentItem.crn || ""}`);

    let extractionDone = false;

    function finishItemExtraction(details) {
      if (extractionDone) return;
      // VERIFY: detail page CRN must match the navigated list row CRN.
      // Prevents incorrectly-copied data when Angular lands on a stale/wrong detail.
      try {
        var liveTrip = extractTripInfoFromCurrentDetailPage();
        var liveCrn = digitsOnly((liveTrip && liveTrip.crn) || "");
        var wantCrn = digitsOnly(currentItem.crn || "");
        if (wantCrn && liveCrn && liveCrn !== wantCrn) {
          showProgressToast(`\u26a0\ufe0f Verifying row ${currentIndex + 1}/${total}...`, `CRN mismatch (list ${wantCrn} vs page ${liveCrn}) \u2014 waiting for correct detail...`);
          setTimeout(() => { if (!extractionDone) runDetailPolling(finishItemExtraction, wantCrn); }, 500);
          return;
        }
      } catch (e) {}
      if (isBulkCancelRequested()) { extractionDone = true; handleBulkStopped(true); return; }
      extractionDone = true;

      currentItem.user = cleanName(details.userName);
      currentItem.driver = cleanName(details.driverName);
      currentItem.vehicle = cleanVehicle(details.vehicleType || currentItem.vehicle);
      currentItem.userMobile = details.userMobile || "No Details";
      currentItem.driverMobile = details.driverMobile || "No Details";

      const nextIndex = currentIndex + 1;
      queueState.currentIndex = nextIndex;

      if (nextIndex >= total) {
        finishBulkQueue(queueState);
      } else {
        // Save state and navigate to return URL so main list can click the next item
        sessionStorage.setItem("ALLO_BULK_QUEUE", JSON.stringify(queueState));
        setTimeout(() => {
          if (isBulkCancelRequested()) { handleBulkStopped(false); return; }
          navigateBackToList(queueState.returnUrl, queueState.listPage || 1, "/bookings");
        }, 50);
      }
    }

    runDetailPolling(finishItemExtraction, currentItem.crn);
  }

  function finishBulkQueue(queueState) {
    if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
    clearBulkCancel();
    sessionStorage.removeItem("ALLO_BULK_QUEUE");
    let items = queueState.items || [];
    // Bulk copy in REVERSE so paste lands in list order (user-verified paste behavior).
    const orderedForClipboard = items.slice().reverse();
    const tsvLines = orderedForClipboard.map(item => buildRowTsv(item));

    const clipboardText = tsvLines.join("\r\n");
    const ok = copyToClipboard(clipboardText);

    sessionStorage.setItem("ALLO_COPY_SUCCESS", JSON.stringify({
      bulkCount: items.length,
      isBulk: true
    }));
    hideProgressToast();
    try {
      const s = document.getElementById("allo-stop-bulk-btn");
      if (s) s.remove();
    } catch (e) {}

    // Delay navigation so clipboard has time to settle before page unloads
    setTimeout(() => {
      if (queueState.returnUrl) {
        navigateBackToList(queueState.returnUrl, queueState.listPage || 1, "/bookings");
      } else {
        navigateBackToList(null, queueState.listPage || 1, "/bookings");
      }
    }, 150);
  }

  function runDetailPolling(onSuccess, expectedCrn) {
    let tries = 0;
    let firstFoundTry = -1;
    const maxTries = 80;
    let done = false;
    const wantCrn = digitsOnly(expectedCrn || "");

    function liveCrn() {
      try {
        const t = extractTripInfoFromCurrentDetailPage();
        return digitsOnly((t && t.crn) || "");
      } catch (e) { return ""; }
    }

    function isCrnOk() {
      // VERIFY every bulk list: detail-page CRN must equal the navigated row CRN.
      // Empty live CRN (page still rendering) or empty expected = allow to keep waiting,
      // but a real mismatch must NEVER be accepted as this row's detail.
      if (!wantCrn) return true;
      const lc = liveCrn();
      if (!lc) return true;
      return lc === wantCrn;
    }

    function tryExtract() {
      const details = extractNamesFromCurrentDetailPage();
      const crnOk = isCrnOk();
      const hasUser = details.userName && details.userName !== "No Details";
      const hasDriver = details.driverName && details.driverName !== "No Details";
      const hasBoth = hasUser && hasDriver && crnOk;
      const hasAny = (hasUser || hasDriver) && crnOk;
      return { details, hasBoth, hasAny };
    }

    const pollTimer = setInterval(() => {
      if (done) { clearInterval(pollTimer); return; }
      if (isBulkCancelRequested()) { done = true; clearInterval(pollTimer); handleBulkStopped(true); return; }
      tries++;
      const { details, hasBoth, hasAny } = tryExtract();

      if (hasBoth) {
        done = true;
        clearInterval(pollTimer);
        onSuccess(details);
        return;
      }

      if (hasAny) {
        if (firstFoundTry === -1) firstFoundTry = tries;
        if (tries - firstFoundTry >= 12) {
          done = true;
          clearInterval(pollTimer);
          onSuccess(details);
          return;
        }
      }

      if (tries >= maxTries) {
        done = true;
        clearInterval(pollTimer);
        onSuccess(details);
      }
    }, 80);

    const initialCheck = tryExtract();
    if (initialCheck.hasBoth) {
      done = true;
      clearInterval(pollTimer);
      onSuccess(initialCheck.details);
      return;
    }

    const detailObserver = new MutationObserver(() => {
      if (done) { detailObserver.disconnect(); return; }
      const { details, hasBoth } = tryExtract();
      if (hasBoth) {
        done = true;
        clearInterval(pollTimer);
        detailObserver.disconnect();
        onSuccess(details);
      }
    });
    detailObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

    setTimeout(() => {
      detailObserver.disconnect();
      if (!done) {
        done = true;
        clearInterval(pollTimer);
        const { details } = tryExtract();
        onSuccess(details);
      }
    }, 8000);
  }

  // Check if we just returned after a successful copy
  try {
    const successRaw = sessionStorage.getItem("ALLO_COPY_SUCCESS");
    if (successRaw) {
      sessionStorage.removeItem("ALLO_COPY_SUCCESS");
      const info = JSON.parse(successRaw);
      setTimeout(() => {
        if (info.isBulk) {
          showToast(`\u2705 Copied ${info.bulkCount} row(s) to Excel!`, `All driver & user details included. Press Ctrl+V in Excel.`);
        } else {
          showToast(`\u2705 Copied CRN ${info.crn || ""}!`, `User: ${info.user} | Driver: ${info.driver}`);
        }
      }, 300);
    }
  } catch (e) {}

  // ============================================================
  //  DETAIL PAGE BANNER (Only on /bookingsView pages)
  // ============================================================
  function syncDetailPageBanner() {
    const isStrictDetailPage = /bookingsView/i.test(window.location.href) || 
                               (!!document.querySelector("h4, h3, h5, .card-title, .box-title")?.innerText?.match(/Booking Details/i) && !document.querySelector("tbody tr"));
    const existingBar = document.getElementById("allo-detail-bar");

    if (!isStrictDetailPage) {
      if (existingBar && existingBar.parentNode) {
        existingBar.parentNode.removeChild(existingBar);
      }
      return;
    }

    if (existingBar || !isExtensionActive) return;

    const bar = document.createElement("div");
    bar.id = "allo-detail-bar";
    bar.className = "allo-detail-bar";
    bar.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-weight:700;color:#38bdf8;">\ud83d\udccb Booking Detail Page</span>
      </div>
      <button class="allo-btn success" id="allo-copy-this-detail-btn">
        Copy This Row to Excel
      </button>
      <button class="allo-btn secondary" id="allo-back-btn">
        \u2190 Back to List
      </button>
    `;
    document.body.appendChild(bar);

    document.getElementById("allo-copy-this-detail-btn").addEventListener("click", () => {
      const details = extractNamesFromCurrentDetailPage();
      const trip = extractTripInfoFromCurrentDetailPage();
      const driver = cleanName(details.driverName);
      const user = cleanName(details.userName);
      const rowTsv = buildRowTsv({
        date: trip.date || todayStr(),
        time: trip.time || "",
        crn: trip.crn || "",
        from: trip.from || "",
        to: trip.to || "",
        driver: driver,
        user: user,
        vehicle: details.vehicleType || "Auto",
        status: trip.status || "completed",
        note: "",
        userMobile: details.userMobile || "No Details",
        driverMobile: details.driverMobile || "No Details"
      });

      copyToClipboard(rowTsv);
      showToast(`\u2705 Copied! User: ${user}`, `Driver: ${driver} | Paste in Excel`);
    });

    document.getElementById("allo-back-btn").addEventListener("click", () => {
      window.history.back();
    });

    highlightMapMarkers();
  }

  // Highlight Google Map Pins & enable click-to-copy for ANY map place name (stores, tuition centers, garages, etc.)
  function highlightMapMarkers() {
    if (!/bookingsView/i.test(window.location.href)) return;

    const applyMarkerStyles = () => {
      const trip = extractTripInfoFromCurrentDetailPage();
      const markerImgs = Array.from(document.querySelectorAll('.gm-style img[src*="spotlight"], .gm-style img[src*="marker"], .gm-style div[title] img, .gm-style [role="button"] img'));
      const markerDivs = Array.from(document.querySelectorAll('.gm-style div[title], .gm-style [role="button"]'));
      
      const startEl = markerImgs[0] || markerDivs[0];
      const endEl = markerImgs.length > 1 ? markerImgs[markerImgs.length - 1] : markerDivs[markerDivs.length - 1];

      if (startEl && startEl !== endEl) {
        startEl.style.filter = "drop-shadow(0px 0px 8px #10b981) hue-rotate(90deg) saturate(4)";
        if (endEl) endEl.style.filter = "drop-shadow(0px 0px 8px #ef4444) hue-rotate(0deg) saturate(3)";
      }

      // Colorize labels in Trip Details
      const labels = Array.from(document.querySelectorAll('div, td, p, span, label'));
      labels.forEach(el => {
        const txt = (el.innerText || "").trim();
        if (txt === "From" || txt.startsWith("From:")) {
          el.style.color = "#10b981"; el.style.fontWeight = "bold";
          if (!el.innerText.includes("\ud83d\udfe2")) el.innerText = "\ud83d\udfe2 " + el.innerText;
        } else if (txt === "To" || txt.startsWith("To:")) {
          el.style.color = "#ef4444"; el.style.fontWeight = "bold";
          if (!el.innerText.includes("\ud83d\udd34")) el.innerText = "\ud83d\udd34 " + el.innerText;
        }
      });
    };



    for (let delay of [300, 800, 1500, 2500, 4000]) {
      setTimeout(applyMarkerStyles, delay);
    }
  }

  // ============================================================
  //  FLOATING PANEL
  // ============================================================
  function initFloatingControl() {
    if (!isExtensionActive || !isBookingPage()) {
      syncVisibility();
      return;
    }
    syncDetailPageBanner();
    if (/bookingsView/i.test(window.location.href) || (!!document.querySelector("h4, h3, h5, .card-title, .box-title")?.innerText?.match(/Booking Details/i) && !document.querySelector("tbody tr"))) {
      return;
    }

    if (document.getElementById("allo-floating-panel")) {
      syncVisibility();
      return;
    }

    const floatingPanel = document.createElement("div");
    floatingPanel.id = "allo-floating-panel";
    floatingPanel.className = "allo-floating-panel";
    if (!isExtensionActive || !isBookingPage()) floatingPanel.style.display = "none";

    floatingPanel.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
        <span style="font-size: 13px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 5px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          Excel Copy
        </span>
        <button style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:0 4px;line-height:1;" id="allo-close-panel" title="Turn OFF">\u2715</button>
      </div>
      <button class="allo-btn" id="allo-snip-btn" title="Shortcut: Alt+S">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
        Select Area (Alt+S)
      </button>
      <button class="allo-btn secondary" id="allo-copy-all-btn" title="Shortcut: Alt+A">Copy All Rows</button>
      <button class="allo-btn secondary" id="allo-checkbox-toggle">Checkboxes</button>
      <button class="allo-btn success" id="allo-copy-selected-btn" style="display:none;">
        Copy Selected (<span id="allo-selected-count">0</span>)
      </button>
    `;

    document.body.appendChild(floatingPanel);

    document.getElementById("allo-snip-btn").addEventListener("click", (e) => { e.stopPropagation(); startSnipMode(); });
    document.getElementById("allo-copy-all-btn").addEventListener("click", (e) => { e.stopPropagation(); copyAllVisibleBookings(); });
    document.getElementById("allo-checkbox-toggle").addEventListener("click", (e) => { e.stopPropagation(); toggleRowCheckboxes(); });
    document.getElementById("allo-copy-selected-btn").addEventListener("click", (e) => { e.stopPropagation(); handleCopySelectedClick(); });
    document.getElementById("allo-close-panel").addEventListener("click", () => {
      isExtensionActive = false;
      floatingPanel.style.display = "none";
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ extensionEnabled: false });
      }
      showToast("Extension OFF", "Turn back ON from the extension icon.");
    });

    injectRowCopyButtons();
  }

  // ============================================================
  //  INJECT "COPY TO EXCEL" BUTTON ON EACH ROW
  // ============================================================
  function injectRowCopyButtons() {
    if (!isExtensionActive || !isBookingPage()) {
      const buttons = document.querySelectorAll(".allo-row-copy-btn");
      buttons.forEach(btn => btn.style.display = "none");
      return;
    }
    const rows = getAllPossibleRows();
    rows.forEach(row => {
      if (row.closest("thead") || row.querySelector("th")) return;
      if (row.querySelector(".allo-row-copy-btn")) return;

      const btn = document.createElement("button");
      btn.className = "allo-row-copy-btn";
      btn.type = "button";
      btn.title = "Click to open details, extract User & Driver name, and copy to Excel";
      btn.innerHTML = `<span>\ud83d\udccb Copy</span>`;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        executeRowAutoClickCopy(row);
      });

      // Find the best td cell to append: last td cell (Action column)
      const cells = row.querySelectorAll("td");
      if (cells.length > 0) {
        const lastCell = cells[cells.length - 1];
        lastCell.style.position = "relative";
        lastCell.appendChild(btn);
      } else {
        row.appendChild(btn);
      }
    });
  }

  // ============================================================
  //  LIGHTNING-FAST INSTANT ROW COPY (NO PAGE FLICKER / NO SLOW NAVIGATION)
  // ============================================================
  async function executeRowAutoClickCopy(rowEl) {
    if (isBulkCancelRequested()) { handleBulkStopped(false); return; }
    const basic = parseBookingRow(rowEl, getTableHeaderMap());
    const copyBtn = rowEl.querySelector(".allo-row-copy-btn");

    if (copyBtn) {
      copyBtn.innerHTML = `<span>\u23f3 Navigating...</span>`;
      copyBtn.style.opacity = "0.7";
    }

    // Highlight row
    rowEl.classList.add("allo-row-selected");

    // Store pending copy data in sessionStorage \u2014 the detail page will pick this up
    const pendingData = {
      listPage: getActivePageNumber(),
      date: basic.date || todayStr(),
      time: basic.time || "",
      crn: basic.crn || "",
      from: basic.from || "",
      to: basic.to || "",
      vehicle: "-",
      status: basic.status || "",
      note: "",
      returnUrl: window.location.href // Save current URL to navigate back
    };

    sessionStorage.setItem("ALLO_PENDING_COPY", JSON.stringify(pendingData));

    console.log("[Allo Exporter] Clicking row to trigger Angular navigation...");
    showProgressToast("\u26a1 Opening detail page...", "Will auto-copy & return!");

    // Angular handles navigation via click on <td> cells, not via <a> links.
    // Find a clickable td (not the action/last td where our button lives)
    const allTds = Array.from(rowEl.querySelectorAll("td"));
    // Click on the CRN cell (2nd td) or the first available non-action td
    const clickTarget = allTds.length > 1 ? allTds[1] : allTds[0] || rowEl;
    
    // Programmatically click to trigger Angular's (click) handler
    clickTarget.click();
  }

  // ============================================================
  //  EXTRACT NAMES FROM CURRENT LIVE DETAIL PAGE
  // ============================================================
  function cleanVehicle(val) {
    if (!val || typeof val !== "string") return "-";
    const s = val.trim();
    if (!s || /^[-\u2013\u2014:.\s]+$/i.test(s) || /^(n\/?a|none|null|undefined|no details)$/i.test(s)) {
      return "-";
    }
    // If vehicle matches field label or CRN pattern, return "-"
    if (/^(crn|crn\s*number|service\s*type|vehicle\s*type|service|vehicle)$/i.test(s)) {
      return "-";
    }
    if (/^\d{8,}$/.test(s) || /179\d{8,}/.test(s)) {
      return "-";
    }
    return s;
  }

  function cleanName(val) {
    if (!val || typeof val !== "string") return "No Details";
    const s = val.trim();
    if (!s) return "No Details";
    // Check if it's only placeholder punctuation, colons, dashes or empty words
    if (/^[-\u2013\u2014:.\s]+$/i.test(s) || /^(n\/?a|none|null|undefined|no details)$/i.test(s)) {
      return "No Details";
    }
    return s;
  }

  function extractNamesFromCurrentDetailPage() {
    let userName = "";
    let driverName = "";
    let vehicleType = "-";

    // 1. Try DOM query on inputs, form-groups, cards
    userName = extractNameFromLiveDoc(["user details", "user", "passenger", "customer"]);
    driverName = extractNameFromLiveDoc(["provider details", "provider", "driver details", "driver", "vehicle driver"]);

    // 2. Text parsing fallback
    const bodyText = document.body ? (document.body.innerText || document.body.textContent || "") : "";

    if (!userName) {
      const userSection = extractSection(bodyText, "User Details") || extractSection(bodyText, "Customer Details");
      if (userSection) {
        const fn = extractFieldValue(userSection, "First Name");
        const ln = extractFieldValue(userSection, "Last Name");
        userName = [fn, ln].filter(Boolean).join(" ").trim();
      }
    }
    if (!userName) {
      userName = extractNameFromFullText(bodyText, "User Details") || extractNameFromFullText(bodyText, "Customer Details");
    }

    if (!driverName) {
      const providerSection = extractSection(bodyText, "Provider Details") || 
                              extractSection(bodyText, "Driver Details") || 
                              extractSection(bodyText, "Provider / Driver") ||
                              extractSection(bodyText, "Driver");
      if (providerSection) {
        const fn = extractFieldValue(providerSection, "First Name");
        const ln = extractFieldValue(providerSection, "Last Name");
        driverName = [fn, ln].filter(Boolean).join(" ").trim();
      }
    }
    if (!driverName) {
      driverName = extractNameFromFullText(bodyText, "Provider Details") || 
                   extractNameFromFullText(bodyText, "Driver Details") || 
                   extractNameFromFullText(bodyText, "Provider Info");
    }

    // Service / Vehicle type
    const tripSection = extractSection(bodyText, "Trip Details");
    if (tripSection) {
      const st = extractFieldValue(tripSection, "Service Type") || extractFieldValue(tripSection, "Vehicle Type");
      if (st) vehicleType = st;
    }

    // Extract user number from User Details section (first phone number)
    const userSectionForMobile = extractSection(bodyText, "User Details") || extractSection(bodyText, "Customer Details");
    let userNumber = "";
    if (userSectionForMobile) {
      userNumber = extractFieldValue(userSectionForMobile, "Mobile") || extractFieldValue(userSectionForMobile, "Phone") || "";
    }

    // Extract provider number from Provider Details section (second phone number)
    const providerSectionForMobile = extractSection(bodyText, "Provider Details") || extractSection(bodyText, "Driver Details");
    let providerNumber = "";
    if (providerSectionForMobile) {
      providerNumber = extractFieldValue(providerSectionForMobile, "Mobile") || extractFieldValue(providerSectionForMobile, "Phone") || "";
    }

    return {
      userName: cleanName(userName),
      driverName: cleanName(driverName),
      vehicleType: cleanVehicle(vehicleType),
      userMobile: userNumber || "No Details",
      driverMobile: providerNumber || "No Details"
    };
  }

  function extractTripInfoFromCurrentDetailPage() {
    const bodyText = document.body ? document.body.innerText : "";
    const tripSection = extractSection(bodyText, "Trip Details") || bodyText;

    let crn = extractFieldValue(tripSection, "CRN Number") || extractFieldValue(tripSection, "CRN") || "";
    if (!crn) {
      const m = bodyText.match(/179\d{8,12}/);
      if (m) crn = m[0];
    }

    let date = extractFieldValue(tripSection, "Date") || todayStr();
    let from = extractFieldValue(tripSection, "From") || "";
    let to = extractFieldValue(tripSection, "To") || "";
    let status = /completed/i.test(bodyText) ? "completed" : /cancelled/i.test(bodyText) ? "cancelled" : "pending";

    return { crn, date: normalizeDate(date), time: "", from: cleanAddr(from), to: cleanAddr(to), status };
  }

  function extractNameFromLiveDoc(sectionKeywords) {
    try {
      const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, .card-title, .box-title, .panel-title, .Tle, .pgeHed, strong, b, label, th, div.header"));
      for (const h of allHeadings) {
        const text = (h.textContent || "").toLowerCase().trim();
        if (sectionKeywords.some(kw => text.includes(kw))) {
          const container = h.closest(".crdBy, .card, .panel, .box, .col-md-6, .col-sm-6, .col-lg-6, .col-12, .row, section, fieldset") || h.parentElement;
          if (container) {
            let fn = "";
            let ln = "";

            // 1. Try inputs or elements with attributes
            const formItems = Array.from(container.querySelectorAll("input, span, p, div, td, b")).filter(el => el !== h);
            formItems.forEach(el => {
              const nameOrPlaceholder = (el.name || el.placeholder || el.id || el.getAttribute("aria-label") || el.getAttribute("ng-reflect-name") || "").toLowerCase();
              const elParent = el.parentElement;
              // Only check immediate parent row text, not grandparent containers
              const parentText = elParent ? (elParent.innerText || "") : "";
              const parentIsRow = elParent && (elParent.classList.contains("row") || elParent.classList.contains("Cnt") || elParent.tagName === "TR");
              const label = parentIsRow ? parentText.toLowerCase() : (elParent && elParent !== container ? parentText.toLowerCase() : "");

              // Guard: skip elements whose text looks like a section heading
              const valRaw = (el.value || el.textContent || "").trim();
              if (/^(user|provider|driver|customer|passenger|trip|booking)\s*(details?|info)?$/i.test(valRaw)) return;

              if ((nameOrPlaceholder.includes("first") || label.includes("first name")) && !fn) {
                if (valRaw && !/first\s*name/i.test(valRaw) && valRaw !== ":") fn = valRaw;
              }
              if ((nameOrPlaceholder.includes("last") || label.includes("last name")) && !ln) {
                if (valRaw && !/last\s*name/i.test(valRaw) && valRaw !== ":") ln = valRaw;
              }
            });

            // 2. Try text pattern inside container (e.g. "First Name : selvachandran")
            if (!fn || !ln) {
              const cText = container.innerText || container.textContent || "";
              if (!fn) fn = extractFieldValue(cText, "First Name");
              if (!ln) ln = extractFieldValue(cText, "Last Name");
            }

            if (fn || ln) {
              return [fn, ln].filter(Boolean).join(" ").trim();
            }

            // 3. Fallback: grab any meaningful text from the container that looks like a name
            //    (for cases where the provider section shows name without First/Last Name labels)
            const containerText = (container.innerText || container.textContent || "").trim();
            const nameLines = containerText.split(/\n/).map(l => l.trim()).filter(l => {
              if (!l || l.length < 2 || l.length > 60) return false;
              // Skip labels, headings, emails, phone numbers, field names
              if (/^(first|last|email|mobile|phone|provider|driver|user|customer|passenger|details|name|vehicle|service)/i.test(l)) return false;
              if (/[@.:]/.test(l) && /@/.test(l)) return false; // emails
              if (/^[\d\s+()-]+$/.test(l)) return false; // phone numbers
              if (/^[-\u2013\u2014:.\s]+$/.test(l)) return false; // separators
              return true;
            });
            if (nameLines.length > 0) {
              // Take the first line that looks like a name (not a label)
              return nameLines[0];
            }
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function handleCopySelectedClick() {
    let selectedRows = Array.from(document.querySelectorAll(".allo-row-selected"));
    if (selectedRows.length === 0) {
      const checkedBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
      const foundRows = new Set();
      checkedBoxes.forEach(cb => {
        const row = cb.closest("tr") || cb.closest('[role="row"]');
        if (row && !row.closest("thead")) foundRows.add(row);
      });
      selectedRows = Array.from(foundRows);
    }
    if (selectedRows.length === 0) {
      showToast("\u26a0\ufe0f No rows selected", "Check at least one row first.");
      return;
    }

    // If 1 row is selected, execute the full auto-click flow!
    if (selectedRows.length === 1) {
      executeRowAutoClickCopy(selectedRows[0]);
      return;
    }

    extractAndCopyRows(selectedRows);
  }

  // ============================================================
  //  DETAIL URL FINDER (Multi-Strategy)
  // ============================================================
  function getDetailUrlFromRow(rowEl) {
    const baseUrl = window.location.origin;

    // Strategy 1: <a> tags inside row
    const allLinks = Array.from(rowEl.querySelectorAll("a"));
    for (const a of allLinks) {
      const href = a.getAttribute("href") || a.href || "";
      if (/bookingsView\/\d+/i.test(href)) {
        return href.startsWith("http") ? href : new URL(href, baseUrl).href;
      }
    }

    // Strategy 2: Check all attributes
    const allDescendants = [rowEl, ...Array.from(rowEl.querySelectorAll("*"))];
    for (const el of allDescendants) {
      for (const attr of el.attributes || []) {
        const val = attr.value || "";
        const match = val.match(/bookingsView\/(\d+)/i);
        if (match) return `${baseUrl}/bookingsView/${match[1]}`;
      }
      const routerLink = el.getAttribute("ng-reflect-router-link") || 
                         el.getAttribute("routerlink") || 
                         el.getAttribute("[routerlink]") || "";
      if (routerLink) {
        const rlMatch = routerLink.match(/bookingsView\/(\d+)/i) || routerLink.match(/(\d+)/);
        if (rlMatch) return `${baseUrl}/bookingsView/${rlMatch[1]}`;
      }
    }

    // Strategy 3: Check outerHTML
    const outerHtml = rowEl.outerHTML || "";
    const htmlMatch = outerHtml.match(/bookingsView\/(\d+)/i);
    if (htmlMatch) return `${baseUrl}/bookingsView/${htmlMatch[1]}`;

    // Strategy 4: Check dataset
    if (rowEl.dataset) {
      for (const [k, v] of Object.entries(rowEl.dataset)) {
        if (/id|booking/i.test(k) && /^\d+$/.test(v)) {
          return `${baseUrl}/bookingsView/${v}`;
        }
      }
    }

    // Strategy 5: Check cached detail URL mapped by row or CRN
    const crn = getCrnFromRow(rowEl);
    if (crn && rowDetailUrlCache.has(crn)) return rowDetailUrlCache.get(crn);
    if (rowDetailUrlCache.has(rowEl)) return rowDetailUrlCache.get(rowEl);

    return null;
  }

  const rowDetailUrlCache = new Map();

  function getCrnFromRow(rowEl) {
    const rawText = (rowEl.innerText || "").trim();
    const crnMatch = rawText.match(/179\d{8,12}/) || rawText.match(/(\d{10,15})/i);
    return crnMatch ? (crnMatch[1] || crnMatch[0]).replace(/[^\d]/g, "") : null;
  }

  // Monitor clicks on rows to auto-learn booking ID/URL
  window.addEventListener("click", (e) => {
    const row = e.target.closest("tbody tr, table tr, [role='row']");
    if (!row) return;

    const link = e.target.closest("a");
    if (link && link.href && link.href.includes("bookingsView/")) {
      const crn = getCrnFromRow(row);
      if (crn) rowDetailUrlCache.set(crn, link.href);
      rowDetailUrlCache.set(row, link.href);
      return;
    }

    const crn = getCrnFromRow(row);
    setTimeout(() => {
      const currentUrl = window.location.href;
      const m = currentUrl.match(/bookingsView\/(\d+)/i);
      if (m) {
        const discoveredUrl = `${window.location.origin}/bookingsView/${m[1]}`;
        if (crn) rowDetailUrlCache.set(crn, discoveredUrl);
        rowDetailUrlCache.set(row, discoveredUrl);
      }
    }, 150);
  }, true);

  // ============================================================
  //  DETAIL PAGE FETCHER (BACKGROUND FETCH)
  // ============================================================
  async function fetchBookingDetails(detailUrl) {
    try {
      const response = await fetch(detailUrl, {
        credentials: "include",
        headers: { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
      });

      if (!response.ok) return null;

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      let userName = "";
      let driverName = "";
      let vehicleType = "Auto";

      // Try DOM query selector on form controls / labels in parsed doc
      userName = extractNameFromParsedDoc(doc, ["user", "passenger", "customer"]);
      driverName = extractNameFromParsedDoc(doc, ["provider", "driver"]);

      // Fall back to text parsing
      const bodyText = doc.body ? (doc.body.innerText || doc.body.textContent || "") : "";

      if (!userName) {
        const userSection = extractSection(bodyText, "User Details");
        if (userSection) {
          const fn = extractFieldValue(userSection, "First Name");
          const ln = extractFieldValue(userSection, "Last Name");
          userName = [fn, ln].filter(Boolean).join(" ").trim();
        }
      }
      if (!userName) userName = extractNameFromFullText(bodyText, "User Details");

      if (!driverName) {
        const providerSection = extractSection(bodyText, "Provider Details") || extractSection(bodyText, "Driver Details");
        if (providerSection) {
          const fn = extractFieldValue(providerSection, "First Name");
          const ln = extractFieldValue(providerSection, "Last Name");
          driverName = [fn, ln].filter(Boolean).join(" ").trim();
        }
      }
      if (!driverName) driverName = extractNameFromFullText(bodyText, "Provider Details") || extractNameFromFullText(bodyText, "Driver Details");

      const tripSection = extractSection(bodyText, "Trip Details");
      if (tripSection) {
        const st = extractFieldValue(tripSection, "Service Type");
        if (st) vehicleType = st;
      }

      // Expose fetched-page CRN so bulk caller can VERIFY list-row CRN === detail CRN.
      let fetchedCrn = extractFieldValue(tripSection || bodyText, "CRN Number") || extractFieldValue(tripSection || bodyText, "CRN") || "";
      if (!fetchedCrn) {
        const m = bodyText.match(/179\d{8,12}/);
        if (m) fetchedCrn = m[0];
      }

      // Extract user number from User Details section (first phone number)
      const userSectionForMobile = extractSection(bodyText, "User Details");
      let userNumber = "";
      if (userSectionForMobile) {
        userNumber = extractFieldValue(userSectionForMobile, "Mobile") || extractFieldValue(userSectionForMobile, "Phone") || "";
      }

      // Extract provider number from Provider Details section (second phone number)
      let providerNumber = "";
      const providerSectionForMobile = extractSection(bodyText, "Provider Details") || extractSection(bodyText, "Driver Details");
      if (providerSectionForMobile) {
        providerNumber = extractFieldValue(providerSectionForMobile, "Mobile") || extractFieldValue(providerSectionForMobile, "Phone") || "";
      }

      return {
        userName: cleanName(userName),
        driverName: cleanName(driverName),
        vehicleType: cleanVehicle(vehicleType),
        crn: digitsOnly(fetchedCrn || ""),
        userMobile: userNumber || "No Details",
        driverMobile: providerNumber || "No Details"
      };
    } catch (err) {
      console.error("[Allo Exporter] Error fetching details:", err);
      return null;
    }
  }

  function extractNameFromParsedDoc(doc, sectionKeywords) {
    try {
      const allHeadings = Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6, .card-title, .box-title, .panel-title, .Tle, .pgeHed, strong, b, label, th, div.header"));
      for (const h of allHeadings) {
        const text = (h.textContent || "").toLowerCase();
        if (sectionKeywords.some(kw => text.includes(kw))) {
          const container = h.closest(".crdBy, .card, .panel, .box, .col-md-6, .col-sm-6, .col-lg-6, .col-12, .row, section, fieldset") || h.parentElement;
          if (container) {
            let fn = "";
            let ln = "";
            const inputs = Array.from(container.querySelectorAll("input, span, p, div, td, b")).filter(el => el !== h);
            inputs.forEach(el => {
              const nameOrPlaceholder = (el.name || el.placeholder || el.id || el.getAttribute("aria-label") || el.getAttribute("ng-reflect-name") || "").toLowerCase();
              const elParent = el.parentElement;
              const parentText = elParent ? (elParent.innerText || "") : "";
              const parentIsRow = elParent && (elParent.classList.contains("row") || elParent.classList.contains("Cnt") || elParent.tagName === "TR");
              const label = parentIsRow ? parentText.toLowerCase() : (elParent && elParent !== container ? parentText.toLowerCase() : "");

              const valRaw = (el.value || el.textContent || "").trim();
              if (/^(user|provider|driver|customer|passenger|trip|booking)\s*(details?|info)?$/i.test(valRaw)) return;

              if ((nameOrPlaceholder.includes("first") || label.includes("first name")) && !fn) {
                if (valRaw && !/first\s*name/i.test(valRaw) && valRaw !== ":") fn = valRaw;
              }
              if ((nameOrPlaceholder.includes("last") || label.includes("last name")) && !ln) {
                if (valRaw && !/last\s*name/i.test(valRaw) && valRaw !== ":") ln = valRaw;
              }
            });

            if (!fn || !ln) {
              const cText = container.innerText || container.textContent || "";
              if (!fn) fn = extractFieldValue(cText, "First Name");
              if (!ln) ln = extractFieldValue(cText, "Last Name");
            }

            if (fn || ln) return [fn, ln].filter(Boolean).join(" ").trim();

            // Fallback: grab any meaningful text from the container that looks like a name
            const containerText = (container.innerText || container.textContent || "").trim();
            const nameLines = containerText.split(/\n/).map(l => l.trim()).filter(l => {
              if (!l || l.length < 2 || l.length > 60) return false;
              if (/^(first|last|email|mobile|phone|provider|driver|user|customer|passenger|details|name|vehicle|service)/i.test(l)) return false;
              if (/[@.:]/.test(l) && /@/.test(l)) return false;
              if (/^[\d\s+()-]+$/.test(l)) return false;
              if (/^[-\u2013\u2014:.\s]+$/.test(l)) return false;
              return true;
            });
            if (nameLines.length > 0) return nameLines[0];
          }
        }
      }
    } catch (e) {}
    return "";
  }

  function extractSection(fullText, sectionName) {
    const regex = new RegExp(sectionName.replace(/\s+/g, "\\s*"), "i");
    const idx = fullText.search(regex);
    if (idx === -1) return null;

    const afterSection = fullText.substring(idx);
    const nextSection = afterSection.substring(sectionName.length).search(
      /(?:User|Provider|Driver|Trip|Booking)\s*Details?|Trip\s*Route/i
    );

    if (nextSection !== -1) {
      return afterSection.substring(0, sectionName.length + nextSection).trim();
    }
    return afterSection.substring(0, 600).trim();
  }

  function extractFieldValue(sectionText, fieldName) {
    const colonRegex = new RegExp(fieldName + "\\s*[:\uff1a.]\\s*(.+)", "i");
    const colonMatch = sectionText.match(colonRegex);
    if (colonMatch) {
      let val = colonMatch[1].trim().split("\n")[0].trim();
      val = val.split(/\b(?:Last Name|Email|Mobile|Phone|Telephone|First Name)\b/i)[0].trim();
      val = val.replace(/^[:\uff1a.]\s*/, "").trim();
      if (val && !/^[:\uff1a.\-\s]+$/.test(val) && val.length > 0) return val;
    }

    const lines = sectionText.split("\n").map(l => l.trim());
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].toLowerCase().includes(fieldName.toLowerCase())) {
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !/^[:\uff1a.\-\s]+$/.test(nextLine)) {
            if (!/^(First Name|Last Name|Email|Mobile|Phone|Telephone|Service|CRN|Date|From|To|Vehicle)/i.test(nextLine)) {
              return nextLine;
            }
            break;
          }
        }
      }
    }
    return "";
  }

  function extractNameFromFullText(fullText, sectionName) {
    const idx = fullText.toLowerCase().indexOf(sectionName.toLowerCase());
    if (idx === -1) return "";

    const chunk = fullText.substring(idx, idx + 500);
    const firstName = extractFieldValue(chunk, "First Name");
    const lastName = extractFieldValue(chunk, "Last Name");
    if (firstName || lastName) {
      return ((firstName || "") + " " + (lastName || "")).trim();
    }
    return "";
  }

  // ============================================================
  //  SNIPPING MODE
  // ============================================================
  function startSnipMode() {
    if (isSnipping || !isExtensionActive) return;
    isSnipping = true;

    overlayEl = document.createElement("div");
    overlayEl.className = "allo-snip-overlay";

    const banner = document.createElement("div");
    banner.className = "allo-snip-banner";
    banner.innerHTML = `<span>Drag mouse across rows to copy to Excel</span> <span style="background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:4px;font-size:11px;">ESC to cancel</span>`;
    overlayEl.appendChild(banner);

    snipBoxEl = document.createElement("div");
    snipBoxEl.className = "allo-snip-box";
    snipBoxEl.style.display = "none";
    overlayEl.appendChild(snipBoxEl);

    document.body.appendChild(overlayEl);

    let isMouseDown = false;

    overlayEl.addEventListener("mousedown", (e) => {
      isMouseDown = true;
      startX = e.clientX; startY = e.clientY;
      snipBoxEl.style.left = `${startX}px`; snipBoxEl.style.top = `${startY}px`;
      snipBoxEl.style.width = "0px"; snipBoxEl.style.height = "0px";
      snipBoxEl.style.display = "block";
    });

    const onMouseMove = (e) => {
      if (!isMouseDown) return;
      snipBoxEl.style.left = `${Math.min(startX, e.clientX)}px`;
      snipBoxEl.style.top = `${Math.min(startY, e.clientY)}px`;
      snipBoxEl.style.width = `${Math.abs(e.clientX - startX)}px`;
      snipBoxEl.style.height = `${Math.abs(e.clientY - startY)}px`;
    };

    const onMouseUp = (e) => {
      if (!isMouseDown) return;
      isMouseDown = false;
      const rect = {
        left: Math.min(startX, e.clientX), top: Math.min(startY, e.clientY),
        right: Math.max(startX, e.clientX), bottom: Math.max(startY, e.clientY)
      };
      cleanupSnip();
      if ((rect.right - rect.left) > 15 && (rect.bottom - rect.top) > 10) {
        processSelectedArea(rect);
      }
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") { cleanupSnip(); showToast("Cancelled", "No rows selected."); }
    };

    function cleanupSnip() {
      isSnipping = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", onKeyDown);
      if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null; snipBoxEl = null;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown);
  }

  function processSelectedArea(rect) {
    const candidateRows = getAllPossibleRows();
    const selectedRows = candidateRows.filter(row => {
      const r = row.getBoundingClientRect();
      return !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
    });
    if (selectedRows.length === 0) {
      showToast("\u26a0\ufe0f No rows detected", "Drag over the booking rows.");
      return;
    }
    extractAndCopyRows(selectedRows);
  }

  // ============================================================
  //  ROW DETECTION (Fast & Safe)
  // ============================================================
  function getAllPossibleRows() {
    // Bookings-only guard: never return Provider Document / Vehicle rows.
    if (!isBookingPage()) return [];
    let rows = Array.from(document.querySelectorAll("tbody tr"));
    rows = rows.filter(r => !r.querySelector("th") && (r.innerText || "").trim().length > 0);

    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll("table tr"));
      rows = rows.filter(r => !r.querySelector("th") && !r.closest("thead") && (r.innerText || "").trim().length > 0);
    }

    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll('[role="row"], .table-row, .ant-table-row, .MuiTableRow-root'));
      rows = rows.filter(r => (r.innerText || "").trim().length > 0 && !r.closest("thead") && !r.querySelector('[role="columnheader"]'));
    }

    return rows;
  }

  // ============================================================
  //  HEADER MAP (fixes bulk-vs-single mismatch: don't guess columns by position)
  // ============================================================
  function getTableHeaderMap() {
    try {
      const ths = Array.from(document.querySelectorAll("thead th, table thead td, tr th"));
      if (!ths.length) return null;
      const map = { crn: -1, from: -1, to: -1, date: -1, status: -1, action: -1 };
      ths.forEach((th, i) => {
        const t = ((th.innerText || th.textContent) || "").toLowerCase();
        if (/crn|booking.?id|ref/.test(t) && map.crn === -1) map.crn = i;
        else if (/pick.?up|from|source|origin/.test(t) && map.from === -1) map.from = i;
        else if (/drop|to |destination|^to$/.test(t) && map.to === -1) map.to = i;
        else if (/date|time|created/.test(t) && map.date === -1) map.date = i;
        else if (/status/.test(t) && map.status === -1) map.status = i;
        else if (/action|copy/.test(t) && map.action === -1) map.action = i;
      });
      return map;
    } catch (e) { return null; }
  }

  function getCleanCells(rowEl) {
    // Clone so injected Copy-button / checkbox text never pollutes parsing
    try {
      const clone = rowEl.cloneNode(true);
      clone.querySelectorAll(".allo-row-copy-btn, .allo-row-checkbox-wrap, input[type='checkbox'], button").forEach(n => n.remove());
      return Array.from(clone.querySelectorAll("td, [role='cell']")).map(c => (c.innerText || c.textContent || "").trim());
    } catch (e) {
      return Array.from(rowEl.querySelectorAll("td, [role='cell']")).map(c => (c.innerText || "").trim().replace(/\ud83d\udccb\s*Copy/gi, "").trim());
    }
  }

  function digitsOnly(s) { return (s || "").replace(/[^\d]/g, ""); }

  // ============================================================
  //  PARSE ROW (basic info from list page)
  //  NOTE: bulk must parse the SAME row it will enrich \u2014 never guess by index.
  // ============================================================
  function parseBookingRow(rowEl, headerMap) {
    const cleanCells = getCleanCells(rowEl);
    const rawText = cleanCells.join("\n").trim() || ((rowEl.innerText || "").replace(/\ud83d\udccb\s*Copy/gi, "").trim());
    const cells = cleanCells;

    let dateVal = "", timeVal = "", crnVal = "";
    let fromVal = "", toVal = "";
    let statusVal = "";

    // CRN \u2014 prefer the CRN column cell, fall back to 179-pattern in row text
    if (headerMap && headerMap.crn >= 0 && cells[headerMap.crn]) {
      const d = digitsOnly(cells[headerMap.crn]);
      const m = (cells[headerMap.crn].match(/179\d{8,12}/) || d.match(/179\d{8,12}/) || d.match(/\d{10,15}/));
      if (m) crnVal = digitsOnly(m[0] || m);
    }
    if (!crnVal) {
      const crnMatch = rawText.match(/179\d{8,12}/) || rawText.match(/(\d{10,15})/);
      if (crnMatch) crnVal = digitsOnly(crnMatch[1] || crnMatch[0]);
    }

    // Date \u2014 prefer the Date column cell so LKR amounts / other numbers never leak in
    const dateCellText = (headerMap && headerMap.date >= 0 && cells[headerMap.date]) ? cells[headerMap.date] : rawText;
    const dateMatch = dateCellText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/);
    dateVal = dateMatch ? normalizeDate(dateMatch[1]) : todayStr();

    // Time \u2014 prefer the Date column cell (date+time live together), fall back to row text
    const timeMatch = dateCellText.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i) ||
                      dateCellText.match(/(\d{1,2}:\d{2})/) ||
                      rawText.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
    if (timeMatch) timeVal = timeMatch[1].trim();

    // Status \u2014 prefer the Status column cell, fall back to row text
    const statusCellText = (headerMap && headerMap.status >= 0 && cells[headerMap.status]) ? cells[headerMap.status] : rawText;
    if (/completed/i.test(statusCellText)) statusVal = "completed";
    else if (/cancelled|canceled/i.test(statusCellText)) statusVal = "cancelled";
    else if (/pending/i.test(statusCellText)) statusVal = "pending";

    // Addresses \u2014 prefer header-mapped FROM/TO columns (exact), then CRN-relative, then fallback
    if (headerMap && headerMap.from >= 0 && cells[headerMap.from]) fromVal = cleanAddr(cells[headerMap.from]);
    if (headerMap && headerMap.to >= 0 && cells[headerMap.to]) toVal = cleanAddr(cells[headerMap.to]);
    if ((!fromVal || !toVal) && cells.length >= 5) {
      let crnIdx = -1;
      cells.forEach((c, i) => { if (/179\d{8,}|CRN/i.test(c)) crnIdx = i; });
      if (crnIdx !== -1) {
        if (!fromVal && cells[crnIdx + 1]) fromVal = cleanAddr(cells[crnIdx + 1]);
        if (!toVal && cells[crnIdx + 2]) toVal = cleanAddr(cells[crnIdx + 2]);
      }
    }

    // Fallback addresses
    if (!fromVal || !toVal) {
      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 3);
      const addrs = lines.filter(l => {
        if (/^\d{1,4}$/.test(l)) return false;
        if (/CRN|179\d{8,}/i.test(l)) return false;
        if (/LKR|\$|fare|total|estimation/i.test(l)) return false;
        if (/\d{1,2}:\d{2}/.test(l)) return false;
        if (/^(completed|cancelled|canceled|pending)$/i.test(l)) return false;
        return true;
      });
      if (addrs.length >= 2) { fromVal = cleanAddr(addrs[0]); toVal = cleanAddr(addrs[1]); }
      else if (addrs.length === 1) fromVal = cleanAddr(addrs[0]);
    }

    const detailUrl = getDetailUrlFromRow(rowEl);

    return {
      date: dateVal, time: timeVal, crn: crnVal,
      from: fromVal, to: toVal,
      driver: "No Details", user: "No Details",
      vehicle: "-", status: statusVal, note: "",
      userMobile: "No Details", driverMobile: "No Details",
      detailUrl: detailUrl
    };
  }

  // ============================================================
  //  EXTRACT, ENRICH WITH DETAILS, AND COPY
  // ============================================================
  async function extractAndCopyRows(rowElements) {
    clearBulkCancel();
    const parsedData = [];
    const headerMap = getTableHeaderMap();

    // Keep visual top-to-bottom order so pasted rows match what the user sees
    // (single-copy handles one row; bulk must preserve the same order).
    let orderedRows = Array.from(rowElements || []);
    try {
      if (orderedRows.length > 1) {
        orderedRows = orderedRows
          .map((r, i) => ({ r, i, top: (r.getBoundingClientRect ? r.getBoundingClientRect().top : 0) }))
          .sort((a, b) => (a.top - b.top) || (a.i - b.i))
          .map(o => o.r);
      }
    } catch (e) { orderedRows = Array.from(rowElements || []); }

    orderedRows.forEach(r => {
      r.classList.add("allo-row-selected");
      setTimeout(() => r.classList.remove("allo-row-selected"), 5000);
      const item = parseBookingRow(r, headerMap);
      if (item.crn || item.from || item.status) {
        // Store reference element or CRN for click triggering
        item._rowEl = r;
        parsedData.push(item);
      }
    });

    if (parsedData.length === 0) {
      showToast("\u26a0\ufe0f No rows found", "Check your selection.");
      return;
    }

    // Try background fetch first if detail URLs are present
    const withUrl = parsedData.filter(r => r.detailUrl).length;

    if (withUrl > 0) {
      showProgressToast(`\u23f3 Fetching user & driver details... 0/${withUrl}`, "Please wait...");

      let fetched = 0;
      for (let i = 0; i < parsedData.length; i++) {
        if (isBulkCancelRequested()) { handleBulkStopped(true); return; }
        if (!parsedData[i].detailUrl) continue;

        try {
          const details = await fetchBookingDetails(parsedData[i].detailUrl);
          // VERIFY every bulk list: fetched detail CRN must match the list row CRN.
          // If mismatch, do NOT apply \u2014 leave as No Details so queue navigation re-verifies.
          const wantCrn = digitsOnly(parsedData[i].crn || "");
          const gotCrn = digitsOnly((details && details.crn) || "");
          if (wantCrn && gotCrn && wantCrn !== gotCrn) {
            console.warn(`[Allo Exporter] Bulk CRN mismatch: row ${wantCrn} vs fetched ${gotCrn} \u2014 will re-verify via navigation.`);
          } else if (details && (details.userName !== "No Details" || details.driverName !== "No Details")) {
            parsedData[i].user = cleanName(details.userName);
            parsedData[i].driver = cleanName(details.driverName);
            parsedData[i].vehicle = details.vehicleType || "Auto";
            parsedData[i].userMobile = details.userMobile || "No Details";
            parsedData[i].driverMobile = details.driverMobile || "No Details";
          }
        } catch (err) {
          console.error("[Allo Exporter] Detail error:", err);
        }

        fetched++;
        showProgressToast(`\u23f3 Fetching details... ${fetched}/${withUrl}`, `Getting user & driver names...`);

        if (i < parsedData.length - 1) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    // Check if we still have missing details for items
    const missingDetailsCount = parsedData.filter(item => item.user === "No Details" || item.driver === "No Details").length;

    if (missingDetailsCount > 0) {
      // Start bulk queue auto-navigation sequence!
      console.log(`[Allo Exporter] ${missingDetailsCount} items missing details. Starting bulk auto-navigation...`);
      showProgressToast(`\u26a1 Starting multi-row copy...`, `Extracting details for ${parsedData.length} rows...`);

      const queueState = {
        currentIndex: 0,
        listPage: getActivePageNumber(),
        returnUrl: window.location.href,
        items: parsedData.map(item => ({
          date: item.date,
          time: item.time,
          crn: item.crn,
          from: item.from,
          to: item.to,
          driver: item.driver,
          user: item.user,
          vehicle: item.vehicle,
          status: item.status,
          note: item.note,
          userMobile: item.userMobile || "No Details",
          driverMobile: item.driverMobile || "No Details"
        }))
      };

      sessionStorage.setItem("ALLO_BULK_QUEUE", JSON.stringify(queueState));

      // Trigger click on the first row to begin navigation
      const firstItem = parsedData[0];
      const targetRow = firstItem._rowEl || rowElements[0];
      const allTds = Array.from(targetRow.querySelectorAll("td"));
      const clickTarget = allTds.length > 1 ? allTds[1] : allTds[0] || targetRow;
      clickTarget.click();
      return;
    }

    // If all details were successfully fetched in background:
    // Bulk copy in REVERSE so paste lands in list order (user-verified paste behavior).
    const tsvLines = parsedData.slice().reverse().map(item => buildRowTsv(item));

    const clipboardText = tsvLines.join("\r\n");
    const ok = copyToClipboard(clipboardText);

    if (ok) {
      showToast(`\u2705 Copied ${parsedData.length} row(s) as a single table!`, `Press Ctrl+V in Excel now.`);
    } else {
      showModalFallback(clipboardText, parsedData.length);
    }
    // Ensure we stay / end on the same pagination the user copied from
    try {
      const cur = getActivePageNumber();
      if (cur > 1) sessionStorage.setItem("ALLO_RESTORE_PAGE", JSON.stringify({ page: cur, ts: Date.now() }));
    } catch (e) {}
  }

  // ============================================================
  //  UTILITIES
  // ============================================================
  function cleanAddr(s) { return s ? s.replace(/\s+/g, " ").replace(/[\t\r\n]+/g, " ").trim() : ""; }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function normalizeDate(raw) {
    const p = raw.split(/[\/\-]/);
    if (p.length === 3) {
      if (p[2].length === 4) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
      if (p[0].length === 4) return `${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
    }
    return raw;
  }
  function sanitize(v) { return v == null ? "" : String(v).replace(/\t/g," ").replace(/[\r\n]+/g," ").trim(); }

  /**
   * Build a single TSV row string from a data object, applying enabledFields filter.
   * Unchecked fields become "" (blank) so Excel columns stay aligned.
   */
  function buildRowTsv(data) {
    const fieldOrder = ["date", "time", "crn", "from", "to", "driver", "user", "vehicle", "status", "note", "userMobile", "driverMobile"];
    return fieldOrder
      .map(key => {
        if (enabledFields[key] === false) return "";
        let val = sanitize(data[key] || "");
        // Apply extra space removal only if enabled
        if (copySettings.removeExtraSpaces && val) {
          val = val.replace(/\s+/g, " ").trim();
        }
        return val;
      })
      .join("\t");
  }

  function copyToClipboard(text) {
    let ok = false;
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly","");
      ta.style.cssText = "position:absolute;left:-9999px;top:" + (window.pageYOffset || 0) + "px;";
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand("copy"); document.body.removeChild(ta);
    } catch(e) {}
    if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast("\u2705 Copied!","Ctrl+V in Excel")).catch(() => showModalFallback(text));
      return true;
    }
    return ok;
  }

  function showModalFallback(text, count = 1) {
    let m = document.getElementById("allo-copy-modal");
    if (!m) { m = document.createElement("div"); m.id = "allo-copy-modal"; document.body.appendChild(m); }
    m.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:-apple-system,sans-serif;";
    m.innerHTML = `<div style="background:#0f172a;color:#fff;padding:22px;border-radius:12px;max-width:520px;width:92%;box-shadow:0 20px 35px rgba(0,0,0,.5);border:1px solid #334155;">
      <h3 style="margin:0 0 8px;color:#38bdf8;">\ud83d\udccb ${count} Rows Ready</h3>
      <p style="font-size:13px;color:#94a3b8;margin:0 0 12px;">Click <b>Copy Now</b>, then <b>Ctrl+V</b> in Excel:</p>
      <textarea id="allo-mt" style="width:100%;height:110px;background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:6px;padding:10px;font-family:monospace;font-size:12px;box-sizing:border-box;margin-bottom:14px;" readonly>${text}</textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button id="allo-mc" style="background:#334155;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;">Close</button>
        <button id="allo-mb" style="background:#2563eb;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-weight:600;">Copy Now</button>
      </div></div>`;
    document.getElementById("allo-mt").select();
    document.getElementById("allo-mb").onclick = () => { document.getElementById("allo-mt").select(); document.execCommand("copy"); showToast("\u2705 Copied!","Ctrl+V in Excel."); m.style.display="none"; };
    document.getElementById("allo-mc").onclick = () => { m.style.display="none"; };
  }

  // Copy all visible rows
  function copyAllVisibleBookings() {
    const rows = getAllPossibleRows();
    if (rows.length === 0) { showToast("\u26a0\ufe0f No rows found", "Open the Bookings page."); return; }
    extractAndCopyRows(rows);
  }

  // Toggle checkboxes
  let checkboxesActive = false;
  function toggleRowCheckboxes() {
    checkboxesActive = !checkboxesActive;
    const allCbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    allCbs.forEach(cb => {
      if (!cb.dataset.alloBound) {
        cb.dataset.alloBound = "true";
        cb.addEventListener("click", (e) => { e.stopPropagation(); });
        cb.addEventListener("mousedown", (e) => { e.stopPropagation(); });
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          const row = cb.closest("tr") || cb.closest('[role="row"]');
          if (row && !row.closest("thead")) {
            if (cb.checked) row.classList.add("allo-row-selected");
            else row.classList.remove("allo-row-selected");
            updateBadgeCount();
          }
        });
      }
    });
    const rows = getAllPossibleRows();
    rows.forEach(r => {
      let ex = r.querySelector(".allo-row-checkbox-wrap");
      if (ex) { ex.style.display = checkboxesActive ? "inline-flex" : "none"; }
      else if (checkboxesActive && !r.querySelector('input[type="checkbox"]')) {
        const w = document.createElement("span"); 
        w.className = "allo-row-checkbox-wrap";
        w.addEventListener("click", (e) => { e.stopPropagation(); });
        w.addEventListener("mousedown", (e) => { e.stopPropagation(); });
        const cb = document.createElement("input"); 
        cb.type = "checkbox"; 
        cb.className = "allo-row-checkbox";
        cb.dataset.alloBound = "true";
        cb.addEventListener("click", (e) => { e.stopPropagation(); });
        cb.addEventListener("mousedown", (e) => { e.stopPropagation(); });
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          if (cb.checked) r.classList.add("allo-row-selected"); else r.classList.remove("allo-row-selected");
          updateBadgeCount();
        });
        w.appendChild(cb); 
        const firstCell = r.querySelector("td, [role='cell']");
        if (firstCell) {
          firstCell.insertBefore(w, firstCell.firstChild);
        } else {
          r.children.length > 0 ? r.insertBefore(w, r.firstChild) : r.appendChild(w);
        }
      }
    });
    const btn = document.getElementById("allo-copy-selected-btn");
    if (btn) btn.style.display = checkboxesActive ? "inline-flex" : "none";
    updateBadgeCount();
    if (checkboxesActive) showToast("\u2611\ufe0f Checkboxes Active", "Check rows \u2192 Copy Selected.");
  }

  function updateBadgeCount() {
    const cbs = Array.from(document.querySelectorAll('tbody input[type="checkbox"]:checked, table input[type="checkbox"]:checked'));
    cbs.forEach(cb => { const r = cb.closest("tr"); if (r && !r.closest("thead")) r.classList.add("allo-row-selected"); });
    const c = document.querySelectorAll(".allo-row-selected").length;
    const b = document.getElementById("allo-selected-count");
    if (b) b.innerText = c;
    const btn = document.getElementById("allo-copy-selected-btn");
    if (btn && checkboxesActive) btn.style.display = "inline-flex";
  }

  // Toast
  function showToast(title, sub) {
    let t = document.getElementById("allo-toast-msg");
    if (!t) { t = document.createElement("div"); t.id = "allo-toast-msg"; t.className = "allo-toast"; document.body.appendChild(t); }
    t.innerHTML = `<div class="allo-toast-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>${title}</div><div class="allo-toast-sub">${sub}</div>`;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 4000);
  }

  //  BULK STOP / CANCEL (Stop button survives detail-page navigations)
  //  Uses BOTH sessionStorage (fast path) and chrome.storage.local (survives
  //  rapid navigations / new document before sessionStorage syncs).
  //  NOTE: bulkCancelMemory is declared at top of IIFE for early listeners.
  function isBulkCancelRequested() {
    if (bulkCancelMemory) return true;
    try { if (sessionStorage.getItem("ALLO_BULK_CANCEL") === "1") return true; } catch (e) {}
    return false;
  }
  function isBulkCancelRequestedSync() { return isBulkCancelRequested(); }
  function requestBulkCancel() {
    bulkCancelMemory = true;
    try { sessionStorage.setItem("ALLO_BULK_CANCEL", "1"); } catch (e) {}
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ alloBulkCancel: 1 });
      }
    } catch (e) {}
  }
  function clearBulkCancel() {
    bulkCancelMemory = false;
    try { sessionStorage.removeItem("ALLO_BULK_CANCEL"); } catch (e) {}
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove("alloBulkCancel");
      }
    } catch (e) {}
  }
  // Early boot: if a previous page requested cancel, hydrate memory ASAP
  try {
    if (sessionStorage.getItem("ALLO_BULK_CANCEL") === "1") bulkCancelMemory = true;
  } catch (e) {}
  try {
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get({ alloBulkCancel: 0 }, (d) => {
        if (d && d.alloBulkCancel) {
          bulkCancelMemory = true;
          try { sessionStorage.setItem("ALLO_BULK_CANCEL", "1"); } catch (e) {}
          handleBulkStopped(true);
        }
      });
    }
  } catch (e) {}
  // Re-assert cancel across rapid navigations: if queued work exists but cancel
  // was requested, stop immediately instead of clicking / navigating further.
  setInterval(() => {
    try {
      if (isBulkCancelRequestedSync() &&
          (sessionStorage.getItem("ALLO_BULK_QUEUE") || sessionStorage.getItem("ALLO_PENDING_COPY"))) {
        handleBulkStopped(true);
      }
    } catch (e) {}
  }, 200);
  // Keep the Stop button alive across rapid DOM swaps: navigation destroys DOM,
  // so re-create it whenever a queue exists and no button is present.
  function keepStopButtonAlive() {
    try {
      const hasQueue = (() => {
        try { return !!(sessionStorage.getItem("ALLO_BULK_QUEUE") || sessionStorage.getItem("ALLO_PENDING_COPY")); }
        catch (e) { return false; }
      })();
      if (hasQueue) ensureStopBulkButton();
    } catch (e) {}
  }
  setInterval(keepStopButtonAlive, 500);
  function hideProgressToast() {
    const t = document.getElementById("allo-toast-msg");
    if (t) t.classList.remove("show");
  }
  function handleBulkStopped(showMsg) {
    try { sessionStorage.removeItem("ALLO_BULK_QUEUE"); } catch (e) {}
    try { sessionStorage.removeItem("ALLO_PENDING_COPY"); } catch (e) {}
    clearBulkCancel();
    hideProgressToast();
    // Kill any in-flight polling / click timers (safe: handles undefined)
    try { if (typeof clickTimer !== "undefined" && clickTimer) clearInterval(clickTimer); } catch (e) {}
    try { if (typeof pollTimer !== "undefined" && pollTimer) clearInterval(pollTimer); } catch (e) {}
    try {
      document.querySelectorAll(".allo-row-selected").forEach(r => r.classList.remove("allo-row-selected"));
    } catch (e) {}
    try {
      const s = document.getElementById("allo-stop-bulk-btn");
      if (s) s.remove();
    } catch (e) {}
    if (showMsg !== false) showToast("\u26d4 Bulk copy stopped", "Partial rows were NOT copied. Start again when ready.");
  }

  function showProgressToast(title, sub) {
    let t = document.getElementById("allo-toast-msg");
    if (!t) { t = document.createElement("div"); t.id = "allo-toast-msg"; t.className = "allo-toast"; document.body.appendChild(t); }
    t.innerHTML = `<div class="allo-toast-header"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5" class="allo-spinner"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>${title}</div><div class="allo-toast-sub">${sub}</div>`;
    t.classList.add("show");
    ensureStopBulkButton();
  }

  // Persistent floating Stop button shown during any bulk run
  function ensureStopBulkButton() {
    try {
      let hasQueue = false;
      try {
        hasQueue = !!(sessionStorage.getItem("ALLO_BULK_QUEUE") || sessionStorage.getItem("ALLO_PENDING_COPY"));
      } catch (e) {}
      if (!hasQueue) {
        const old = document.getElementById("allo-stop-bulk-btn");
        if (old) old.remove();
        return;
      }
      if (document.getElementById("allo-stop-bulk-btn")) return;
      const b = document.createElement("button");
      b.id = "allo-stop-bulk-btn";
      b.textContent = "\u26d4 Stop Copy";
      b.title = "Stop the ongoing bulk copy";
      b.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#dc2626;color:#fff;border:none;border-radius:9999px;padding:10px 22px;font-size:13.5px;font-weight:700;cursor:pointer;box-shadow:0 10px 25px rgba(0,0,0,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestBulkCancel();
        handleBulkStopped(true);
      });
      document.body.appendChild(b);
    } catch (e) {}
  }

  // Safely debounce DOM mutation updates to prevent browser freeze / infinite loops
  let domUpdateTimer = null;
  const obs = new MutationObserver((mutations) => {
    if (!isExtensionActive) return;

    // Ignore mutations triggered solely by our own elements
    const isOnlyOurChange = mutations.every(m => {
      return Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).every(n => {
        return n.nodeType === 1 && (n.classList.contains("allo-row-copy-btn") || n.classList.contains("allo-row-checkbox-wrap") || n.classList.contains("allo-row-checkbox") || n.id === "allo-floating-panel" || n.id === "allo-stop-bulk-btn" || n.classList.contains("allo-snip-box") || n.classList.contains("allo-toast"));
      });
    });
    if (isOnlyOurChange) return;

    if (domUpdateTimer) clearTimeout(domUpdateTimer);
    domUpdateTimer = setTimeout(() => {
      if (isExtensionActive) {
        syncVisibility();
        if (isBookingPage()) {
          initFloatingControl();
          injectRowCopyButtons();
          if (typeof checkboxesActive !== "undefined" && checkboxesActive) updateBadgeCount();
        }
      }
    }, 400);
  });
  obs.observe(document.body, { childList: true, subtree: true });

  // Init
  const runInit = () => {
    syncVisibility();
    if (isBookingPage()) {
      initFloatingControl();
      injectRowCopyButtons();
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", runInit);
  else runInit();
})();
