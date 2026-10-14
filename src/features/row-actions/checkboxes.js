/**
 * Allo Booking Exporter - Row Checkbox Injection & Selection Handling
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.RowActions = window.Allo.Features.RowActions || {};

  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;
  const TableParser = window.Allo.Core.TableParser;

  function updateBadgeCount() {
    const cbs = Array.from(document.querySelectorAll('tbody input[type="checkbox"]:checked, table input[type="checkbox"]:checked'));
    cbs.forEach(cb => {
      const r = cb.closest("tr");
      if (r && !r.closest("thead")) r.classList.add("allo-row-selected");
    });
    const c = document.querySelectorAll(".allo-row-selected").length;
    const b = document.getElementById("allo-selected-count");
    if (b) b.innerText = c;
    const btn = document.getElementById("allo-copy-selected-btn");
    if (btn && State.checkboxesActive) btn.style.display = "inline-flex";
  }

  function toggleRowCheckboxes() {
    State.checkboxesActive = !State.checkboxesActive;

    const allCbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    allCbs.forEach(cb => {
      if (!cb.dataset.alloBound) {
        cb.dataset.alloBound = "true";
        cb.addEventListener("click", (e) => { e.stopPropagation(); });
        cb.addEventListener("mousedown", (e) => { e.stopPropagation(); });
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          const row = cb.closest("tr") || cb.closest('[role="row"]');
          if (row && !row.closest("thead")) {
            if (cb.checked) row.classList.add("allo-row-selected");
            else row.classList.remove("allo-row-selected");
            updateBadgeCount();
          }
        });
      }
    });

    const rows = TableParser.getAllPossibleRows();
    rows.forEach(r => {
      let ex = r.querySelector(".allo-row-checkbox-wrap");
      if (ex) {
        ex.style.display = State.checkboxesActive ? "inline-flex" : "none";
      } else if (State.checkboxesActive && !r.querySelector('input[type="checkbox"]')) {
        const w = document.createElement("span");
        w.className = "allo-row-checkbox-wrap";
        w.addEventListener("click", (e) => { e.stopPropagation(); });
        w.addEventListener("mousedown", (e) => { e.stopPropagation(); });

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "allo-row-checkbox";
        cb.dataset.alloBound = "true";
        cb.addEventListener("click", (e) => { e.stopPropagation(); });
        cb.addEventListener("mousedown", (e) => { e.stopPropagation(); });
        cb.addEventListener("change", (e) => {
          e.stopPropagation();
          if (cb.checked) r.classList.add("allo-row-selected");
          else r.classList.remove("allo-row-selected");
          updateBadgeCount();
        });

        w.appendChild(cb);
        const firstCell = r.querySelector("td, [role='cell']");
        if (firstCell) {
          firstCell.insertBefore(w, firstCell.firstChild);
        } else {
          r.children.length > 0 ? r.insertBefore(w, r.firstChild) : r.appendChild(w);
        }
      }
    });

    const btn = document.getElementById("allo-copy-selected-btn");
    if (btn) btn.style.display = State.checkboxesActive ? "inline-flex" : "none";
    updateBadgeCount();
    if (State.checkboxesActive) DOM.showToast("☑️ Checkboxes Active", "Check rows → Copy Selected.");
  }

  function handleCopySelectedClick() {
    let selectedRows = Array.from(document.querySelectorAll(".allo-row-selected"));
    if (selectedRows.length === 0) {
      const checkedBoxes = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'));
      const foundRows = new Set();
      checkedBoxes.forEach(cb => {
        const row = cb.closest("tr") || cb.closest('[role="row"]');
        if (row && !row.closest("thead")) foundRows.add(row);
      });
      selectedRows = Array.from(foundRows);
    }
    if (selectedRows.length === 0) {
      DOM.showToast("⚠️ No rows selected", "Check at least one row first.");
      return;
    }

    if (selectedRows.length === 1) {
      window.Allo.Features.RowActions?.CopyButton?.executeRowAutoClickCopy(selectedRows[0]);
      return;
    }

    window.Allo.Features.BulkQueue?.Queue?.extractAndCopyRows(selectedRows);
  }

  window.Allo.Features.RowActions.Checkboxes = {
    toggleRowCheckboxes,
    updateBadgeCount,
    handleCopySelectedClick
  };
})();
