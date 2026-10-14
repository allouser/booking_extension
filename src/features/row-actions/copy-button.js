/**
 * Allo Booking Exporter - Single Row Copy Button Feature
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.RowActions = window.Allo.Features.RowActions || {};

  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;
  const Clipboard = window.Allo.Utils.Clipboard;
  const PageDetector = window.Allo.Core.PageDetector;
  const TableParser = window.Allo.Core.TableParser;
  const BgFetch = window.Allo.Features.DetailExtractor.BgFetch;
  const Pagination = window.Allo.Features.BulkQueue.Pagination;

  async function executeRowAutoClickCopy(rowEl) {
    const headerMap = TableParser.getTableHeaderMap();
    const parsedRow = TableParser.parseBookingRow(rowEl, headerMap);
    const expectedCrn = parsedRow.crn || TableParser.getCrnFromRow(rowEl);
    const detailUrl = TableParser.getDetailUrlFromRow(rowEl);

    DOM.showToast("⏳ Fetching Details...", "Getting exact user & driver name...");

    // Fast Path 1: Background Fetch
    if (detailUrl) {
      try {
        const details = await BgFetch.fetchBookingDetails(detailUrl);
        if (details && (!expectedCrn || !details.detailCrn || details.detailCrn === expectedCrn)) {
          parsedRow.driver = details.driver || "";
          parsedRow.user = details.user || "";
          if (details.vehicle) parsedRow.vehicle = details.vehicle;
          if (details.status) parsedRow.status = details.status;

          const tsv = Clipboard.buildRowTsv(parsedRow);
          const success = Clipboard.copyToClipboard(tsv);
          if (success) {
            DOM.showToast("✅ Copied to Excel", `${parsedRow.crn || "Booking"} copied!`);
          } else {
            Clipboard.showModalFallback(tsv, 1);
          }
          return;
        }
      } catch (e) {}
    }

    // Fast Path 2: Single Detail Navigation with return memory
    const savedPage = Pagination.getActivePageNumber();
    const pendingData = {
      row: parsedRow,
      returnUrl: window.location.href,
      savedPage: savedPage,
      expectedCrn: expectedCrn
    };
    sessionStorage.setItem("ALLO_PENDING_COPY", JSON.stringify(pendingData));
    sessionStorage.setItem("ALLO_SAVED_PAGE", String(savedPage));

    if (detailUrl) {
      window.location.href = detailUrl;
      return;
    }

    const clickTarget = rowEl.querySelector("a[href], button, [class*='crn'], td:nth-child(2)") || rowEl;
    clickTarget.click();
  }

  function injectRowCopyButtons() {
    if (!State.isExtensionActive || !PageDetector.isBookingPage()) {
      const buttons = document.querySelectorAll(".allo-row-copy-btn");
      buttons.forEach(btn => btn.style.display = "none");
      return;
    }

    const rows = TableParser.getAllPossibleRows();
    rows.forEach(row => {
      if (row.closest("thead") || row.querySelector("th")) return;
      if (row.querySelector(".allo-row-copy-btn")) return;

      const btn = document.createElement("button");
      btn.className = "allo-row-copy-btn";
      btn.type = "button";
      btn.title = "Click to open details, extract User & Driver name, and copy to Excel";
      btn.innerHTML = `<span>📋 Copy</span>`;

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        executeRowAutoClickCopy(row);
      });

      const cells = row.querySelectorAll("td");
      if (cells.length > 0) {
        const lastCell = cells[cells.length - 1];
        lastCell.style.position = "relative";
        lastCell.appendChild(btn);
      } else {
        row.appendChild(btn);
      }
    });
  }

  window.Allo.Features.RowActions.CopyButton = {
    injectRowCopyButtons,
    executeRowAutoClickCopy
  };
})();
