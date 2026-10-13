// ALLO POI page-hook — runs in PAGE (MAIN) world so it shares the
// page's own google.maps namespace (Angular <google-map mapId>).
// Content scripts are ISOLATED and cannot wrap the page's Map ctor.
// Terminal-safe: `node poi-page-hook.js` exits quietly (browser-only).
if (typeof window === "undefined" || typeof document === "undefined") {
  try {
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
      console.log("[Allo Exporter] poi-page-hook.js is a browser script - skipping execution under Node.");
    }
  } catch (e) {}
} else {
  (function () {
  if (window.__alloPoiPageHook) return;
  window.__alloPoiPageHook = true;

  function getText(v) {
    if (v == null) return "";
    try {
      if (typeof v === "string") return v;
      if (typeof v === "number") return String(v);
      if (v.text) return String(v.text);
      if (v.string) return String(v.string);
      var s = v.toString();
      if (s && s !== "[object Object]") return s;
    } catch (e) {}
    return "";
  }

  // placeId -> real venue name (NOT plus-code).
  // Chain: new Places Place -> legacy PlacesService.getDetails ->
  // nearbySearch around the tap -> Geocoder (last resort).
  function resolveName(placeId, latLng, cb) {
    try {
      if (window.google && google.maps && google.maps.importLibrary) {
        google.maps.importLibrary("places").then(function (lib) {
          try {
            var p = new lib.Place({ id: placeId });
            p.fetchFields({ fields: ["displayName", "formattedAddress"] }).then(function () {
              var nm = getText(p.displayName);
              var ad = getText(p.formattedAddress);
              if (nm && !isPlusCode(nm)) { cb(nm, ad); return; }
              // New API gave plus-code / empty -> try legacy details
              legacyDetails(placeId, latLng, nm, ad, cb);
            }).catch(function () { legacyDetails(placeId, latLng, "", "", cb); });
          } catch (e) { legacyDetails(placeId, latLng, "", "", cb); }
        }).catch(function () { legacyDetails(placeId, latLng, "", "", cb); });
      } else { legacyDetails(placeId, latLng, "", "", cb); }
    } catch (e) { legacyDetails(placeId, latLng, "", "", cb); }
  }

  function isPlusCode(s) {
    if (!s) return true;
    var t = String(s).trim();
    if (/^[A-Z0-9]{4}\+[A-Z0-9]{2,}/i.test(t)) return true;
    if (/^.+,\s*Sri Lanka$/i.test(t) && /^[A-Z0-9]{4}\+/.test(t)) return true;
    if (/^[A-Z0-9]{4}\+.*vavuniya/i.test(t)) return true;
    return false;
  }

  function legacyDetails(placeId, latLng, fallbackNm, fallbackAd, cb) {
    try {
      if (window.google && google.maps && google.maps.places && google.maps.places.PlacesService) {
        var div = document.createElement("div");
        var svc = new google.maps.places.PlacesService(div);
        svc.getDetails(
          { placeId: placeId, fields: ["name", "formatted_address", "vicinity", "plus_code"] },
          function (res, st) {
            try {
              var ok = (st === google.maps.places.PlacesServiceStatus.OK);
              var nm = (ok && res && (res.name || "")) ? String(res.name) : "";
              var ad = (ok && res && (res.formatted_address || res.vicinity || "")) ? String(res.formatted_address || res.vicinity) : "";
              if (nm && !isPlusCode(nm)) { cb(nm, ad || fallbackAd); return; }
            } catch (e) {}
            // Details still plus-code -> nearby search for real venue
            nearbyVenue(latLng, fallbackNm, fallbackAd, cb);
          }
        );
        return;
      }
    } catch (e) {}
    nearbyVenue(latLng, fallbackNm, fallbackAd, cb);
  }

  function nearbyVenue(latLng, fallbackNm, fallbackAd, cb) {
    try {
      if (window.google && google.maps && google.maps.places && google.maps.places.PlacesService && latLng) {
        var div = document.createElement("div");
        var svc = new google.maps.places.PlacesService(div);
        svc.nearbySearch({ location: latLng, radius: 60 }, function (res, st) {
          try {
            if (st === google.maps.places.PlacesServiceStatus.OK && res && res.length) {
              for (var i = 0; i < res.length; i++) {
                var nm = (res[i].name || "").toString();
                if (nm && !isPlusCode(nm)) {
                  var ad = "";
                  try { ad = (res[i].vicinity || "").toString(); } catch (e) {}
                  cb(nm, ad || fallbackAd);
                  return;
                }
              }
            }
          } catch (e) {}
          geoFallback(placeIdGlobal(), latLng, fallbackNm, fallbackAd, cb);
        });
        return;
      }
    } catch (e) {}
    geoFallback(placeIdGlobal(), latLng, fallbackNm, fallbackAd, cb);
  }

  var _lastPid = "";
  function placeIdGlobal() { return _lastPid || ""; }

  function geoFallback(placeId, latLng, fallbackNm, fallbackAd, cb) {
    // Keep a real venue name if we already had one, even if plus-code-ish
    // address is all the geocoder can add.
    if (fallbackNm && !isPlusCode(fallbackNm)) { cb(fallbackNm, fallbackAd); return; }
    try {
      if (placeId) {
        var g = new google.maps.Geocoder();
        g.geocode({ placeId: placeId }, function (res, st) {
          if (st === "OK" && res && res[0]) {
            var full = res[0].formatted_address || "";
            // Geocoder only returns address — keep plus-code out of the NAME slot
            cb(fallbackNm && !isPlusCode(fallbackNm) ? fallbackNm : "Unknown place", full);
          } else if (fallbackNm) { cb(fallbackNm, fallbackAd); }
          else { cb("Unknown place", ""); }
        });
        return;
      }
    } catch (e) {}
    if (fallbackNm) cb(fallbackNm, fallbackAd);
    else cb("Unknown place", "");
  }

  function esc(s) { return String(s == null ? "" : s).replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

  function openBubble(map, latLng, placeId) {
    try { _lastPid = placeId || ""; } catch (e) {}
    var iw;
    try { iw = new google.maps.InfoWindow(); } catch (e) { return; }
    // Loading state (instant feedback). Tagged so content.js's observer
    // skips OUR bubble and never injects a second Copy row.
    var loading = document.createElement("div");
    loading.setAttribute("data-allo-bubble", "1");
    loading.innerHTML = '<div style="font-weight:700;font-size:14px;">Loading place&#8230;</div>';
    try {
      iw.setOptions({ position: latLng, pixelOffset: new google.maps.Size(0, -30) });
      iw.setContent(loading);
      iw.open(map);
      try { map.panTo(latLng); } catch (e) {}
    } catch (e) {}
    resolveName(placeId, latLng, function (name, addr) {
      // Native default look: place name in the built-in header (bold +
      // Google's ✕ close button), address + placeId in the body. No custom
      // card styling, no Copy button — matches the stock Maps POI window.
      var nameEl = document.createElement("div");
      nameEl.style.fontWeight = "bold";
      nameEl.style.fontSize = "medium";
      nameEl.textContent = name || "";

      var content = document.createElement("div");
      var addressEl = document.createElement("div");
      addressEl.textContent = addr || "";
      var idEl = document.createElement("div");
      idEl.textContent = placeId || "";
      content.appendChild(addressEl);
      content.appendChild(idEl);
      // No copy button — the name auto-copies when the popup opens.
      // Tag so content.js observer skips OUR bubble (no double popup).
      content.setAttribute("data-allo-bubble", "1");

      try {
        iw.setOptions({
          position: latLng,
          pixelOffset: new google.maps.Size(0, -30),
          headerContent: nameEl,
          content: content,
        });
        try { map.panTo(latLng); } catch (e) {}
        iw.open(map);
      } catch (e) {}

      // Auto-copy the resolved name to clipboard as soon as the popup opens —
      // no copy button in the bubble; content.js does the copy + toast.
      try { window.postMessage({ type: "ALLO_POI_COPIED", name: name }, "*"); } catch (e) {}
    });
  }

  // Auto-copy only — opens NO InfoWindow, so a place click produces a single
  // popup (the "Copied Place Name!" toast) instead of bubble + toast.
  function silentCopy(map, latLng, placeId) {
    try {
      resolveName(placeId, latLng, function (name, addr) {
        try {
          if (name && !isPlusCode(name)) {
            try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(name); } catch (e) {}
            try { window.postMessage({ type: "ALLO_POI_COPIED", name: name }, "*"); } catch (e) {}
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function attach(map) {
    if (!map || map.__alloPoiAttached) return;
    try {
      if (!map.addListener) return;
      map.__alloPoiAttached = true;
      map.addListener("click", function (ev) {
        try {
          if (ev && ev.placeId) {
            try { ev.stop && ev.stop(); } catch (e) {}
            openBubble(map, ev.latLng, ev.placeId);
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  function wrapCtor() {
    try {
      if (window.google && google.maps && google.maps.Map && !google.maps.Map.__alloWrapped) {
        var Orig = google.maps.Map;
        var W = function (el, opts) {
          var m = null;
          try { m = new Orig(el, opts); } catch (e) { return m; }
          try { attach(m); } catch (e) {}
          return m;
        };
        W.prototype = Orig.prototype;
        for (var k in Orig) { try { W[k] = Orig[k]; } catch (e) {} }
        W.__alloWrapped = true;
        try { google.maps.Map = W; } catch (e) {}
        return true;
      }
    } catch (e) {}
    return false;
  }

  function scan() {
    wrapCtor();
    try {
      var gm = document.querySelector("google-map, gmp-map");
      if (gm) {
        var props = ["_map", "map", "googleMap", "_googleMap", "googleMapsMap"];
        for (var i = 0; i < props.length; i++) {
          try {
            var v = gm[props[i]];
            if (v && v.addListener && v.panTo) attach(v);
          } catch (e) {}
        }
        try {
          for (var p in gm) {
            try {
              var q = gm[p];
              if (q && q.addListener && q.panTo && q.getCenter) attach(q);
            } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  scan();
  var n = 0;
  var t = setInterval(function () {
    try { scan(); } catch (e) {}
    if (++n > 120) clearInterval(t);
  }, 1000);
  try {
    var dt = null;
    new MutationObserver(function () {
      clearTimeout(dt);
      dt = setTimeout(scan, 300);
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  })();
}
