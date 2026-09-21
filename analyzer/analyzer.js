const browserAPI = globalThis.browser || globalThis.chrome;

const params = new URLSearchParams(window.location.search);
const tabId = parseInt(params.get("tabId"));
const domain = params.get("domain");

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
    name: "Server Change",
    instruction: "Switch to another video server if available, or just click Next.",
  },
];

let currentPhaseIndex = 0;
let pollTimer = null;

async function updatePhaseUI() {
  if (currentPhaseIndex >= phases.length) {
    phaseBadge.textContent = "All Phases Recorded!";
    instructionBox.textContent = "All 6 phases recorded successfully. Choose an option below to save or export your data.";
    statusBox.textContent = "Status: Ready to Save";

    const res = await browserAPI.runtime.sendMessage({ action: "GET_STATUS" });
    let totalRequests = 0;
    if (res && res.phases) {
      for (const key of Object.keys(res.phases)) {
        totalRequests += res.phases[key].length;
      }
    }
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
  nextBtn.disabled = true;
}

async function startPhase() {
  const currentKey = phases[currentPhaseIndex].key;
  await browserAPI.runtime.sendMessage({
    action: "START_PHASE",
    phase: currentKey,
    tabId,
    domain,
  });

  statusBox.textContent = "Status: Recording...";
  startBtn.classList.add("hidden");
  stopBtn.classList.remove("hidden");
  retryBtn.disabled = true;
  nextBtn.disabled = true;

  pollTimer = setInterval(async () => {
    const res = await browserAPI.runtime.sendMessage({ action: "GET_STATUS" });
    if (res && res.phases && res.phases[currentKey]) {
      counterBox.textContent = `Captured: ${res.phases[currentKey].length} requests`;
    }
  }, 700);
}

async function stopPhase() {
  clearInterval(pollTimer);

  const res = await browserAPI.runtime.sendMessage({
    action: "STOP_PHASE",
  });

  statusBox.textContent = "Status: Stopped";
  counterBox.textContent = `Captured: ${res.count || 0} requests`;

  stopBtn.classList.add("hidden");
  startBtn.classList.remove("hidden");
  startBtn.disabled = true;
  retryBtn.disabled = false;
  nextBtn.disabled = false;
}

async function retryPhase() {
  clearInterval(pollTimer);
  const currentKey = phases[currentPhaseIndex].key;

  await browserAPI.runtime.sendMessage({
    action: "RETRY_PHASE",
    phase: currentKey,
  });

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

  await browserAPI.runtime.sendMessage({
    action: "SAVE_SESSION",
  });

  statusBox.textContent = "Status: Saved!";
  setTimeout(() => window.close(), 800);
}

async function saveAndDownloadSession() {
  saveBtn.disabled = true;
  saveDownloadBtn.disabled = true;
  statusBox.textContent = "Status: Saving & Exporting...";

  await browserAPI.runtime.sendMessage({
    action: "SAVE_SESSION",
  });

  const res = await browserAPI.runtime.sendMessage({
    action: "GET_STATUS",
  });

  const exportData = {
    domain,
    createdAt: new Date().toISOString(),
    phases: res ? res.phases : {},
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
  setTimeout(() => window.close(), 1000);
}

function cancelSession() {
  clearInterval(pollTimer);
  window.close();
}

async function init() {
  domainBadge.textContent = `Site: ${domain || "Unknown"}`;
  updatePhaseUI();

  if (tabId && domain) {
    await browserAPI.runtime.sendMessage({
      action: "INIT_SESSION",
      tabId,
      domain,
    });
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
