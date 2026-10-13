// Background script handling shortcuts and message passing
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;

  if (command === "snip_area") {
    chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" }).catch(() => {});
  } else if (command === "copy_all_visible") {
    chrome.tabs.sendMessage(tab.id, { action: "COPY_ALL" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "ROW_DATA_READY") {
    // handled in content script via clipboard write
    sendResponse({ success: true });
  }
});
