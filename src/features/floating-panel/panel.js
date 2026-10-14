/**
 * Allo Booking Exporter - Vertical Floating Control Panel
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.FloatingPanel = window.Allo.Features.FloatingPanel || {};

  const Config = window.Allo.Config;
  const State = window.Allo.State;
  const PageDetector = window.Allo.Core.PageDetector;
  const DOM = window.Allo.Utils.DOM;

  function initFloatingControl() {
    if (!State.isExtensionActive || !PageDetector.isBookingPage()) {
      syncVisibility();
      return;
    }

    if (window.Allo.Features.DetailExtractor?.Banner) {
      window.Allo.Features.DetailExtractor.Banner.syncDetailPageBanner();
    }

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
    if (!State.isExtensionActive || !PageDetector.isBookingPage()) floatingPanel.style.display = "none";

    floatingPanel.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
        <span style="font-size: 13px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 5px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          Excel Copy
        </span>
        <button style="background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:16px;padding:0 4px;line-height:1;" id="allo-close-panel" title="Turn OFF">✕</button>
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

    document.getElementById("allo-snip-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      window.Allo.Features.SnipTool?.startSnipMode();
    });

    document.getElementById("allo-copy-all-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      window.Allo.Features.BulkQueue?.Queue?.copyAllVisibleBookings();
    });

    document.getElementById("allo-checkbox-toggle").addEventListener("click", (e) => {
      e.stopPropagation();
      window.Allo.Features.RowActions?.Checkboxes?.toggleRowCheckboxes();
    });

    document.getElementById("allo-copy-selected-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      window.Allo.Features.RowActions?.Checkboxes?.handleCopySelectedClick();
    });

    document.getElementById("allo-close-panel").addEventListener("click", () => {
      State.isExtensionActive = false;
      floatingPanel.style.display = "none";
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [Config.STORAGE_KEYS.ENABLED]: false });
      }
      DOM.showToast("Extension OFF", "Turn back ON from the extension icon.");
    });

    if (window.Allo.Features.RowActions?.CopyButton) {
      window.Allo.Features.RowActions.CopyButton.injectRowCopyButtons();
    }
  }

  function syncVisibility() {
    const onBooking = PageDetector.isBookingPage();
    const visible = State.isExtensionActive && onBooking;

    const panel = document.getElementById("allo-floating-panel");
    if (panel) panel.style.display = visible ? "flex" : "none";

    const detailBar = document.getElementById("allo-detail-bar");
    if (detailBar) detailBar.style.display = visible ? "flex" : "none";

    if (!onBooking) {
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
    checkboxes.forEach(cb => cb.style.display = (visible && State.checkboxesActive) ? "inline-flex" : "none");
  }

  window.Allo.Features.FloatingPanel = {
    initFloatingControl,
    syncVisibility
  };
})();
