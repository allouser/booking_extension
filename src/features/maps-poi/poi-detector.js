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

  function showPoiFloatChip(placeName) {
    if (!placeName) return;
    _lastPoiName = placeName;
    let chip = document.getElementById("allo-poi-float-chip");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "allo-poi-float-chip";
      chip.style.cssText =
        "position:fixed;bottom:24px;left:24px;z-index:2147483646;" +
        "background:#0f172a;color:#f8fafc;padding:8px 14px;border-radius:10px;" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
        "font-size:12.5px;box-shadow:0 10px 25px rgba(0,0,0,.45);border:1px solid #334155;" +
        "display:flex;align-items:center;gap:10px;animation:allo-pop .18s ease-out;" +
        "max-width:440px;";
      document.body.appendChild(chip);
    }
    chip.innerHTML =
      '<span style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
      '<span style="color:#38bdf8;font-weight:700;">📍 Place:</span> ' +
      '<strong style="color:#fff;" title="' + placeName.replace(/"/g, '&quot;') + '">' + placeName + '</strong>' +
      '</span>' +
      '<button id="allo-poi-float-copy" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer;flex-shrink:0;">📋 Copy</button>' +
      '<button id="allo-poi-float-close" style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:14px;padding:0 2px;">✕</button>';

    const copyBtn = chip.querySelector("#allo-poi-float-copy");
    if (copyBtn) {
      copyBtn.onclick = function (e) {
        e.stopPropagation();
        Clipboard.copyToClipboard(placeName);
        DOM.showToast("📋 Copied Place Name", placeName);
      };
    }
    const closeBtn = chip.querySelector("#allo-poi-float-close");
    if (closeBtn) {
      closeBtn.onclick = function (e) {
        e.stopPropagation();
        hidePoiFloatChip();
      };
    }
  }

  function hidePoiFloatChip() {
    const chip = document.getElementById("allo-poi-float-chip");
    if (chip) chip.remove();
  }

  function processMapInfoWindows() {
    if (!State.isExtensionActive) return;
    let topHref = "";
    try { topHref = window.top.location.href; } catch (e) { topHref = window.location.href; }
    let selfHref = "";
    try { selfHref = window.location.href; } catch (e) { selfHref = ""; }

    const onDetailTop = /bookingsView/i.test(topHref) || /bookingsView/i.test(selfHref);
    if (!onDetailTop) {
      let looksLikeMap = false;
      try { looksLikeMap = !!document.querySelector(".gm-style"); } catch (e) {}
      if (!looksLikeMap) return;
    }

    const mapLinks = Array.from(document.querySelectorAll('a[href*="maps.google"], a[href*="google.com/maps"]'))
      .filter(function (a) {
        try {
          const lbl = ((a.getAttribute("aria-label") || "") + " " + (a.getAttribute("title") || "")).toLowerCase();
          if (lbl.indexOf("open this area") !== -1) return false;
          if (a.closest(".gmnoprint, .gm-style-cc, .gmnoscreen, .gm-bundled-control, gmp-internal-camera-control")) return false;
        } catch (e) {}
        return true;
      });

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

    cards.forEach(card => {
      if (!card) return;
      if (card.querySelector && card.querySelector("[data-allo-bubble], [data-allo-copy]")) return;
      if (card.hasAttribute && (card.hasAttribute("data-allo-bubble") || card.hasAttribute("data-allo-copy"))) return;

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

      let cleanName = titleEl ? (titleEl.innerText || "").trim().split("\n")[0].trim() : textLines[0];
      if (!cleanName && textLines.length) cleanName = textLines[0];
      if (cleanName.includes("|")) cleanName = cleanName.split("|")[0].trim();
      if (!cleanName || cleanName.length < 2) return;

      if (cleanName !== _lastPoiName) showPoiFloatChip(cleanName);

      if (card.querySelector(".allo-poi-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "allo-poi-copy-btn";
      btn.type = "button";
      btn.setAttribute("data-allo-copy", "1");
      btn.innerHTML = "<span>📋 Copy</span>";
      btn.style.cssText =
        "background:#2563eb;color:#fff;border:none;border-radius:4px;padding:3px 8px;" +
        "font-size:11px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;" +
        "gap:4px;box-shadow:0 1px 3px rgba(0,0,0,.2);margin:4px 0 4px 6px;vertical-align:middle;";

      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        e.preventDefault();
        Clipboard.copyToClipboard(cleanName);
        DOM.showToast("📋 Copied Place Name", cleanName);
      });

      if (titleEl && titleEl.parentElement) {
        titleEl.parentElement.appendChild(btn);
      } else {
        card.appendChild(btn);
      }
    });
  }

  function injectPoiPageHook() {
    try {
      if (document.getElementById("allo-poi-page-hook")) return;
      const s = document.createElement("script");
      s.id = "allo-poi-page-hook";
      s.src = chrome.runtime.getURL("poi-page-hook.js");
      s.onload = function () { this.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  window.Allo.Features.MapsPoi = {
    showPoiFloatChip,
    hidePoiFloatChip,
    processMapInfoWindows,
    injectPoiPageHook
  };
})();
