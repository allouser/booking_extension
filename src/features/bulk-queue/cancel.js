/**
 * Allo Booking Exporter - Bulk Cancellation & Memory Management
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.BulkQueue = window.Allo.Features.BulkQueue || {};

  const Config = window.Allo.Config;
  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;

  function isBulkCancelRequested() {
    if (State.bulkCancelMemory) return true;
    try {
      if (sessionStorage.getItem(Config.SESSION_KEYS.BULK_CANCEL) === "1") return true;
    } catch (e) {}
    return false;
  }

  function isBulkCancelRequestedSync() {
    return isBulkCancelRequested();
  }

  function requestBulkCancel() {
    State.bulkCancelMemory = true;
    try { sessionStorage.setItem(Config.SESSION_KEYS.BULK_CANCEL, "1"); } catch (e) {}
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [Config.STORAGE_KEYS.BULK_CANCEL]: 1 });
      }
    } catch (e) {}
  }

  function clearBulkCancel() {
    State.bulkCancelMemory = false;
    try { sessionStorage.removeItem(Config.SESSION_KEYS.BULK_CANCEL); } catch (e) {}
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(Config.STORAGE_KEYS.BULK_CANCEL);
      }
    } catch (e) {}
  }

  function keepStopButtonAlive() {
    try {
      if (isBulkCancelRequested()) {
        const old = document.getElementById("allo-stop-bulk-btn");
        if (old) old.remove();
        return;
      }
      let hasQueue = false;
      try {
        hasQueue = !!(sessionStorage.getItem(Config.SESSION_KEYS.BULK_QUEUE) || sessionStorage.getItem(Config.SESSION_KEYS.PENDING_COPY));
      } catch (e) {}
      if (!hasQueue) {
        const old = document.getElementById("allo-stop-bulk-btn");
        if (old) old.remove();
        return;
      }
      if (document.getElementById("allo-stop-bulk-btn")) return;
      const b = document.createElement("button");
      b.id = "allo-stop-bulk-btn";
      b.textContent = "⛔ Stop Copy";
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

  function handleBulkStopped(showMsg) {
    try {
      State.bulkRunToken = (State.bulkRunToken || 0) + 1;
      try { sessionStorage.setItem(Config.SESSION_KEYS.BULK_TOKEN, String(State.bulkRunToken)); } catch (e) {}
      sessionStorage.removeItem(Config.SESSION_KEYS.BULK_QUEUE);
      sessionStorage.removeItem(Config.SESSION_KEYS.PENDING_COPY);
      sessionStorage.removeItem(Config.SESSION_KEYS.SAVED_PAGE);
      const b = document.getElementById("allo-stop-bulk-btn");
      if (b) b.remove();
      DOM.hideProgressToast();
      if (showMsg) DOM.showToast("🛑 Bulk Copy Stopped", "Cancelled remaining rows.");
    } catch (e) {}
  }

  function ensureStopBulkButton() {
    if (document.getElementById("allo-stop-bulk-btn")) return;
    const btn = document.createElement("button");
    btn.id = "allo-stop-bulk-btn";
    btn.innerHTML = `<span>⛔ Stop Copy</span>`;
    btn.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#dc2626;color:#fff;border:none;border-radius:9999px;padding:10px 22px;font-size:13.5px;font-weight:700;cursor:pointer;box-shadow:0 10px 25px rgba(0,0,0,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    btn.onclick = (e) => {
      e.stopPropagation();
      requestBulkCancel();
      handleBulkStopped(true);
    };
    document.body.appendChild(btn);
  }

  window.Allo.Features.BulkQueue.Cancel = {
    isBulkCancelRequested,
    isBulkCancelRequestedSync,
    requestBulkCancel,
    clearBulkCancel,
    keepStopButtonAlive,
    handleBulkStopped,
    ensureStopBulkButton
  };
})();
