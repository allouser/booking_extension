/**
 * Allo Booking Exporter - Table & Row Parser Core Module
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Core = window.Allo.Core || {};

  const PageDetector = window.Allo.Core.PageDetector;
  const Formatters = window.Allo.Utils.Formatters;

  function getAllPossibleRows() {
    if (!PageDetector.isBookingPage()) return [];

    let rows = Array.from(document.querySelectorAll("tbody tr"));
    rows = rows.filter(r => !r.querySelector("th") && (r.innerText || "").trim().length > 0);

    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll("table tr"));
      rows = rows.filter(r => !r.querySelector("th") && !r.closest("thead") && (r.innerText || "").trim().length > 0);
    }

    if (rows.length === 0) {
      rows = Array.from(document.querySelectorAll('[role="row"], .table-row, .ant-table-row, .MuiTableRow-root'));
      rows = rows.filter(r => (r.innerText || "").trim().length > 0 && !r.closest("thead") && !r.querySelector('[role="columnheader"]'));
    }

    return rows;
  }

  function getTableHeaderMap() {
    try {
      const ths = Array.from(document.querySelectorAll("thead th, table thead td, tr th"));
      if (!ths.length) return null;
      const map = { crn: -1, from: -1, to: -1, date: -1, status: -1, action: -1 };
      ths.forEach((th, i) => {
        const t = ((th.innerText || th.textContent) || "").toLowerCase();
        if (/crn|booking.?id|ref/.test(t) && map.crn === -1) map.crn = i;
        else if (/pick.?up|from|source|origin/.test(t) && map.from === -1) map.from = i;
        else if (/drop|to |destination|^to$/.test(t) && map.to === -1) map.to = i;
        else if (/date|time|created/.test(t) && map.date === -1) map.date = i;
        else if (/status/.test(t) && map.status === -1) map.status = i;
        else if (/action|copy/.test(t) && map.action === -1) map.action = i;
      });
      return map;
    } catch (e) {
      return null;
    }
  }

  function getCleanCells(rowEl) {
    try {
      const clone = rowEl.cloneNode(true);
      clone.querySelectorAll(".allo-row-copy-btn, .allo-row-checkbox-wrap, input[type='checkbox'], button").forEach(n => n.remove());
      return Array.from(clone.querySelectorAll("td, [role='cell']")).map(c => (c.innerText || c.textContent || "").trim());
    } catch (e) {
      return Array.from(rowEl.querySelectorAll("td, [role='cell']")).map(c => (c.innerText || c.textContent || "").trim());
    }
  }

  function parseBookingRow(rowEl, headerMap) {
    const cells = getCleanCells(rowEl);
    const fullText = (rowEl.innerText || "").replace(/📋 Copy|Select Area|Copy All/g, " ");

    const crnMatch = fullText.match(/\b(?:CRN\s*)?(179\d{8,11})\b/i);
    let crn = crnMatch ? `CRN ${crnMatch[1]}` : "";

    const dateMatch = fullText.match(/\b(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
    let date = dateMatch ? Formatters.normalizeDate(dateMatch[1]) : Formatters.todayStr();

    const timeMatch = fullText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i);
    let time = timeMatch ? timeMatch[1].trim() : "";

    let status = "";
    if (/completed/i.test(fullText)) status = "completed";
    else if (/cancelled/i.test(fullText)) status = "cancelled";
    else if (/accepted/i.test(fullText)) status = "accepted";
    else if (/started/i.test(fullText)) status = "started";
    else if (/arrived/i.test(fullText)) status = "arrived";
    else if (/pending/i.test(fullText)) status = "pending";

    let from = "";
    let to = "";

    if (headerMap && headerMap.from !== -1 && cells[headerMap.from]) {
      from = Formatters.cleanAddr(cells[headerMap.from]);
    }
    if (headerMap && headerMap.to !== -1 && cells[headerMap.to]) {
      to = Formatters.cleanAddr(cells[headerMap.to]);
    }

    if (!from || !to) {
      const cleanParts = cells.filter(c => c && c.length > 5 && !/^(completed|cancelled|accepted|pending|started|lkr|\$|rs)/i.test(c));
      const addrCands = cleanParts.filter(c => /[a-z]/i.test(c) && !/^\d+$/.test(c) && !/^\d{1,4}[\/\-\.]/.test(c) && !/^179\d+/.test(c) && !/^lkr/i.test(c));
      if (!from && addrCands[0]) from = Formatters.cleanAddr(addrCands[0]);
      if (!to && addrCands[1]) to = Formatters.cleanAddr(addrCands[1]);
    }

    return {
      date,
      time,
      crn,
      from,
      to,
      driver: "",
      user: "",
      vehicle: "",
      status,
      note: ""
    };
  }

  function getCrnFromRow(rowEl) {
    if (!rowEl) return "";
    const m = (rowEl.innerText || "").match(/\b(?:CRN\s*)?(179\d{8,11})\b/i);
    return m ? `CRN ${m[1]}` : "";
  }

  function getDetailUrlFromRow(rowEl) {
    try {
      const links = Array.from(rowEl.querySelectorAll("a[href]"));
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        if (/\/bookingsView\/[a-zA-Z0-9_-]+/i.test(href)) {
          return a.href;
        }
      }
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        if (/booking|ride/i.test(href) && !/list|history|provider|user/i.test(href)) {
          return a.href;
        }
      }
    } catch (e) {}
    return "";
  }

  window.Allo.Core.TableParser = {
    getAllPossibleRows,
    getTableHeaderMap,
    getCleanCells,
    parseBookingRow,
    getCrnFromRow,
    getDetailUrlFromRow
  };
})();
