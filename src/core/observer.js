/**
 * Allo Booking Exporter - MutationObserver & Debounce Manager
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Core = window.Allo.Core || {};

  const State = window.Allo.State;

  let domUpdateTimer = null;
  let observerCallbacks = [];

  function onDomMutated(cb) {
    if (typeof cb === "function") {
      observerCallbacks.push(cb);
    }
  }

  function initObserver() {
    const obs = new MutationObserver((mutations) => {
      if (!State.isExtensionActive) return;

      // Ignore mutations triggered solely by our own elements
      const isOnlyOurChange = mutations.every(m => {
        return Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).every(n => {
          return n.nodeType === 1 && (
            n.classList.contains("allo-row-copy-btn") ||
            n.classList.contains("allo-row-checkbox-wrap") ||
            n.classList.contains("allo-row-checkbox") ||
            n.id === "allo-floating-panel" ||
            n.id === "allo-stop-bulk-btn" ||
            n.classList.contains("allo-snip-box") ||
            n.classList.contains("allo-toast")
          );
        });
      });
      if (isOnlyOurChange) return;

      if (domUpdateTimer) clearTimeout(domUpdateTimer);
      domUpdateTimer = setTimeout(() => {
        if (State.isExtensionActive) {
          observerCallbacks.forEach(cb => {
            try { cb(); } catch (e) {}
          });
        }
      }, 400);
    });

    obs.observe(document.body, { childList: true, subtree: true });
  }

  window.Allo.Core.Observer = {
    onDomMutated,
    initObserver
  };
})();
