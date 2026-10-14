/**
 * Allo Booking Exporter - Google Maps POI Copy Feature
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.MapsPoi = window.Allo.Features.MapsPoi || {};

  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;
  const Clipboard = window.Allo.Utils.Clipboard;

  let _lastPoiName = "";
  let _poiPageHookInjected = false;

  // Bridge: page-hook posts ALLO_POI_COPIED / ALLO_POI_OPENED.
  // Toast + clipboard live here in the content-script world.
  try {
    window.addEventListener("message", function (ev) {
      try {
        var d = ev && ev.data;
        if (!d || (d.type !== "ALLO_POI_COPIED" && d.type !== "ALLO_POI_OPENED")) return;
        if (!State.isExtensionActive) return;
        var nm = d.name || "";
        if (/map data ©|open this area|keyboard shortcuts|report a map error|terms of use|^terms$/i.test(nm)) return;
        if (d.type === "ALLO_POI_COPIED") {
          if (nm) {
            try { Clipboard.copyToClipboard(nm); } catch (e) {}
            DOM.showToast("Copied Place Name!", nm);
          }
        } else if (d.type === "ALLO_POI_OPENED") {
          // Floating chip removed: the name auto-copies on bubble open
          // (ALLO_POI_COPIED above) so a second "📍 Place" chip is redundant.
          // Do nothing here — one popup (the Copied toast) is enough.
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

  function startPoiHookInjectionLoop() {
    try { injectPoiPageHook(); } catch (e) {}
    try {
      var _injN = 0;
      var _injT = setInterval(function () {
        _poiPageHookInjected = false;
        try { injectPoiPageHook(); } catch (e) {}
        if (++_injN > 5) clearInterval(_injT);
      }, 2000);
    } catch (e) {}
  }

  function showPoiFloatChip(placeName) {
    // Disabled: the place-click popup (poi-page-hook.js openBubble) now
    // opens its own InfoWindow and auto-copies the name, so this floating
    // chip was a redundant SECOND popup. Keep the fn as a no-op for compat.
    return;
  }

  function hidePoiFloatChip() {
    try {
      var chip = document.getElementById("allo-poi-float-chip");
      if (chip) chip.style.display = "none";
    } catch (e) {}
  }

  function processMapInfoWindows() {
    if (!State.isExtensionActive) return;
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

    // Strategy 1: ONLY real Google Maps link anchors — never generic
    // a[target="_blank"] (that was hijacking normal clicks / cards).
    // EXCLUDE map footer chrome: "Open this area in Google Maps" link,
    // Terms / Map Data / keyboard-shortcut controls live in
    // .gmnoprint / .gm-style-cc / .gmnoscreen — those are NOT popups.
    const mapLinks = Array.from(document.querySelectorAll('a[href*="maps.google"], a[href*="google.com/maps"]'))
      .filter(function (a) {
        try {
          var lbl = ((a.getAttribute("aria-label") || "") + " " + (a.getAttribute("title") || "")).toLowerCase();
          if (lbl.indexOf("open this area") !== -1) return false;
          if (a.closest(".gmnoprint, .gm-style-cc, .gmnoscreen, .gm-bundled-control, gmp-internal-camera-control")) return false;
        } catch (e) {}
        return true;
      });

    // Strategy 2: Maps popup containers — search WHOLE document (not just
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
    // Plus: fallback — any small white bubble card containing the open-in-new
    // icon (title + address + ↗ blue icon on the right).
    const cards = [];

    mapLinks.forEach(link => {
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
    // title + locality text.
    try {
      var allDivs = Array.from(document.querySelectorAll("div"));
      for (var di = 0; di < allDivs.length; di++) {
        var d = allDivs[di];
        if (cards.includes(d)) continue;
        var dt = (d.innerText || "").trim();
        if (!dt || dt.length > 200 || dt.length < 3) continue;
        var lines = dt.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
        if (lines.length < 1 || lines.length > 4) continue;
        var hasIcon = !!(d.querySelector('button, a[href*="maps"], a[href*="google.com/maps"], [aria-label*="map" i]'));
        if (!hasIcon) continue;
        if (!/sri lanka|vavuniya|\+[A-Z0-9]{2,}/i.test(dt)) continue;
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

      let titleEl = null;
      try {
        titleEl = card.querySelector("h1, h2, h3, h4");
        if (titleEl && (titleEl.innerText || "").length > 80) titleEl = null;
      } catch (e) { titleEl = null; }

      const textLines = (card.innerText || "")
        .split("\n")
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/^(map|satellite|zoom|close|terms|google|keyboard shortcuts|map data|terms of use|report a map error|\+|\-)$/i.test(s) && !/map data ©/i.test(s) && !/^terms$/i.test(s));

      if (textLines.length === 0 && !titleEl) return;

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
        } catch (e) {}
      }

      let cleanName = titleEl ? (titleEl.innerText || "").trim().split("\n")[0].trim() : textLines[0];
      if (!cleanName && textLines.length) cleanName = textLines[0];
      if (cleanName.includes("|")) {
        cleanName = cleanName.split("|")[0].trim();
      }

      if (!cleanName || cleanName.length < 2) return;

      // Skip OUR OWN bubble (page-hook InfoWindow content)
      try {
        if (card.querySelector && card.querySelector("[data-allo-bubble], [data-allo-copy]")) return;
        if (card.hasAttribute && (card.hasAttribute("data-allo-bubble") || card.hasAttribute("data-allo-copy"))) return;
      } catch (e) {}

      // REJECT map footer / chrome text
      if (/map data ©|open this area|keyboard shortcuts|report a map error|terms of use|^terms$/i.test(cleanName)) return;
      if (/map data ©|open this area|keyboard shortcuts|report a map error/i.test((card.innerText || ""))) {
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
      copyBtn.textContent = "⧉ Copy";
      copyBtn.style.cssText = "display:inline-flex !important;align-items:center;justify-content:center;height:24px;padding:0 8px;margin-left:6px;background:#0284c7;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;vertical-align:middle;position:relative;z-index:2147483647;white-space:nowrap;";
      copyBtn.onmousedown = function (e) { e.stopPropagation(); };
      copyBtn.onmouseover = function () { copyBtn.style.background = "#0369a1"; };
      copyBtn.onmouseout = function () { if (copyBtn.textContent !== "✓ Copied") copyBtn.style.background = "#0284c7"; };
      copyBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var nm = copyBtn.dataset.placename || cleanName;
        Clipboard.copyToClipboard(nm);
        DOM.showToast("Copied Place Name!", nm);
        copyBtn.textContent = "✓ Copied";
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

      _lastPoiName = cleanName;
      try { showPoiFloatChip(cleanName); } catch (e) {}
    });

    try {
      if (cards.length === 0) hidePoiFloatChip();
    } catch (e) {}
  }

  // Monitor POI map popups with both MutationObserver and high-frequency interval (exact v1 behavior)
  try {
    const poiObs = new MutationObserver(() => {
      clearTimeout(poiObs._t);
      poiObs._t = setTimeout(processMapInfoWindows, 80);
    });
    poiObs.observe(document.body, { childList: true, subtree: true });
    setInterval(processMapInfoWindows, 200);
  } catch (e) {}

  window.Allo.Features.MapsPoi = {
    showPoiFloatChip,
    hidePoiFloatChip,
    processMapInfoWindows,
    injectPoiPageHook,
    startPoiHookInjectionLoop
  };
})();
