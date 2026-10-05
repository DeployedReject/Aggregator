const browserAPI = globalThis.browser || globalThis.chrome;

const params = new URLSearchParams(window.location.search);
const rawTabId = params.get("tabId");
const tabId = rawTabId && !isNaN(parseInt(rawTabId, 10)) ? parseInt(rawTabId, 10) : null;
const domain = params.get("domain") || "";
let targetTabId = tabId;

async function resolveTabId() {
  if (targetTabId !== null) return targetTabId;
  try {
    const tabs = await browserAPI.tabs.query({});
    for (const t of tabs) {
      if (t.url && domain && t.url.includes(domain)) {
        targetTabId = t.id;
        return targetTabId;
      }
    }
  } catch (e) {}
  return null;
}

const domainBadge = document.querySelector("#domain");
const phaseBadge = document.querySelector("#phase");
const instructionBox = document.querySelector("#instruction");
const statusBox = document.querySelector("#status");
const counterBox = document.querySelector("#counter");

const startBtn = document.querySelector("#start");
const stopBtn = document.querySelector("#stop");
const retryBtn = document.querySelector("#retry");
const nextBtn = document.querySelector("#next");
const saveBtn = document.querySelector("#save");
const saveDownloadBtn = document.querySelector("#save-download");
const cancelBtn = document.querySelector("#cancel");

const phases = [
  {
    key: "initial_load",
    name: "Initial Load",
    instruction: "Refresh or open the home page of the website.",
  },
  {
    key: "search_typing",
    name: "Search Typing",
    instruction: "Type 3 to 5 characters in the search bar to capture live suggestions.",
  },
  {
    key: "search_submit",
    name: "Search Submit",
    instruction: "Press Enter or click Search to view full search results.",
  },
  {
    key: "item_select",
    name: "Media Select",
    instruction: "Click on any title from the search results to open its info page.",
  },
  {
    key: "episode_select",
    name: "Episode Select",
    instruction: "Click on an episode to load the video player.",
  },
  {
    key: "server_change",
    name: "Server Change (Optional)",
    instruction: "Switch to another video server if available, or skip to finish.",
    optional: true,
  },
];

let currentPhaseIndex = 0;
let pollTimer = null;

async function updatePhaseUI() {
  if (currentPhaseIndex >= phases.length) {
    phaseBadge.textContent = "All Phases Recorded!";
    instructionBox.textContent = "All phases recorded successfully. Choose an option below to save or export your data.";
    statusBox.textContent = "Status: Ready to Save";

    let totalRequests = 0;
    try {
      const res = await browserAPI.runtime.sendMessage({ action: "GET_STATUS" });
      if (res && res.phases) {
        for (const key of Object.keys(res.phases)) {
          totalRequests += res.phases[key].length;
        }
      }
    } catch (err) {}
    counterBox.textContent = `Total Captured: ${totalRequests} requests`;

    startBtn.classList.add("hidden");
    stopBtn.classList.add("hidden");
    retryBtn.classList.add("hidden");
    nextBtn.classList.add("hidden");

    saveBtn.classList.remove("hidden");
    saveDownloadBtn.classList.remove("hidden");
    saveBtn.disabled = false;
    saveDownloadBtn.disabled = false;
    return;
  }

  const current = phases[currentPhaseIndex];
  phaseBadge.textContent = `Phase ${currentPhaseIndex + 1}/${phases.length}: ${current.name}`;
  instructionBox.textContent = current.instruction;
  statusBox.textContent = "Status: Idle";
  counterBox.textContent = "Captured: 0 requests";

  startBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");
  retryBtn.classList.remove("hidden");
  nextBtn.classList.remove("hidden");

  saveBtn.classList.add("hidden");
  saveDownloadBtn.classList.add("hidden");

  startBtn.disabled = false;
  retryBtn.disabled = true;
  nextBtn.disabled = !current.optional;
  nextBtn.textContent = current.optional
    ? (currentPhaseIndex === phases.length - 1 ? "Skip / Finish" : "Skip")
    : (currentPhaseIndex === phases.length - 1 ? "Finish" : "Next Phase");
}

async function startPhase() {
  const currentKey = phases[currentPhaseIndex].key;

  statusBox.textContent = "Status: Recording...";
  startBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");
  retryBtn.disabled = true;
  nextBtn.disabled = true;

  if (!targetTabId && domain) {
    await resolveTabId();
  }

  try {
    await browserAPI.runtime.sendMessage({
      action: "START_PHASE",
      phase: currentKey,
      tabId: targetTabId,
      domain,
    });
  } catch (err) {}

  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await browserAPI.runtime.sendMessage({ action: "GET_STATUS" });
      if (res && res.phases && res.phases[currentKey]) {
        counterBox.textContent = `Captured: ${res.phases[currentKey].length} requests`;
      }
    } catch (err) {}
  }, 700);
}

