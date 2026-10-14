/**
 * Allo Booking Exporter - Clipboard & TSV Export Utilities
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Utils = window.Allo.Utils || {};

  const State = window.Allo.State;
  const Formatters = window.Allo.Utils.Formatters;

  function buildRowTsv(data) {
    const fields = State.enabledFields;
    const cols = [];

    // FIXED SCHEMA: DATE, TIME, CRN, FROM, TO, DRIVER, USER, VEHICLE, STATUS, NOTE
    if (fields.date) cols.push(Formatters.sanitize(data.date));
    if (fields.time) cols.push(Formatters.sanitize(data.time));
    if (fields.crn) cols.push(Formatters.sanitize(data.crn));
    if (fields.from) cols.push(Formatters.sanitize(data.from));
    if (fields.to) cols.push(Formatters.sanitize(data.to));
    if (fields.driver) cols.push(Formatters.sanitize(data.driver));
    if (fields.user) cols.push(Formatters.sanitize(data.user));
    if (fields.vehicle) cols.push(Formatters.sanitize(data.vehicle));
    if (fields.status) cols.push(Formatters.sanitize(data.status));
    if (fields.note) cols.push(Formatters.sanitize(data.note));

    return cols.join("\t");
  }

  function copyToClipboard(text) {
    if (!text) return false;

    // Strategy 1: modern navigator.clipboard
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {
        fallbackCopyTextToClipboard(text);
      });
      return true;
    }

    // Strategy 2: textarea selection
    return fallbackCopyTextToClipboard(text);
  }

  function fallbackCopyTextToClipboard(text) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.width = "2em";
      textArea.style.height = "2em";
      textArea.style.padding = "0";
      textArea.style.border = "none";
      textArea.style.outline = "none";
      textArea.style.boxShadow = "none";
      textArea.style.background = "transparent";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      return successful;
    } catch (err) {
      return false;
    }
  }

  function showModalFallback(text, count = 1) {
    const existing = document.getElementById("allo-clipboard-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "allo-clipboard-modal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);";

    const box = document.createElement("div");
    box.style.cssText = "background:#0f172a;border:1px solid #334155;border-radius:12px;padding:20px;max-width:500px;width:90%;color:#fff;box-shadow:0 20px 25px rgba(0,0,0,0.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
    box.innerHTML = `
      <h3 style="margin-top:0;font-size:16px;color:#38bdf8;">📋 Copied ${count} Booking${count > 1 ? "s" : ""}</h3>
      <p style="font-size:12.5px;color:#94a3b8;margin-bottom:12px;">Auto-copy blocked by browser permission. Click "Select All" then press Ctrl+C:</p>
      <textarea id="allo-fallback-text" readonly style="width:100%;height:100px;background:#1e293b;border:1px solid #475569;border-radius:6px;color:#e2e8f0;font-size:11px;padding:8px;box-sizing:border-box;font-family:monospace;"></textarea>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:14px;">
        <button id="allo-modal-select" style="background:#2563eb;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Select All</button>
        <button id="allo-modal-close" style="background:#334155;color:#fff;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;">Close</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const ta = document.getElementById("allo-fallback-text");
    ta.value = text;
    ta.focus();
    ta.select();

    document.getElementById("allo-modal-select").addEventListener("click", () => {
      ta.focus();
      ta.select();
      document.execCommand("copy");
    });
    document.getElementById("allo-modal-close").addEventListener("click", () => {
      overlay.remove();
    });
  }

  window.Allo.Utils.Clipboard = {
    buildRowTsv,
    copyToClipboard,
    showModalFallback
  };
})();
