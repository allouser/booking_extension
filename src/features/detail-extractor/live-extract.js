/**
 * Allo Booking Exporter - Live Detail Page Extractor
 */
(function () {
  window.Allo = window.Allo || {};
  window.Allo.Features = window.Allo.Features || {};
  window.Allo.Features.DetailExtractor = window.Allo.Features.DetailExtractor || {};

  const Formatters = window.Allo.Utils.Formatters;

  function extractSection(fullText, sectionName) {
    const idx = fullText.toLowerCase().indexOf(sectionName.toLowerCase());
    if (idx === -1) return "";
    return fullText.slice(idx, idx + 1000);
  }

  function extractFieldValue(sectionText, fieldName) {
    const re = new RegExp(fieldName + "[\\s:]+([^\\n\\r]+)", "i");
    const m = sectionText.match(re);
    return m ? m[1].trim() : "";
  }

  function extractNameFromFullText(fullText, sectionName) {
    const sec = extractSection(fullText, sectionName);
    if (!sec) return "";
    const name = extractFieldValue(sec, "Name");
    if (name) {
      const parts = name.split(/\s+/);
      if (parts.length >= 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
        return parts.slice(1).join(" ").trim();
      }
      return name;
    }
    const lines = sec.split("\n").map(l => l.trim()).filter(Boolean);
    for (let i = 1; i < Math.min(lines.length, 6); i++) {
      const l = lines[i];
      if (/^[A-Za-z]+(?:\s+[A-Za-z]+)+$/.test(l) && !/^(phone|email|rating|vehicle|car|address|details|info)/i.test(l)) {
        return l;
      }
    }
    return "";
  }

  function extractNameFromLiveDoc(sectionKeywords) {
    for (const kw of sectionKeywords) {
      const allDivs = Array.from(document.querySelectorAll("div, p, span, h5, h6, strong, b"));
      for (const el of allDivs) {
        const txt = (el.innerText || "").trim().toLowerCase();
        if (txt === kw || txt === kw + ":" || txt.startsWith(kw + "\n") || txt.startsWith(kw + " ")) {
          const card = el.closest(".card, .panel, .box, [class*='detail'], [class*='info'], div") || el.parentElement;
          if (card) {
            const cardText = card.innerText || "";
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
    return "";
  }

  function extractNamesFromCurrentDetailPage() {
    let driver = "";
    let user = "";

    try {
      const bodyText = document.body.innerText || "";
      driver = extractNameFromFullText(bodyText, "Driver Details") ||
               extractNameFromFullText(bodyText, "Driver Info") ||
               extractNameFromFullText(bodyText, "Driver");

      user = extractNameFromFullText(bodyText, "User Details") ||
             extractNameFromFullText(bodyText, "Customer Details") ||
             extractNameFromFullText(bodyText, "Passenger") ||
             extractNameFromFullText(bodyText, "User");

      if (!driver) {
        driver = extractNameFromLiveDoc(["driver details", "driver info", "driver", "provider details", "provider info", "provider"]);
      }
      if (!user) {
        user = extractNameFromLiveDoc(["user details", "customer details", "passenger details", "passenger", "user", "customer"]);
      }
    } catch (e) {}

    return {
      driver: Formatters.cleanName(driver),
      user: Formatters.cleanName(user)
    };
  }

  function extractTripInfoFromCurrentDetailPage() {
    let from = "";
    let to = "";
    let vehicle = "";
    let status = "";
    let crn = "";
    let date = "";
    let time = "";

    try {
      const body = document.body.innerText || "";

      const crnM = body.match(/\b(?:CRN\s*(?:Number)?:?\s*)?(179\d{8,11})\b/i);
      if (crnM) crn = `CRN ${crnM[1]}`;

      const dtM = body.match(/\b(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/);
      if (dtM) date = Formatters.normalizeDate(dtM[1]);

      const tM = body.match(/\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i);
      if (tM) time = tM[1].trim();

      const fromM = body.match(/(?:Pick\s*Up|Pickup|From)[\s:]+([^\n\r]+)/i);
      if (fromM) from = Formatters.cleanAddr(fromM[1]);

      const toM = body.match(/(?:Drop\s*Off|Drop|To|Destination)[\s:]+([^\n\r]+)/i);
      if (toM) to = Formatters.cleanAddr(toM[1]);

      const vM = body.match(/(?:Vehicle(?:\s*Type)?|Car(?:\s*Type)?|Service(?:\s*Type)?)[\s:]+([^\n\r]+)/i);
      if (vM) vehicle = Formatters.cleanVehicle(vM[1]);

      if (/completed/i.test(body)) status = "completed";
      else if (/cancelled/i.test(body)) status = "cancelled";
      else if (/accepted/i.test(body)) status = "accepted";
      else if (/started/i.test(body)) status = "started";
      else if (/arrived/i.test(body)) status = "arrived";
      else if (/pending/i.test(body)) status = "pending";
    } catch (e) {}

    return { from, to, vehicle, status, crn, date, time };
  }

  window.Allo.Features.DetailExtractor.Live = {
    extractNamesFromCurrentDetailPage,
    extractTripInfoFromCurrentDetailPage,
    extractNameFromFullText,
    extractFieldValue
  };
})();