async function stopPhase() {
  clearInterval(pollTimer);

  stopBtn.classList.add("hidden");
  startBtn.classList.remove("hidden");
  startBtn.disabled = true;
  retryBtn.disabled = false;
  nextBtn.disabled = false;
  nextBtn.textContent = currentPhaseIndex === phases.length - 1 ? "Finish" : "Next Phase";
  statusBox.textContent = "Status: Stopped";

  let count = 0;
  try {
    const res = await browserAPI.runtime.sendMessage({
      action: "STOP_PHASE",
    });
    if (res && typeof res.count === "number") {
      count = res.count;
    }
  } catch (err) {}

  counterBox.textContent = `Captured: ${count} requests`;
}

async function retryPhase() {
  clearInterval(pollTimer);
  const currentKey = phases[currentPhaseIndex].key;

  try {
    await browserAPI.runtime.sendMessage({
      action: "RETRY_PHASE",
      phase: currentKey,
    });
  } catch (err) {}

  updatePhaseUI();
}

function nextPhase() {
  if (currentPhaseIndex <= phases.length - 1) {
    currentPhaseIndex++;
    updatePhaseUI();
  }
}

async function saveSession() {
  saveBtn.disabled = true;
  saveDownloadBtn.disabled = true;
  statusBox.textContent = "Status: Saving...";

  try {
    await browserAPI.runtime.sendMessage({
      action: "SAVE_SESSION",
    });
  } catch (err) {}

  statusBox.textContent = "Status: Saved!";

  if (domain) {
    const width = 440;
    const height = 500;
    const left = window.screen.availWidth - width - 30;
    const top = 50;

    const url = browserAPI.runtime.getURL(
      `generator/generator.html?domain=${encodeURIComponent(domain)}`
    );

    browserAPI.windows.create({
      url,
      type: "popup",
      width,
      height,
      left,
      top,
    });
  }

  setTimeout(() => window.close(), 400);
}

async function saveAndDownloadSession() {
  saveBtn.disabled = true;
  saveDownloadBtn.disabled = true;
  statusBox.textContent = "Status: Saving & Exporting...";

  let phasesData = {};
  try {
    await browserAPI.runtime.sendMessage({
      action: "SAVE_SESSION",
    });
    const res = await browserAPI.runtime.sendMessage({
      action: "GET_STATUS",
    });
    if (res && res.phases) phasesData = res.phases;
  } catch (err) {}

  const exportData = {
    domain,
    createdAt: new Date().toISOString(),
    phases: phasesData,
  };

  const jsonContent = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  await browserAPI.downloads.download({
    url,
    filename: `recording_${domain}.json`,
    saveAs: true,
  });

  statusBox.textContent = "Status: Exported!";

  if (domain) {
    const width = 440;
    const height = 500;
    const left = window.screen.availWidth - width - 30;
    const top = 50;

    const url = browserAPI.runtime.getURL(
      `generator/generator.html?domain=${encodeURIComponent(domain)}`
    );

    browserAPI.windows.create({
      url,
      type: "popup",
      width,
      height,
      left,
      top,
    });
  }

  setTimeout(() => window.close(), 600);
}

function cancelSession() {
  clearInterval(pollTimer);
  window.close();
}

async function init() {
  domainBadge.textContent = `Site: ${domain || "Unknown"}`;
  updatePhaseUI();

  if (!targetTabId && domain) {
    await resolveTabId();
  }

  if (domain) {
    try {
      await browserAPI.runtime.sendMessage({
        action: "INIT_SESSION",
        tabId: targetTabId,
        domain,
      });
    } catch (err) {}
  }
}

if (startBtn) startBtn.addEventListener("click", startPhase);
if (stopBtn) stopBtn.addEventListener("click", stopPhase);
if (retryBtn) retryBtn.addEventListener("click", retryPhase);
if (nextBtn) nextBtn.addEventListener("click", nextPhase);
if (saveBtn) saveBtn.addEventListener("click", saveSession);
if (saveDownloadBtn) saveDownloadBtn.addEventListener("click", saveAndDownloadSession);
if (cancelBtn) cancelBtn.addEventListener("click", cancelSession);

init();
