/**
 * Allo Booking Exporter - Global Runtime State
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.State = window.Allo.State || {};

  const Config = window.Allo.Config;

  // Extension active flag
  Allo.State.isExtensionActive = true;

  // Configured columns
  Allo.State.enabledFields = Object.assign({}, Config.DEFAULT_FIELDS);

  // Bulk operation tracking
  Allo.State.bulkCancelMemory = false;
  try {
    if (sessionStorage.getItem(Config.SESSION_KEYS.BULK_CANCEL) === "1") {
      Allo.State.bulkCancelMemory = true;
    }
  } catch (e) {}

  Allo.State.bulkRunToken = 0;
  try {
    const t = parseInt(sessionStorage.getItem(Config.SESSION_KEYS.BULK_TOKEN) || "0", 10);
    if (!isNaN(t) && t > 0) Allo.State.bulkRunToken = t;
  } catch (e) {}

  // Checkbox active state
  Allo.State.checkboxesActive = false;

  // Snip selection state
  Allo.State.isSnipping = false;
  Allo.State.startX = 0;
  Allo.State.startY = 0;
  Allo.State.overlayEl = null;
  Allo.State.snipBoxEl = null;
})();
