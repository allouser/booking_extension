/**
 * Allo Booking Exporter - Configuration Constants
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Config = window.Allo.Config || {};

  window.Allo.Config.DEFAULT_FIELDS = {
    date: true,
    time: true,
    crn: true,
    from: true,
    to: true,
    driver: true,
    user: true,
    vehicle: true,
    status: true,
    note: true
  };

  window.Allo.Config.STORAGE_KEYS = {
    ENABLED: "extensionEnabled",
    FIELDS: "enabledFields",
    BULK_CANCEL: "alloBulkCancel"
  };

  window.Allo.Config.SESSION_KEYS = {
    BULK_CANCEL: "ALLO_BULK_CANCEL",
    BULK_TOKEN: "ALLO_BULK_TOKEN",
    BULK_QUEUE: "ALLO_BULK_QUEUE",
    PENDING_COPY: "ALLO_PENDING_COPY",
    SAVED_PAGE: "ALLO_SAVED_PAGE"
  };
})();
