/**
 * Allo Booking Exporter - Page Detection & URL Monitoring
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Core = window.Allo.Core || {};

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

      // Fallback: any row containing 179 + CRN pattern
      const bodyText = (document.body.innerText || "").slice(0, 20000);
      return /crn[\s\S]{0,40}179\d{8,}/i.test(bodyText);
    } catch (e) {
      return false;
    }
  }

  function isBookingPage() {
    const href = window.location.href.toLowerCase();
    const path = window.location.pathname.toLowerCase();

    // 1. Explicit NON-booking paths FIRST (Providers, Users, Dashboard, etc.)
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

    // 3. Fallback check for URL query string or hash
    if (
      href.includes("booking") ||
      href.includes("ride-later") ||
      href.includes("statement")
    ) {
      return true;
    }

    // 4. Check active sidebar item
    const activeNav = document.querySelector(
      ".sidebar .active, .nav-item.active, .nav-link.active, a.active, li.active > a, [class*='active']"
    );
    if (activeNav) {
      const navText = (activeNav.innerText || "").toLowerCase();
      if (navText.includes("provider") || navText.includes("user") || navText.includes("dashboard")) {
        return false;
      }
      if ((navText.includes("booking") || navText.includes("ride later")) && hasBookingTableFingerprint()) {
        return true;
      }
    }

    // 5. Check main page headings
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, .page-title, .title"));
    for (const h of headings) {
      const txt = (h.innerText || "").toLowerCase();
      if (txt.includes("provider") || txt.includes("user") || txt.includes("dashboard")) return false;
    }
    for (const h of headings) {
      const txt = (h.innerText || "").toLowerCase();
      if ((txt.includes("booking") || txt.includes("ride later")) && hasBookingTableFingerprint()) {
        return true;
      }
    }

    return false;
  }

  let onUrlChangeCallbacks = [];
  let lastObservedUrl = window.location.href;

  function onUrlChange(callback) {
    if (typeof callback === "function") {
      onUrlChangeCallbacks.push(callback);
    }
  }

  function handleUrlChange() {
    if (window.location.href !== lastObservedUrl) {
      lastObservedUrl = window.location.href;
      onUrlChangeCallbacks.forEach(cb => {
        try { cb(lastObservedUrl, true); } catch (e) {}
      });
    } else {
      // Periodic check for same-URL tab swaps
      onUrlChangeCallbacks.forEach(cb => {
        try { cb(lastObservedUrl, false); } catch (e) {}
      });
    }
  }

  function initUrlMonitoring() {
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
    setInterval(handleUrlChange, 60);
  }

  window.Allo.Core.PageDetector = {
    isBookingPage,
    hasBookingTableFingerprint,
    onUrlChange,
    initUrlMonitoring
  };
})();
