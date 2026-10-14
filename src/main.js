/**
 * Allo Booking Exporter - Main Entry Point & Orchestrator
 */
(function () {
  // Terminal guard
  if (typeof window === "undefined" || typeof document === "undefined") {
    try {
      if (typeof process !== "undefined" && process.versions && process.versions.node) {
        console.log("[Allo Exporter] main.js is a browser content script - skipping execution under Node.");
      }
    } catch (e) {}
    return;
  }

  const Allo = window.Allo || {};
  const Config = Allo.Config;
  const State = Allo.State;
  const DOM = Allo.Utils.DOM;
  const PageDetector = Allo.Core.PageDetector;
  const Observer = Allo.Core.Observer;
  const FloatingPanel = Allo.Features.FloatingPanel;
  const RowActions = Allo.Features.RowActions;
  const BulkQueue = Allo.Features.BulkQueue;
  const DetailExtractor = Allo.Features.DetailExtractor;
  const MapsPoi = Allo.Features.MapsPoi;
  const SnipTool = Allo.Features.SnipTool;

  // Retrieve initial enabled status & fields
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get({
      [Config.STORAGE_KEYS.ENABLED]: true,
      [Config.STORAGE_KEYS.FIELDS]: Config.DEFAULT_FIELDS
    }, (data) => {
      State.isExtensionActive = data[Config.STORAGE_KEYS.ENABLED];
      if (data[Config.STORAGE_KEYS.FIELDS]) {
        State.enabledFields = data[Config.STORAGE_KEYS.FIELDS];
      }
      FloatingPanel.syncVisibility();
      if (PageDetector.isBookingPage()) {
        FloatingPanel.initFloatingControl();
        RowActions.CopyButton?.injectRowCopyButtons();
      }
    });
  }

  // Storage listener
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes[Config.STORAGE_KEYS.FIELDS] && changes[Config.STORAGE_KEYS.FIELDS].newValue) {
        State.enabledFields = changes[Config.STORAGE_KEYS.FIELDS].newValue;
      }
      if (changes[Config.STORAGE_KEYS.ENABLED] !== undefined) {
        State.isExtensionActive = changes[Config.STORAGE_KEYS.ENABLED].newValue;
        FloatingPanel.syncVisibility();
      }
      try {
        if (changes[Config.STORAGE_KEYS.BULK_CANCEL] && changes[Config.STORAGE_KEYS.BULK_CANCEL].newValue) {
          BulkQueue.Cancel?.requestBulkCancel();
          BulkQueue.Cancel?.handleBulkStopped(true);
        }
      } catch (e) {}
    });
  }

  // Runtime messaging listener
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "SET_ENABLED") {
        State.isExtensionActive = request.enabled;
        FloatingPanel.syncVisibility();
        if (PageDetector.isBookingPage()) {
          FloatingPanel.initFloatingControl();
          RowActions.CopyButton?.injectRowCopyButtons();
        }
        sendResponse({ status: "updated", enabled: State.isExtensionActive });
        return true;
      }
      if (request.action === "SET_ENABLED_FIELDS") {
        State.enabledFields = request.enabledFields;
        sendResponse({ status: "updated_fields", enabledFields: State.enabledFields });
        return true;
      }
      if (!State.isExtensionActive) {
        sendResponse({ status: "extension_disabled" });
        return true;
      }
      if (!PageDetector.isBookingPage()) {
        DOM.showToast("⚠️ Booking Pages Only", "This feature is only available on Bookings pages.");
        sendResponse({ status: "not_booking_page" });
        return true;
      }

      if (request.action === "START_SNIP") {
        SnipTool?.startSnipMode();
        sendResponse({ status: "started" });
      } else if (request.action === "COPY_ALL") {
        BulkQueue.Queue?.copyAllVisibleBookings();
        sendResponse({ status: "copied_all" });
      } else if (request.action === "TOGGLE_CHECKBOXES") {
        RowActions.Checkboxes?.toggleRowCheckboxes();
        sendResponse({ status: "toggled" });
      } else if (request.action === "STOP_BULK") {
        BulkQueue.Cancel?.requestBulkCancel();
        BulkQueue.Cancel?.handleBulkStopped(true);
        sendResponse({ status: "stopped" });
      }
      return true;
    });
  }

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    if (!State.isExtensionActive || !PageDetector.isBookingPage()) return;
    if (e.key === "Escape" && (sessionStorage.getItem(Config.SESSION_KEYS.BULK_QUEUE) || sessionStorage.getItem(Config.SESSION_KEYS.PENDING_COPY))) {
      e.preventDefault();
      BulkQueue.Cancel?.requestBulkCancel();
      BulkQueue.Cancel?.handleBulkStopped(true);
      return;
    }
    if (e.altKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      SnipTool?.startSnipMode();
    } else if (e.altKey && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      BulkQueue.Queue?.copyAllVisibleBookings();
    }
  });

  // URL route change handling
  PageDetector.onUrlChange((url, changed) => {
    if (changed) {
      FloatingPanel.syncVisibility();
      if (PageDetector.isBookingPage()) {
        BulkQueue.Queue?.checkDetailPageAutoCopy();
        DetailExtractor.Banner?.syncDetailPageBanner();
        FloatingPanel.initFloatingControl();
        RowActions.CopyButton?.injectRowCopyButtons();
        setTimeout(() => {
          try { BulkQueue.Pagination?.maybeRestorePageOnListLoad(); } catch (e) {}
        }, 400);
      } else {
        FloatingPanel.syncVisibility();
      }
    } else {
      if (!PageDetector.isBookingPage()) {
        FloatingPanel.syncVisibility();
      }
    }
  });

  // DOM Mutation handling
  Observer.onDomMutated(() => {
    FloatingPanel.syncVisibility();
    if (PageDetector.isBookingPage()) {
      FloatingPanel.initFloatingControl();
      RowActions.CopyButton?.injectRowCopyButtons();
      if (State.checkboxesActive) {
        RowActions.Checkboxes?.updateBadgeCount();
      }
    }
  });

  // Bootstrapping
  function bootstrap() {
    PageDetector.initUrlMonitoring();
    Observer.initObserver();

    if (PageDetector.isBookingPage()) {
      BulkQueue.Queue?.checkDetailPageAutoCopy();
      setTimeout(() => {
        try { BulkQueue.Pagination?.maybeRestorePageOnListLoad(); } catch (e) {}
      }, 400);
      DetailExtractor.Banner?.syncDetailPageBanner();
      FloatingPanel.initFloatingControl();
      RowActions.CopyButton?.injectRowCopyButtons();
    }

    MapsPoi?.startPoiHookInjectionLoop ? MapsPoi.startPoiHookInjectionLoop() : MapsPoi?.injectPoiPageHook();
    setInterval(() => {
      BulkQueue.Cancel?.keepStopButtonAlive();
    }, 450);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
