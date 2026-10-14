/**
 * Allo Booking Exporter - DOM & Notification Utilities
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Utils = window.Allo.Utils || {};

  function showToast(title, sub) {
    let t = document.getElementById("allo-toast-msg");
    if (!t) {
      t = document.createElement("div");
      t.id = "allo-toast-msg";
      t.className = "allo-toast";
      document.body.appendChild(t);
    }
    t.innerHTML = `
      <div class="allo-toast-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        ${title}
      </div>
      <div class="allo-toast-sub">${sub}</div>
    `;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 4000);
  }

  function showProgressToast(title, sub) {
    let t = document.getElementById("allo-progress-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "allo-progress-toast";
      t.className = "allo-toast show";
      t.style.bottom = "80px";
      document.body.appendChild(t);
    }
    t.innerHTML = `
      <div class="allo-toast-header">
        <svg class="allo-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-linecap="round"></circle>
        </svg>
        ${title}
      </div>
      <div class="allo-toast-sub">${sub}</div>
    `;
  }

  function hideProgressToast() {
    const t = document.getElementById("allo-progress-toast");
    if (t) t.remove();
  }

  window.Allo.Utils.DOM = {
    showToast,
    showProgressToast,
    hideProgressToast
  };
})();
