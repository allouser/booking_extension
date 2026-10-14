/**
 * Allo Booking Exporter - Background Detail Page Fetcher & Parser
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.DetailExtractor = window.Allo.Features.DetailExtractor || {};

  const Formatters = window.Allo.Utils.Formatters;

  function extractNameFromParsedDoc(doc, sectionKeywords) {
    try {
      const allDivs = Array.from(doc.querySelectorAll("div, p, span, h5, h6, strong, b"));
      for (const kw of sectionKeywords) {
        for (const el of allDivs) {
          const txt = (el.innerText || el.textContent || "").trim().toLowerCase();
          if (txt === kw || txt === kw + ":" || txt.startsWith(kw + "\n") || txt.startsWith(kw + " ")) {
            const card = el.closest(".card, .panel, .box, [class*='detail'], [class*='info'], div") || el.parentElement;
            if (card) {
              const cardText = card.innerText || card.textContent || "";
              const nameMatch = cardText.match(/Name[\s:]+([^\n\r]+)/i);
              if (nameMatch) {
                const cleaned = nameMatch[1].replace(/\t/g, " ").trim();
                if (cleaned.length > 1 && !/^(phone|email|details)/i.test(cleaned)) {
                  return cleaned;
                }
              }
            }
          }
        }
      }
    } catch (e) {}
    return "";
  }

  async function fetchBookingDetails(detailUrl) {
    if (!detailUrl) return null;
    try {
      const res = await fetch(detailUrl, { credentials: "same-origin" });
      if (!res.ok) return null;
      const html = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      let driver = "";
      let user = "";
      let vehicle = "";
      let status = "";
      let detailCrn = "";

      const rawText = (doc.body.innerText || doc.body.textContent || "");

      // CRN verification check
      const crnMatch = rawText.match(/\b(?:CRN\s*(?:Number)?:?\s*)?(179\d{8,11})\b/i);
      if (crnMatch) detailCrn = `CRN ${crnMatch[1]}`;

      driver = extractNameFromParsedDoc(doc, ["driver details", "driver info", "driver", "provider details", "provider info", "provider"]);
      user = extractNameFromParsedDoc(doc, ["user details", "customer details", "passenger details", "passenger", "user", "customer"]);

      const vMatch = rawText.match(/(?:Vehicle(?:\s*Type)?|Car(?:\s*Type)?|Service(?:\s*Type)?)[\s:]+([^\n\r]+)/i);
      if (vMatch) vehicle = Formatters.cleanVehicle(vMatch[1]);

      if (/completed/i.test(rawText)) status = "completed";
      else if (/cancelled/i.test(rawText)) status = "cancelled";

      return {
        driver: Formatters.cleanName(driver),
        user: Formatters.cleanName(user),
        vehicle,
        status,
        detailCrn
      };
    } catch (e) {
      return null;
    }
  }

  window.Allo.Features.DetailExtractor.BgFetch = {
    fetchBookingDetails,
    extractNameFromParsedDoc
  };
})();
