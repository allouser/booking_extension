/**
 * Allo Booking Exporter - Pagination & Navigation State Helpers
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.BulkQueue = window.Allo.Features.BulkQueue || {};

  const Config = window.Allo.Config;

  function getActivePageNumber() {
    try {
      const activeEl = document.querySelector(
        ".pagination .active, .page-item.active, [class*='pagination'] .active, " +
        "ul.pagination li.active a, ul.pagination li.active span, " +
        "li.page-item.active, .ant-pagination-item-active, .mat-paginator"
      );
      if (activeEl) {
        const num = parseInt((activeEl.innerText || activeEl.textContent || "").trim(), 10);
        if (!isNaN(num) && num > 0) return num;
      }
      const m = window.location.href.match(/[?&]page=(\d+)/i);
      if (m) {
        const num = parseInt(m[1], 10);
        if (!isNaN(num) && num > 0) return num;
      }
    } catch (e) {}
    return 1;
  }

  function buildPageUrl(pageNum) {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("page", String(pageNum));
      return u.toString();
    } catch (e) {
      return window.location.href;
    }
  }

  function findPageButton(pageNum) {
    try {
      const links = Array.from(document.querySelectorAll(
        ".pagination a, .pagination button, .pagination li, " +
        "[class*='pagination'] a, [class*='pagination'] button, " +
        "ul.pagination a, ul.pagination span, li.page-item a, " +
        ".ant-pagination-item, .page-link"
      ));
      for (const el of links) {
        const txt = (el.innerText || el.textContent || "").trim();
        if (txt === String(pageNum)) {
          return el.tagName.toLowerCase() === "a" || el.tagName.toLowerCase() === "button"
            ? el
            : el.querySelector("a, button") || el;
        }
      }
    } catch (e) {}
    return null;
  }

  function restoreListPage(savedPage, done) {
    if (!savedPage || savedPage <= 1) {
      if (typeof done === "function") done();
      return;
    }
    const current = getActivePageNumber();
    if (current === savedPage) {
      if (typeof done === "function") done();
      return;
    }

    const btn = findPageButton(savedPage);
    if (btn) {
      btn.click();
      setTimeout(() => { if (typeof done === "function") done(); }, 500);
      return;
    }

    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const b = findPageButton(savedPage);
      if (b) {
        clearInterval(interval);
        b.click();
        setTimeout(() => { if (typeof done === "function") done(); }, 500);
      } else if (attempts > 12) {
        clearInterval(interval);
        try {
          const currentUrl = new URL(window.location.href);
          if (currentUrl.searchParams.get("page") !== String(savedPage)) {
            currentUrl.searchParams.set("page", String(savedPage));
            window.location.href = currentUrl.toString();
            return;
          }
        } catch (e) {}
        if (typeof done === "function") done();
      }
    }, 150);
  }

  function navigateBackToList(returnUrl, savedPage, fallbackPath) {
    const targetUrl = returnUrl || (savedPage > 1 ? buildPageUrl(savedPage) : null);
    if (targetUrl) {
      try {
        const u = new URL(targetUrl, window.location.origin);
        if (savedPage > 1 && !u.searchParams.has("page")) {
          u.searchParams.set("page", String(savedPage));
        }
        window.location.href = u.toString();
        return;
      } catch (e) {}
    }
    if (savedPage > 1) {
      try {
        const u = new URL(fallbackPath || "/bookings", window.location.origin);
        u.searchParams.set("page", String(savedPage));
        window.location.href = u.toString();
        return;
      } catch (e) {}
    }
    window.location.href = fallbackPath || "/bookings";
  }

  function maybeRestorePageOnListLoad() {
    try {
      const saved = sessionStorage.getItem(Config.SESSION_KEYS.SAVED_PAGE);
      if (!saved) return;
      const pageNum = parseInt(saved, 10);
      sessionStorage.removeItem(Config.SESSION_KEYS.SAVED_PAGE);
      if (isNaN(pageNum) || pageNum <= 1) return;
      restoreListPage(pageNum);
    } catch (e) {}
  }

  window.Allo.Features.BulkQueue.Pagination = {
    getActivePageNumber,
    buildPageUrl,
    findPageButton,
    restoreListPage,
    navigateBackToList,
    maybeRestorePageOnListLoad
  };
})();
