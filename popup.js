// Power toggle & action triggers
const powerToggle = document.getElementById("power-toggle");
const statusBadge = document.getElementById("status-badge");
const switchText = document.getElementById("switch-state-text");
const actionsGroup = document.getElementById("actions-group");

const DEFAULT_FIELDS = {
  date: true,
  time: true,
  crn: true,
  from: true,
  to: true,
  driver: true,
  user: true,
  vehicle: true,
  status: true,
  note: true,
  userMobile: true,
  driverMobile: true
};

const DEFAULT_COPY_SETTINGS = {
  removeExtraSpaces: false
};

let currentFields = { ...DEFAULT_FIELDS };
let currentCopySettings = { ...DEFAULT_COPY_SETTINGS };

// Load current enabled/disabled state from chrome.storage
chrome.storage.local.get({ extensionEnabled: true, enabledFields: DEFAULT_FIELDS, copySettings: DEFAULT_COPY_SETTINGS }, (data) => {
  const isEnabled = data.extensionEnabled;
  powerToggle.checked = isEnabled;
  updateUIState(isEnabled);

  if (data.enabledFields) {
    currentFields = { ...DEFAULT_FIELDS, ...data.enabledFields };
  }
  renderFieldPills();

  if (data.copySettings) {
    currentCopySettings = { ...DEFAULT_COPY_SETTINGS, ...data.copySettings };
    document.getElementById("cb-remove-extra-spaces").checked = currentCopySettings.removeExtraSpaces;
  }
});

// Handle toggle click
powerToggle.addEventListener("change", async () => {
  const isEnabled = powerToggle.checked;
  chrome.storage.local.set({ extensionEnabled: isEnabled });
  updateUIState(isEnabled);

  // Notify active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "SET_ENABLED", enabled: isEnabled }).catch(() => {});
  }
});

function updateUIState(isEnabled) {
  if (isEnabled) {
    statusBadge.innerText = "Active";
    statusBadge.style.background = "#0284c7";
    switchText.innerText = "Extension ON";
    actionsGroup.classList.remove("disabled");
  } else {
    statusBadge.innerText = "Disabled";
    statusBadge.style.background = "#64748b";
    switchText.innerText = "Extension OFF";
    actionsGroup.classList.add("disabled");
  }
}

function renderFieldPills() {
  const pills = document.querySelectorAll(".field-pill");
  pills.forEach(pill => {
    const fieldKey = pill.dataset.field;
    const isFieldActive = currentFields[fieldKey] !== false;
    if (isFieldActive) {
      pill.classList.add("active");
      pill.innerText = `✓ ${fieldKey.toUpperCase()}`;
    } else {
      pill.classList.remove("active");
      pill.innerText = `✕ ${fieldKey.toUpperCase()}`;
    }
  });

  const toggleAllBtn = document.getElementById("btn-toggle-all-fields");
  const allActive = Object.values(currentFields).every(v => v === true);
  if (toggleAllBtn) toggleAllBtn.innerText = allActive ? "All OFF" : "All ON";
}

// Handle clicking field pills
document.querySelectorAll(".field-pill").forEach(pill => {
  pill.addEventListener("click", () => {
    const fieldKey = pill.dataset.field;
    currentFields[fieldKey] = !currentFields[fieldKey];
    chrome.storage.local.set({ enabledFields: currentFields });
    renderFieldPills();
    notifyContentScriptFields();
  });
});

// Toggle all fields
document.getElementById("btn-toggle-all-fields").addEventListener("click", () => {
  const allActive = Object.values(currentFields).every(v => v === true);
  const newState = !allActive;
  Object.keys(currentFields).forEach(k => currentFields[k] = newState);
  chrome.storage.local.set({ enabledFields: currentFields });
  renderFieldPills();
  notifyContentScriptFields();
});

async function notifyContentScriptFields() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "SET_ENABLED_FIELDS", enabledFields: currentFields }).catch(() => {});
  }
}

document.getElementById("btn-snip").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "START_SNIP" });
    window.close();
  }
});

document.getElementById("btn-copy-all").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "COPY_ALL" });
    window.close();
  }
});

document.getElementById("btn-checkbox").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "TOGGLE_CHECKBOXES" });
    window.close();
  }
});

document.getElementById("btn-stop").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "STOP_BULK" }).catch(() => {});
    window.close();
  }
});

// Remove Extra Spaces toggle
document.getElementById("cb-remove-extra-spaces").addEventListener("change", async () => {
  currentCopySettings.removeExtraSpaces = document.getElementById("cb-remove-extra-spaces").checked;
  chrome.storage.local.set({ copySettings: currentCopySettings });
  await notifyContentScriptCopySettings();
});

async function notifyContentScriptCopySettings() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: "SET_COPY_SETTINGS", copySettings: currentCopySettings }).catch(() => {});
  }
}
