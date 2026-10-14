/**
 * Allo Booking Exporter - Multi-Row Bulk Processing Queue
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.BulkQueue = window.Allo.Features.BulkQueue || {};

  const Config = window.Allo.Config;
  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;
  const Clipboard = window.Allo.Utils.Clipboard;
  const TableParser = window.Allo.Core.TableParser;
  const BgFetch = window.Allo.Features.DetailExtractor.BgFetch;
  const Live = window.Allo.Features.DetailExtractor.Live;
  const Cancel = window.Allo.Features.BulkQueue.Cancel;
  const Pagination = window.Allo.Features.BulkQueue.Pagination;

  function runDetailPolling(onSuccess, expectedCrn) {
    const startedToken = State.bulkRunToken;
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds total

    function liveCrn() {
      try {
        const body = document.body.innerText || "";
        const m = body.match(/\b(?:CRN\s*(?:Number)?:?\s*)?(179\d{8,11})\b/i);
        return m ? `CRN ${m[1]}` : "";
      } catch (e) {
        return "";
      }
    }

    function isCrnOk() {
      if (!expectedCrn) return true;
      const cur = liveCrn();
      if (!cur) return false;
      return cur === expectedCrn;
    }

    function tryExtract() {
      if (Cancel.isBulkCancelRequested() || State.bulkRunToken !== startedToken) return;
      attempts++;
      const names = Live.extractNamesFromCurrentDetailPage();
      const trip = Live.extractTripInfoFromCurrentDetailPage();
      const crnMatches = isCrnOk();

      if (names.driver && names.user && crnMatches) {
        onSuccess({ ...names, ...trip });
        return;
      }

      if (attempts >= maxAttempts) {
        onSuccess({ ...names, ...trip });
        return;
      }

      setTimeout(tryExtract, 100);
    }

    setTimeout(tryExtract, 150);
  }

  function finishBulkQueue(queueState) {
    Cancel.clearBulkCancel();
    sessionStorage.removeItem(Config.SESSION_KEYS.BULK_QUEUE);
    sessionStorage.removeItem(Config.SESSION_KEYS.SAVED_PAGE);
    DOM.hideProgressToast();

    const stopBtn = document.getElementById("allo-stop-bulk-btn");
    if (stopBtn) stopBtn.remove();

    // Preserve list order: reverse items back
    const ordered = queueState.completed.slice().reverse();
    const tsvLines = ordered.map(r => Clipboard.buildRowTsv(r));
    const fullTsv = tsvLines.join("\n");

    const success = Clipboard.copyToClipboard(fullTsv);
    if (success) {
      DOM.showToast("✅ Bulk Copy Complete!", `Copied ${ordered.length} rows to Excel.`);
    } else {
      Clipboard.showModalFallback(fullTsv, ordered.length);
    }
  }

  function resumeBulkQueueNextRow(queueState) {
    if (Cancel.isBulkCancelRequested()) {
      Cancel.handleBulkStopped(true);
      return;
    }

    if (queueState.pendingItems.length === 0) {
      finishBulkQueue(queueState);
      return;
    }

    const nextItem = queueState.pendingItems[0];
    DOM.showProgressToast(
      `Processing (${queueState.totalCount - queueState.pendingItems.length + 1}/${queueState.totalCount})`,
      nextItem.crn || "Loading..."
    );
    Cancel.ensureStopBulkButton();

    sessionStorage.setItem(Config.SESSION_KEYS.BULK_QUEUE, JSON.stringify(queueState));

    if (nextItem.detailUrl) {
      window.location.href = nextItem.detailUrl;
      return;
    }

    const rows = TableParser.getAllPossibleRows();
    let targetRow = null;
    if (nextItem.crn) {
      targetRow = rows.find(r => r.innerText.includes(nextItem.crn.replace("CRN ", "")));
    }
    if (!targetRow && rows[nextItem.rowIndex]) {
      targetRow = rows[nextItem.rowIndex];
    }

    if (targetRow) {
      const clickTarget = targetRow.querySelector("a[href], button, [class*='crn'], td:nth-child(2)") || targetRow;
      clickTarget.click();
    } else {
      queueState.completed.push(nextItem);
      queueState.pendingItems.shift();
      resumeBulkQueueNextRow(queueState);
    }
  }

  function processSingleDetailAutoCopy(pending) {
    const startedToken = State.bulkRunToken;

    function finishExtraction(details) {
      if (Cancel.isBulkCancelRequested() || State.bulkRunToken !== startedToken) return;

      pending.row.driver = details.driver || "";
      pending.row.user = details.user || "";
      if (details.vehicle) pending.row.vehicle = details.vehicle;
      if (details.status) pending.row.status = details.status;

      const tsv = Clipboard.buildRowTsv(pending.row);
      Clipboard.copyToClipboard(tsv);
      sessionStorage.removeItem(Config.SESSION_KEYS.PENDING_COPY);

      Pagination.navigateBackToList(pending.returnUrl, pending.savedPage, "/bookings");
    }

    runDetailPolling(finishExtraction, pending.expectedCrn);
  }

  function processBulkQueueAutoCopy(queueState) {
    if (Cancel.isBulkCancelRequested()) {
      Cancel.handleBulkStopped(true);
      return;
    }

    const startedToken = State.bulkRunToken;
    const currentItem = queueState.pendingItems[0];
    if (!currentItem) {
      finishBulkQueue(queueState);
      return;
    }

    DOM.showProgressToast(
      `Extracting (${queueState.totalCount - queueState.pendingItems.length + 1}/${queueState.totalCount})`,
      currentItem.crn || "Details..."
    );
    Cancel.ensureStopBulkButton();

    function finishItemExtraction(details) {
      if (Cancel.isBulkCancelRequested() || State.bulkRunToken !== startedToken) {
        Cancel.handleBulkStopped(true);
        return;
      }

      currentItem.driver = details.driver || "";
      currentItem.user = details.user || "";
      if (details.vehicle) currentItem.vehicle = details.vehicle;
      if (details.status) currentItem.status = details.status;

      queueState.completed.push(currentItem);
      queueState.pendingItems.shift();

      if (queueState.pendingItems.length === 0) {
        finishBulkQueue(queueState);
        Pagination.navigateBackToList(queueState.returnUrl, queueState.savedPage, "/bookings");
      } else {
        sessionStorage.setItem(Config.SESSION_KEYS.BULK_QUEUE, JSON.stringify(queueState));
        Pagination.navigateBackToList(queueState.returnUrl, queueState.savedPage, "/bookings");
      }
    }

    runDetailPolling(finishItemExtraction, currentItem.crn);
  }

  function checkDetailPageAutoCopy() {
    if (Cancel.isBulkCancelRequested()) {
      sessionStorage.removeItem(Config.SESSION_KEYS.PENDING_COPY);
      sessionStorage.removeItem(Config.SESSION_KEYS.BULK_QUEUE);
      Cancel.handleBulkStopped(false);
      return;
    }

    const pendingSingle = sessionStorage.getItem(Config.SESSION_KEYS.PENDING_COPY);
    if (pendingSingle && /bookingsView/i.test(window.location.href)) {
      try {
        const pending = JSON.parse(pendingSingle);
        processSingleDetailAutoCopy(pending);
        return;
      } catch (e) {
        sessionStorage.removeItem(Config.SESSION_KEYS.PENDING_COPY);
      }
    }

    const queueStr = sessionStorage.getItem(Config.SESSION_KEYS.BULK_QUEUE);
    if (queueStr) {
      try {
        const queueState = JSON.parse(queueStr);
        if (/bookingsView/i.test(window.location.href)) {
          processBulkQueueAutoCopy(queueState);
        } else {
          resumeBulkQueueNextRow(queueState);
        }
      } catch (e) {
        sessionStorage.removeItem(Config.SESSION_KEYS.BULK_QUEUE);
      }
    }
  }

  async function extractAndCopyRows(rowElements) {
    if (!rowElements || rowElements.length === 0) return;

    Cancel.clearBulkCancel();
    State.bulkRunToken = (State.bulkRunToken || 0) + 1;
    try { sessionStorage.setItem(Config.SESSION_KEYS.BULK_TOKEN, String(State.bulkRunToken)); } catch (e) {}

    const myRunToken = State.bulkRunToken;
    const headerMap = TableParser.getTableHeaderMap();
    const rowsWithMeta = [];

    rowElements.forEach((r, idx) => {
      const parsed = TableParser.parseBookingRow(r, headerMap);
      const detailUrl = TableParser.getDetailUrlFromRow(r);
      rowsWithMeta.push({
        ...parsed,
        detailUrl,
        rowIndex: idx
      });
    });

    const needNav = [];
    const completed = [];

    DOM.showProgressToast(`Analyzing ${rowsWithMeta.length} Rows`, "Resolving details in background...");
    Cancel.ensureStopBulkButton();

    for (let i = 0; i < rowsWithMeta.length; i++) {
      if (Cancel.isBulkCancelRequested() || State.bulkRunToken !== myRunToken) {
        Cancel.handleBulkStopped(true);
        return;
      }

      const item = rowsWithMeta[i];
      DOM.showProgressToast(`Background Fetch (${i + 1}/${rowsWithMeta.length})`, item.crn || "Fetching...");

      if (item.detailUrl) {
        try {
          const details = await BgFetch.fetchBookingDetails(item.detailUrl);
          if (details && (!item.crn || !details.detailCrn || details.detailCrn === item.crn)) {
            item.driver = details.driver || "";
            item.user = details.user || "";
            if (details.vehicle) item.vehicle = details.vehicle;
            if (details.status) item.status = details.status;
            completed.push(item);
            continue;
          }
        } catch (e) {}
      }
      needNav.push(item);
    }

    if (Cancel.isBulkCancelRequested() || State.bulkRunToken !== myRunToken) {
      Cancel.handleBulkStopped(true);
      return;
    }

    if (needNav.length === 0) {
      DOM.hideProgressToast();
      const stopBtn = document.getElementById("allo-stop-bulk-btn");
      if (stopBtn) stopBtn.remove();

      // Reverse completed items back to match table order
      const ordered = completed.slice().reverse();
      const tsvLines = ordered.map(r => Clipboard.buildRowTsv(r));
      const fullTsv = tsvLines.join("\n");
      const success = Clipboard.copyToClipboard(fullTsv);
      if (success) {
        DOM.showToast("✅ All Rows Copied!", `${ordered.length} bookings ready for Excel.`);
      } else {
        Clipboard.showModalFallback(fullTsv, ordered.length);
      }
      return;
    }

    // Fallback: Navigation queue for remaining items
    const savedPage = Pagination.getActivePageNumber();
    const queueState = {
      completed,
      pendingItems: needNav,
      totalCount: rowsWithMeta.length,
      returnUrl: window.location.href,
      savedPage
    };

    sessionStorage.setItem(Config.SESSION_KEYS.BULK_QUEUE, JSON.stringify(queueState));
    sessionStorage.setItem(Config.SESSION_KEYS.SAVED_PAGE, String(savedPage));
    resumeBulkQueueNextRow(queueState);
  }

  function copyAllVisibleBookings() {
    const rows = TableParser.getAllPossibleRows();
    if (rows.length === 0) {
      DOM.showToast("⚠️ No Rows Found", "Ensure bookings table is visible.");
      return;
    }
    extractAndCopyRows(rows);
  }

  window.Allo.Features.BulkQueue.Queue = {
    checkDetailPageAutoCopy,
    extractAndCopyRows,
    copyAllVisibleBookings,
    resumeBulkQueueNextRow
  };
})();
