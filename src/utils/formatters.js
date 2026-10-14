/**
 * Allo Booking Exporter - String & Field Formatting Utilities
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Utils = window.Allo.Utils || {};

  function digitsOnly(s) {
    return (s || "").replace(/[^\d]/g, "");
  }

  function cleanAddr(s) {
    return s ? s.replace(/\s+/g, " ").replace(/[\t\r\n]+/g, " ").trim() : "";
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function normalizeDate(raw) {
    if (!raw) return todayStr();
    const clean = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

    const parts = clean.split(/[\/\-\.]/);
    if (parts.length === 3) {
      const p0 = parseInt(parts[0], 10);
      const p1 = parseInt(parts[1], 10);
      let p2 = parseInt(parts[2], 10);
      if (p2 < 100) p2 += 2000;
      if (p0 > 12) {
        return `${p2}-${String(p1).padStart(2, "0")}-${String(p0).padStart(2, "0")}`;
      } else {
        return `${p2}-${String(p0).padStart(2, "0")}-${String(p1).padStart(2, "0")}`;
      }
    }

    try {
      const parsed = new Date(clean);
      if (!isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
      }
    } catch (e) {}

    return clean;
  }

  function sanitize(v) {
    return v == null ? "" : String(v).replace(/\t/g, " ").replace(/[\r\n]+/g, " ").trim();
  }

  function cleanVehicle(val) {
    if (!val) return "";
    let s = String(val).trim();
    s = s.replace(/\s*-\s*[A-Z0-9\s\-]+$/i, "");
    s = s.replace(/\s*\([^\)]*\)/g, "");
    return s.trim();
  }

  function cleanName(val) {
    if (!val) return "";
    let s = String(val).trim();
    s = s.replace(/^([A-Za-z]+)\s+\1$/i, "$1");
    s = s.replace(/\s+/g, " ");
    return s.trim();
  }

  window.Allo.Utils.Formatters = {
    digitsOnly,
    cleanAddr,
    todayStr,
    normalizeDate,
    sanitize,
    cleanVehicle,
    cleanName
  };
})();
