/**
 * Allo Booking Exporter - Area Snip Tool Feature
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.SnipTool = window.Allo.Features.SnipTool || {};

  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;
  const TableParser = window.Allo.Core.TableParser;

  function cleanupSnip() {
    State.isSnipping = false;
    if (State.overlayEl) { State.overlayEl.remove(); State.overlayEl = null; }
    if (State.snipBoxEl) { State.snipBoxEl.remove(); State.snipBoxEl = null; }
    const banner = document.getElementById("allo-snip-banner");
    if (banner) banner.remove();
    document.body.style.cursor = "default";
  }

  function processSelectedArea(rect) {
    const rows = TableParser.getAllPossibleRows();
    const selectedRows = [];

    rows.forEach(row => {
      const rowRect = row.getBoundingClientRect();
      const overlap = !(
        rect.right < rowRect.left ||
        rect.left > rowRect.right ||
        rect.bottom < rowRect.top ||
        rect.top > rowRect.bottom
      );
      if (overlap) selectedRows.push(row);
    });

    if (selectedRows.length === 0) {
      DOM.showToast("⚠️ No Rows Selected", "Drag across table rows to copy them.");
      return;
    }

    if (selectedRows.length === 1) {
      window.Allo.Features.RowActions?.CopyButton?.executeRowAutoClickCopy(selectedRows[0]);
      return;
    }

    window.Allo.Features.BulkQueue?.Queue?.extractAndCopyRows(selectedRows);
  }

  function startSnipMode() {
    if (State.isSnipping) return;
    State.isSnipping = true;

    const overlay = document.createElement("div");
    overlay.className = "allo-snip-overlay";
    document.body.appendChild(overlay);
    State.overlayEl = overlay;

    const banner = document.createElement("div");
    banner.id = "allo-snip-banner";
    banner.className = "allo-snip-banner";
    banner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="22" y1="12" x2="18" y2="12"></line><line x1="6" y1="12" x2="2" y2="12"></line><line x1="12" y1="6" x2="12" y2="2"></line><line x1="12" y1="22" x2="12" y2="18"></line></svg>
      Drag box over rows to copy. Press <strong>Esc</strong> to cancel.
    `;
    document.body.appendChild(banner);

    let isDrawing = false;
    let snipBox = null;

    overlay.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      isDrawing = true;
      State.startX = e.clientX;
      State.startY = e.clientY;

      snipBox = document.createElement("div");
      snipBox.className = "allo-snip-box";
      snipBox.style.left = `${State.startX}px`;
      snipBox.style.top = `${State.startY}px`;
      snipBox.style.width = "0px";
      snipBox.style.height = "0px";
      document.body.appendChild(snipBox);
      State.snipBoxEl = snipBox;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDrawing || !snipBox) return;
      const currentX = e.clientX;
      const currentY = e.clientY;

      const left = Math.min(State.startX, currentX);
      const top = Math.min(State.startY, currentY);
      const width = Math.abs(currentX - State.startX);
      const height = Math.abs(currentY - State.startY);

      snipBox.style.left = `${left}px`;
      snipBox.style.top = `${top}px`;
      snipBox.style.width = `${width}px`;
      snipBox.style.height = `${height}px`;
    });

    window.addEventListener("mouseup", (e) => {
      if (!isDrawing) return;
      isDrawing = false;

      const rect = snipBox ? snipBox.getBoundingClientRect() : null;
      cleanupSnip();

      if (rect && rect.width > 20 && rect.height > 10) {
        processSelectedArea(rect);
      }
    }, { once: true });

    const keyListener = (e) => {
      if (e.key === "Escape") {
        cleanupSnip();
        window.removeEventListener("keydown", keyListener);
      }
    };
    window.addEventListener("keydown", keyListener);
  }

  window.Allo.Features.SnipTool = {
    startSnipMode,
    cleanupSnip,
    processSelectedArea
  };
})();
