/**
 * Allo Booking Exporter - Detail Page Banner
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.DetailExtractor = window.Allo.Features.DetailExtractor || {};

  const State = window.Allo.State;
  const DOM = window.Allo.Utils.DOM;
  const Clipboard = window.Allo.Utils.Clipboard;
  const Live = window.Allo.Features.DetailExtractor.Live;

  function syncDetailPageBanner() {
    const isDetail = /bookingsView/i.test(window.location.href);
    let bar = document.getElementById("allo-detail-bar");

    if (!isDetail || !State.isExtensionActive) {
      if (bar) bar.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement("div");
      bar.id = "allo-detail-bar";
      bar.className = "allo-detail-bar";
      bar.innerHTML = `
        <span style="font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>
          Allo Detail
        </span>
        <button class="allo-btn" id="allo-detail-copy-btn">📋 Copy This Booking</button>
      `;
      document.body.appendChild(bar);

      document.getElementById("allo-detail-copy-btn").addEventListener("click", () => {
        const names = Live.extractNamesFromCurrentDetailPage();
        const trip = Live.extractTripInfoFromCurrentDetailPage();
        const data = {
          date: trip.date,
          time: trip.time,
          crn: trip.crn,
          from: trip.from,
          to: trip.to,
          driver: names.driver,
          user: names.user,
          vehicle: trip.vehicle,
          status: trip.status,
          note: ""
        };
        const tsv = Clipboard.buildRowTsv(data);
        const success = Clipboard.copyToClipboard(tsv);
        if (success) {
          DOM.showToast("✅ Copied to Excel", `${data.crn || "Booking"} copied!`);
        } else {
          Clipboard.showModalFallback(tsv, 1);
        }
      });
    }
  }

  window.Allo.Features.DetailExtractor.Banner = {
    syncDetailPageBanner
  };
})();
