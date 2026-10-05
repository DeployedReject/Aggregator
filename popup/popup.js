const browserAPI = globalThis.browser || globalThis.chrome;

const DEFAULT_REGISTRY_URL = "https://aggregator-registry.mishravaibhav2048.workers.dev";
const DEFAULT_CLIENT_ID = "568930329253-fc6jvge8mjdoa0eohihk03kmvjok9dc6.apps.googleusercontent.com";

const mainMenu = document.querySelector("#main-menu");
const addPluginMenu = document.querySelector("#add-plugin-menu");
const currentSiteMenu = document.querySelector("#current-site-menu");
const storeMenu = document.querySelector("#store-menu");
const genMenu = document.querySelector("#gen-menu");
const settingsMenu = document.querySelector("#settings-menu");
const managePluginsMenu = document.querySelector("#manage-plugins-menu");
const codeModal = document.querySelector("#code-view-modal");

const agBtn = document.querySelector("#open-ag-btn");
const openAddPluginBtn = document.querySelector("#open-add-plugin-btn");
const openManagePluginsBtn = document.querySelector("#open-manage-plugins-btn");
const openSettingsBtn = document.querySelector("#open-settings-menu");
const statusBadge = document.querySelector("#status-badge");

const btnAddCurrentSite = document.querySelector("#btn-add-current-site");
const btnSearchPlugins = document.querySelector("#btn-search-plugins");
const btnAttemptGen = document.querySelector("#btn-attempt-gen");
const addPluginBackBtn = document.querySelector("#add-plugin-back");

const currentSiteDomainBadge = document.querySelector("#current-site-domain-badge");
const currentSiteStatus = document.querySelector("#current-site-status");
const currentSiteList = document.querySelector("#current-site-list");
const btnCurrentSiteGen = document.querySelector("#btn-current-site-gen");
const currentSiteBackBtn = document.querySelector("#current-site-back");

const storeSearchInput = document.querySelector("#store-search-input");
const storeSearchClear = document.querySelector("#store-search-clear");
const btnChanStable = document.querySelector("#btn-chan-stable");
const btnChanNightly = document.querySelector("#btn-chan-nightly");
const storeSortSelect = document.querySelector("#store-sort-select");
const storeLoading = document.querySelector("#store-loading");
const storeEmpty = document.querySelector("#store-empty");
const storeList = document.querySelector("#store-list");
const storePagination = document.querySelector("#store-pagination");
const storePrevBtn = document.querySelector("#store-prev-btn");
const storeNextBtn = document.querySelector("#store-next-btn");
const storePageInfo = document.querySelector("#store-page-info");
const storeBackBtn = document.querySelector("#store-back");

const managePluginsLoading = document.querySelector("#manage-plugins-loading");
const managePluginsEmpty = document.querySelector("#manage-plugins-empty");
const managePluginsList = document.querySelector("#manage-plugins-list");
const managePluginsBackBtn = document.querySelector("#manage-plugins-back");

const genDomainBadge = document.querySelector("#gen-domain-badge");
const genTraceBadge = document.querySelector("#gen-trace-badge");
const analyzeBtn = document.querySelector("#analyze");
const generateBtn = document.querySelector("#generate");
const genBackBtn = document.querySelector("#gen-back");

const cfgRegistryUrl = document.querySelector("#cfg-registry-url");
const cfgDefaultChannel = document.querySelector("#cfg-default-channel");
const cfgLlmToken = document.querySelector("#cfg-llm-token");
const cfgGetKeyBtn = document.querySelector("#cfg-get-key-btn");
const linkAiStudio = document.querySelector("#link-ai-studio");
const cfgSaveBtn = document.querySelector("#cfg-save-btn");
const cfgSyncEdgeBtn = document.querySelector("#cfg-sync-edge-btn");
const settingsBackBtn = document.querySelector("#settings-back");

const codeViewTitle = document.querySelector("#code-view-title");
const modalCodeView = document.querySelector("#modal-code-view");
const codeModalBackBtn = document.querySelector("#code-modal-back");
const toast = document.querySelector("#toast");

let currentMenu = mainMenu;
let previousMenu = mainMenu;
let currentTab = null;
let currentDomain = null;
let currentRecording = null;

let registryUrl = DEFAULT_REGISTRY_URL;
let storeChannel = "STABLE";
let storeQuery = "";
let storePage = 0;
let storeSort = "likesCount";
let storeTotalPages = 1;
let installedPlugins = {};
let uninstalledPlugins = new Set();
let oauthToken = "";
let manualToken = "";
let oauthClientId = DEFAULT_CLIENT_ID;
let toastTimer = null;

function showToast(msg, duration = 2200) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, duration);
}

function showMenu(menu) {
  if (currentMenu) currentMenu.classList.add("hidden");
  menu.classList.remove("hidden");
  previousMenu = currentMenu;
  currentMenu = menu;
}

function loadMainMenu() {
  showMenu(mainMenu);
}

async function syncLocalFolderPlugins() {
  let fileList = [];
  try {
    const jsonRes = await fetch(browserAPI.runtime.getURL("plugins/plugins.json"), { cache: "no-store" });
    if (jsonRes.ok) {
      const list = await jsonRes.json();
      if (Array.isArray(list)) fileList = list;
    }
  } catch (e) {}

  const candidateFiles = Array.from(new Set([...fileList, "fouranime.js", "animeonsen.js"]));
  let updated = false;

  for (const filename of candidateFiles) {
    const derivedId = filename.replace(/\.js$/i, "").toLowerCase();
    if (uninstalledPlugins.has(derivedId)) continue;
    if (installedPlugins[derivedId] && installedPlugins[derivedId].code) continue;

    try {
      const fileUrl = browserAPI.runtime.getURL(`plugins/${filename}`);
      const res = await fetch(fileUrl, { cache: "no-store" });
      if (res.ok) {
        const code = await res.text();
        if (code && (code.includes("search") || code.includes("export default") || code.includes("module.exports"))) {
          const idMatch = code.match(/id\s*:\s*["']([^"']+)["']/);
          const nameMatch = code.match(/name\s*:\s*["']([^"']+)["']/);
          const baseMatch = code.match(/baseUrl\s*:\s*["']([^"']+)["']/);
          const verMatch = code.match(/version\s*:\s*["']([^"']+)["']/);
          const authorMatch = code.match(/author\s*:\s*["']([^"']+)["']/);

          const id = (idMatch ? idMatch[1] : derivedId).toLowerCase().trim();
          if (uninstalledPlugins.has(id)) continue;

          let name = nameMatch ? nameMatch[1] : "";
          if (!name) {
            name = id === "fouranime" ? "4Anime" : (id.charAt(0).toUpperCase() + id.slice(1));
          }
          const baseUrl = baseMatch ? baseMatch[1] : "";
          const version = verMatch ? verMatch[1] : "1.0.0";
          const author = authorMatch ? authorMatch[1] : "Community";

          installedPlugins[id] = {
            id,
            name,
            baseUrl,
            version,
            author,
            channel: "STABLE",
            code,
            installedAt: Date.now(),
          };
          updated = true;
        }
      }
    } catch (e) {}
  }

  if (updated) {
    await browserAPI.storage.local.set({ aggregator_installed_plugins: installedPlugins }).catch(() => {});
  }
}

async function loadConfig() {
  try {
    const data = await browserAPI.storage.local.get([
      "aggregator_registry_url",
      "aggregator_default_channel",
      "aggregator_oauth_token",
      "aggregator_llm_token",
      "aggregator_client_id",
      "aggregator_installed_plugins",
      "aggregator_uninstalled_plugins",
    ]);

    if (data.aggregator_registry_url) {
      registryUrl = data.aggregator_registry_url.replace(/\/+$/, "");
    } else {
      registryUrl = DEFAULT_REGISTRY_URL;
    }

    if (data.aggregator_default_channel) {
      storeChannel = data.aggregator_default_channel;
    }

    if (data.aggregator_llm_token) {
      manualToken = data.aggregator_llm_token;
    }

    if (data.aggregator_uninstalled_plugins && Array.isArray(data.aggregator_uninstalled_plugins)) {
      uninstalledPlugins = new Set(data.aggregator_uninstalled_plugins);
    }

    if (data.aggregator_installed_plugins && typeof data.aggregator_installed_plugins === "object") {
      installedPlugins = data.aggregator_installed_plugins;
      if (installedPlugins["www_animeonsen_xyz"]) {
        const old = installedPlugins["www_animeonsen_xyz"];
        delete installedPlugins["www_animeonsen_xyz"];
        installedPlugins["animeonsen"] = {
          ...old,
          id: "animeonsen",
          name: "AnimeOnsen",
          code: (old.code || "").replace(/["']www_animeonsen_xyz["']/g, '"animeonsen"').replace(/["']WWW Provider["']/g, '"AnimeOnsen"'),
        };
        browserAPI.storage.local.set({ aggregator_installed_plugins: installedPlugins }).catch(() => {});
      }
    } else {
      installedPlugins = {};
    }

    await syncLocalFolderPlugins();

    cfgRegistryUrl.value = registryUrl;
    cfgDefaultChannel.value = storeChannel;
    cfgLlmToken.value = manualToken;

    updateChannelButtons();
  } catch (err) {}
}

async function checkEdgeHealth() {
  try {
    const res = await fetch(`${registryUrl}/health`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const colo = data.edgeColo ? ` (${data.edgeColo})` : "";
      statusBadge.textContent = `Edge Online${colo}`;
    } else {
      statusBadge.textContent = `Edge HTTP ${res.status}`;
    }
  } catch (err) {
    statusBadge.textContent = "Edge Offline";
  }
}

function updateChannelButtons() {
  if (storeChannel === "STABLE") {
    btnChanStable.classList.add("active");
    btnChanNightly.classList.remove("active");
  } else {
    btnChanNightly.classList.add("active");
    btnChanStable.classList.remove("active");
  }
}

async function fetchStorePlugins() {
  storeLoading.classList.remove("hidden");
  storeEmpty.classList.add("hidden");
  storeList.innerHTML = "";
  storePagination.classList.add("hidden");

  const queryTrimmed = storeQuery.trim();
  const queryParam = queryTrimmed ? `&query=${encodeURIComponent(queryTrimmed)}` : "";
  const endpoint = `${registryUrl}/api/v1/plugins?channel=${storeChannel}${queryParam}&page=${storePage}&size=5&sortBy=${storeSort}&direction=desc`;

  try {
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) {
      storeLoading.classList.add("hidden");
      storeEmpty.textContent = `Error: HTTP ${res.status}`;
      storeEmpty.classList.remove("hidden");
      return;
    }

    const data = await res.json();
    let items = data.content || [];
    storeTotalPages = data.totalPages || 0;

    if (items.length === 0 && queryTrimmed) {
      const altChannel = storeChannel === "STABLE" ? "NIGHTLY" : "STABLE";
      const altEndpoint = `${registryUrl}/api/v1/plugins?channel=${altChannel}${queryParam}&page=0&size=5&sortBy=${storeSort}&direction=desc`;
      try {
        const altRes = await fetch(altEndpoint, { cache: "no-store" });
        if (altRes.ok) {
          const altData = await altRes.json();
          if (altData.content && altData.content.length > 0) {
            items = altData.content;
            storeTotalPages = altData.totalPages || 1;
          }
        }
      } catch (e) {}

      if (items.length === 0) {
        try {
          const directRes = await fetch(`${registryUrl}/api/v1/plugins/${encodeURIComponent(queryTrimmed.toLowerCase())}`, { cache: "no-store" });
          if (directRes.ok) {
            const directItem = await directRes.json();
            if (directItem && directItem.id) {
              items = [directItem];
              storeTotalPages = 1;
            }
          }
        } catch (e) {}
      }

      if (items.length === 0) {
        const term = queryTrimmed.toLowerCase();
        const localMatches = Object.values(installedPlugins).filter((p) => {
          return (p.id && p.id.toLowerCase().includes(term)) || (p.name && p.name.toLowerCase().includes(term));
        });
        if (localMatches.length > 0) {
          items = localMatches;
          storeTotalPages = 1;
        }
      }
    } else if (items.length === 0 && !queryTrimmed) {
      const altChannel = storeChannel === "STABLE" ? "NIGHTLY" : "STABLE";
      const altEndpoint = `${registryUrl}/api/v1/plugins?channel=${altChannel}&page=0&size=5&sortBy=${storeSort}&direction=desc`;
      try {
        const altRes = await fetch(altEndpoint, { cache: "no-store" });
        if (altRes.ok) {
          const altData = await altRes.json();
          if (altData.content && altData.content.length > 0) {
            items = altData.content;
            storeTotalPages = altData.totalPages || 1;
          }
        }
      } catch (e) {}
    }

    storeLoading.classList.add("hidden");

    if (items.length === 0) {
      storeEmpty.textContent = "No Plugins Found";
      storeEmpty.classList.remove("hidden");
      return;
    }

    renderPluginCards(items, storeList);

    if (storeTotalPages > 1) {
      storePagination.classList.remove("hidden");
      storePageInfo.textContent = `Page ${storePage + 1}/${storeTotalPages}`;
      storePrevBtn.disabled = storePage <= 0;
      storeNextBtn.disabled = storePage >= storeTotalPages - 1;
    }
  } catch (err) {
    storeLoading.classList.add("hidden");
    storeEmpty.textContent = "Cannot Reach Registry";
    storeEmpty.classList.remove("hidden");
  }
}

async function fetchCurrentSitePlugins() {
  currentSiteList.innerHTML = "";
  btnCurrentSiteGen.classList.add("hidden");
  currentSiteStatus.textContent = "Querying Stable & Nightly...";

  if (!currentDomain) {
    currentSiteStatus.textContent = "No active website domain.";
    return;
  }

  const queryTerm = encodeURIComponent(currentDomain);
  const stableUrl = `${registryUrl}/api/v1/plugins?channel=STABLE&query=${queryTerm}&size=10`;
  const nightlyUrl = `${registryUrl}/api/v1/plugins?channel=NIGHTLY&query=${queryTerm}&size=10`;

  try {
    const [stableRes, nightlyRes] = await Promise.all([
      fetch(stableUrl, { cache: "no-store" }),
      fetch(nightlyUrl, { cache: "no-store" }),
    ]);

    const stableData = stableRes.ok ? await stableRes.json() : { content: [] };
    const nightlyData = nightlyRes.ok ? await nightlyRes.json() : { content: [] };

    const combined = [];
    const seen = new Set();

    for (const item of (stableData.content || [])) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        combined.push(item);
      }
    }

    for (const item of (nightlyData.content || [])) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        combined.push(item);
      }
    }

    if (combined.length === 0) {
      currentSiteStatus.textContent = `No plugins found for ${currentDomain}`;
      btnCurrentSiteGen.classList.remove("hidden");
      return;
    }

    currentSiteStatus.textContent = `Found ${combined.length} plugin(s) available:`;
    renderPluginCards(combined, currentSiteList);
  } catch (err) {
    currentSiteStatus.textContent = "Failed to query registry.";
    btnCurrentSiteGen.classList.remove("hidden");
  }
}

function renderPluginCards(plugins, container) {
  container.innerHTML = "";

  for (const p of plugins) {
    const card = document.createElement("div");
    card.className = "plugin-card";

    const top = document.createElement("div");
    top.className = "card-top";

    const titleBox = document.createElement("div");
    titleBox.className = "card-title-box";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = p.name || p.id;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `v${p.version || "1.0.0"} • By ${p.author || "Anon"}`;

    titleBox.appendChild(title);
    titleBox.appendChild(meta);

    const badge = document.createElement("span");
    const chan = (p.channel || "STABLE").toUpperCase();
    badge.className = `card-badge ${chan === "STABLE" ? "stable" : "nightly"}`;
    badge.textContent = chan;

    top.appendChild(titleBox);
    top.appendChild(badge);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = p.description || p.baseUrl || "No description provided.";

    const bottom = document.createElement("div");
    bottom.className = "card-bottom";

    const voteBox = document.createElement("div");
    voteBox.className = "vote-box";

    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "btn-vote";
    likeBtn.textContent = `▲ ${p.likes || 0}`;
    likeBtn.addEventListener("click", () => ratePlugin(p.id, "LIKE", likeBtn, dislikeBtn));

    const dislikeBtn = document.createElement("button");
    dislikeBtn.type = "button";
    dislikeBtn.className = "btn-vote";
    dislikeBtn.textContent = `▼ ${p.dislikes || 0}`;
    dislikeBtn.addEventListener("click", () => ratePlugin(p.id, "DISLIKE", likeBtn, dislikeBtn));

    voteBox.appendChild(likeBtn);
    voteBox.appendChild(dislikeBtn);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const viewCodeBtn = document.createElement("button");
    viewCodeBtn.type = "button";
    viewCodeBtn.className = "btn-action-sm btn-view-code";
    viewCodeBtn.textContent = "Code";
    viewCodeBtn.addEventListener("click", () => openCodeModal(p.id, p.name));

    const isInstalled = Boolean(installedPlugins[p.id]);
    const installBtn = document.createElement("button");
    installBtn.type = "button";
    installBtn.className = `btn-action-sm ${isInstalled ? "btn-installed" : "btn-install"}`;
    installBtn.textContent = isInstalled ? "Installed" : "Install";
    installBtn.addEventListener("click", () => toggleInstallPlugin(p, installBtn));

    actions.appendChild(viewCodeBtn);
    actions.appendChild(installBtn);

    bottom.appendChild(voteBox);
    bottom.appendChild(actions);

    card.appendChild(top);
    card.appendChild(desc);
    card.appendChild(bottom);

    container.appendChild(card);
  }
}

async function ratePlugin(pluginId, vote, likeBtn, dislikeBtn) {
  try {
    const res = await fetch(`${registryUrl}/api/v1/plugins/${pluginId}/rate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vote }),
    });

    if (res.ok) {
      const data = await res.json();
      likeBtn.textContent = `▲ ${data.likes}`;
      dislikeBtn.textContent = `▼ ${data.dislikes}`;
      if (vote === "LIKE") {
        likeBtn.classList.add("liked");
        dislikeBtn.classList.remove("disliked");
      } else {
        dislikeBtn.classList.add("disliked");
        likeBtn.classList.remove("liked");
      }
      showToast(`Voted ${vote} for ${pluginId}!`);
    } else {
      showToast(`Rating failed: ${res.status}`);
    }
  } catch (err) {
    showToast("Rating network error");
  }
}

async function openCodeModal(pluginId, pluginName) {
  codeViewTitle.textContent = `${pluginName || pluginId} Code`;
  modalCodeView.value = "Fetching plugin code...";
  showMenu(codeModal);

  if (installedPlugins[pluginId] && installedPlugins[pluginId].code) {
    modalCodeView.value = installedPlugins[pluginId].code;
    return;
  }

  try {
    const res = await fetch(`${registryUrl}/api/v1/plugins/${pluginId}/download`);
    if (res.ok) {
      modalCodeView.value = await res.text();
      return;
    }
  } catch (err) {}

  try {
    const localUrl = browserAPI.runtime.getURL(`plugins/${pluginId}.js`);
    const localRes = await fetch(localUrl, { cache: "no-store" });
    if (localRes.ok) {
      modalCodeView.value = await localRes.text();
      return;
    }
  } catch (err) {}

  modalCodeView.value = "Failed to download code.";
}

async function toggleInstallPlugin(plugin, btnElement) {
  if (installedPlugins[plugin.id]) {
    delete installedPlugins[plugin.id];
    uninstalledPlugins.add(plugin.id);
    await browserAPI.storage.local.set({
      aggregator_installed_plugins: installedPlugins,
      aggregator_uninstalled_plugins: Array.from(uninstalledPlugins),
    });
    btnElement.textContent = "Install";
    btnElement.className = "btn-action-sm btn-install";
    showToast(`Uninstalled ${plugin.name || plugin.id}`);
    return;
  }

  btnElement.textContent = "Downloading...";
  btnElement.disabled = true;

  try {
    let code = "";
    try {
      const res = await fetch(`${registryUrl}/api/v1/plugins/${plugin.id}/download`);
      if (res.ok) {
        code = await res.text();
      }
    } catch (e) {}

    if (!code) {
      try {
        const localUrl = browserAPI.runtime.getURL(`plugins/${plugin.id}.js`);
        const localRes = await fetch(localUrl, { cache: "no-store" });
        if (localRes.ok) {
          code = await localRes.text();
        }
      } catch (e) {}
    }

    if (!code && plugin.code) {
      code = plugin.code;
    }

    if (!code) {
      throw new Error("Unable to retrieve plugin code");
    }

    uninstalledPlugins.delete(plugin.id);
    installedPlugins[plugin.id] = {
      id: plugin.id,
      name: plugin.name || plugin.id,
      baseUrl: plugin.baseUrl || "",
      version: plugin.version || "1.0.0",
      author: plugin.author || "Community",
      channel: plugin.channel || "STABLE",
      code,
      installedAt: Date.now(),
    };

    await browserAPI.storage.local.set({
      aggregator_installed_plugins: installedPlugins,
      aggregator_uninstalled_plugins: Array.from(uninstalledPlugins),
    });
    btnElement.textContent = "Installed";
    btnElement.className = "btn-action-sm btn-installed";
    btnElement.disabled = false;
    showToast(`Installed ${plugin.name || plugin.id}!`);
  } catch (err) {
    btnElement.textContent = "Install";
    btnElement.className = "btn-action-sm btn-install";
    btnElement.disabled = false;
    showToast("Download failed");
  }
}

async function detectActiveTab() {
  try {
    let tabs = await browserAPI.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });

    if (!tabs || tabs.length === 0) {
      tabs = await browserAPI.tabs.query({
        active: true,
        currentWindow: true,
      });
    }

    if (!tabs || tabs.length === 0) {
      tabs = await browserAPI.tabs.query({
        active: true,
      });
    }

    const tab = tabs && tabs[0];
    if (tab && tab.url) {
      currentTab = tab;
      try {
        currentDomain = new URL(tab.url).hostname;
      } catch (e) {
        currentDomain = null;
      }
    }
  } catch (err) {
    currentTab = null;
    currentDomain = null;
  }
}

async function loadGenMenu() {
  showMenu(genMenu);
  analyzeBtn.disabled = true;
  generateBtn.disabled = true;

  await detectActiveTab();

  if (!currentDomain) {
    genDomainBadge.textContent = "No Active Webpage";
    genTraceBadge.textContent = "Status: Idle";
    return;
  }

  genDomainBadge.textContent = `Site: ${currentDomain}`;
  analyzeBtn.disabled = false;

  const key = `recording_${currentDomain}`;
  const data = await browserAPI.storage.local.get(key);

  if (data[key]) {
    currentRecording = data[key];
    let totalReqs = 0;
    if (currentRecording.phases) {
      for (const p of Object.values(currentRecording.phases)) {
        if (Array.isArray(p)) totalReqs += p.length;
      }
    }
    genTraceBadge.textContent = `Captured: ${totalReqs} requests`;
    generateBtn.disabled = false;
    analyzeBtn.textContent = "Retry Analysis?";
  } else {
    currentRecording = null;
    genTraceBadge.textContent = "Status: No Trace";
    generateBtn.disabled = true;
    analyzeBtn.textContent = "Analyze";
  }
}

function openAnalyzer() {
  if (!currentTab || !currentDomain) return;

  const width = 340;
  const height = 430;
  const left = window.screen.availWidth - width - 20;
  const top = 40;

  const url = browserAPI.runtime.getURL(
    `analyzer/analyzer.html?tabId=${currentTab.id}&domain=${encodeURIComponent(currentDomain)}`
  );

  browserAPI.windows.create({
    url,
    type: "popup",
    width,
    height,
    left,
    top,
  });

  window.close();
}

function openLlmGeneratorWindow() {
  if (!currentDomain) return;

  const width = 440;
  const height = 500;
  const left = window.screen.availWidth - width - 30;
  const top = 50;

  const url = browserAPI.runtime.getURL(
    `generator/generator.html?domain=${encodeURIComponent(currentDomain)}`
  );

  browserAPI.windows.create({
    url,
    type: "popup",
    width,
    height,
    left,
    top,
  });

  window.close();
}

async function saveSettings() {
  const regUrl = cfgRegistryUrl.value.trim().replace(/\/+$/, "");
  const chan = cfgDefaultChannel.value;
  const token = cfgLlmToken.value.trim();

  registryUrl = regUrl || DEFAULT_REGISTRY_URL;
  storeChannel = chan;
  manualToken = token;

  await browserAPI.storage.local.set({
    aggregator_registry_url: registryUrl,
    aggregator_default_channel: storeChannel,
    aggregator_llm_token: manualToken,
  });

  updateChannelButtons();
  checkEdgeHealth();
  showToast("Settings saved!");
}

async function syncEdgeCache() {
  cfgSyncEdgeBtn.disabled = true;
  cfgSyncEdgeBtn.textContent = "Syncing...";

  try {
    const res = await fetch(`${registryUrl}/api/v1/edge/sync`, {
      method: "POST",
    });

    if (res.ok) {
      showToast("Synced!");
    } else {
      showToast(`Sync failed: HTTP ${res.status}`);
    }
  } catch (err) {
    showToast("Sync network error");
  } finally {
    cfgSyncEdgeBtn.disabled = false;
    cfgSyncEdgeBtn.textContent = "Sync";
  }
}

function openAddPluginMenu() {
  showMenu(addPluginMenu);
}

async function openCurrentSiteMenu() {
  showMenu(currentSiteMenu);
  await detectActiveTab();
  currentSiteDomainBadge.textContent = currentDomain ? `Site: ${currentDomain}` : "Site: Unknown";
  fetchCurrentSitePlugins();
}

function openStoreMenu() {
  showMenu(storeMenu);
  fetchStorePlugins();
}

function openSettingsMenu() {
  showMenu(settingsMenu);
}

async function openManagePluginsMenu() {
  showMenu(managePluginsMenu);
  await renderManagePlugins();
}

async function renderManagePlugins() {
  managePluginsList.innerHTML = "";
  managePluginsLoading.classList.remove("hidden");
  managePluginsEmpty.classList.add("hidden");

  try {
    const data = await browserAPI.storage.local.get([
      "aggregator_installed_plugins",
      "aggregator_uninstalled_plugins",
    ]);
    if (data.aggregator_installed_plugins && typeof data.aggregator_installed_plugins === "object") {
      installedPlugins = data.aggregator_installed_plugins;
    }
    if (data.aggregator_uninstalled_plugins && Array.isArray(data.aggregator_uninstalled_plugins)) {
      uninstalledPlugins = new Set(data.aggregator_uninstalled_plugins);
    }
  } catch (err) {}

  await syncLocalFolderPlugins();

  const installedList = Object.values(installedPlugins);

  if (installedList.length === 0) {
    managePluginsLoading.classList.add("hidden");
    managePluginsEmpty.classList.remove("hidden");
    return;
  }

  const liveRatings = new Map();
  try {
    const promises = installedList.map(async (p) => {
      try {
        const res = await fetch(`${registryUrl}/api/v1/plugins/${p.id}`, { cache: "no-store" });
        if (res.ok) {
          const info = await res.json();
          liveRatings.set(p.id, {
            likes: info.likes || info.likesCount || 0,
            dislikes: info.dislikes || info.dislikesCount || 0,
            channel: info.channel || p.channel,
          });
        }
      } catch (e) {}
    });
    await Promise.all(promises);
  } catch (err) {}

  managePluginsLoading.classList.add("hidden");
  managePluginsList.innerHTML = "";

  for (const p of installedList) {
    const live = liveRatings.get(p.id);
    const likes = live ? live.likes : (p.likes || 0);
    const dislikes = live ? live.dislikes : (p.dislikes || 0);
    const chan = ((live && live.channel) || p.channel || "STABLE").toUpperCase();

    const card = document.createElement("div");
    card.className = "plugin-card";

    const top = document.createElement("div");
    top.className = "card-top";

    const titleBox = document.createElement("div");
    titleBox.className = "card-title-box";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = p.name || p.id;

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.textContent = `v${p.version || "1.0.0"} • By ${p.author || "User"}`;

    titleBox.appendChild(title);
    titleBox.appendChild(meta);

    const badge = document.createElement("span");
    badge.className = `card-badge ${chan === "STABLE" ? "stable" : "nightly"}`;
    badge.textContent = chan;

    top.appendChild(titleBox);
    top.appendChild(badge);

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = p.description || p.baseUrl || "Installed plugin.";

    const bottom = document.createElement("div");
    bottom.className = "card-bottom";

    const voteBox = document.createElement("div");
    voteBox.className = "vote-box";

    const likeBtn = document.createElement("button");
    likeBtn.type = "button";
    likeBtn.className = "btn-vote";
    likeBtn.textContent = `▲ ${likes}`;
    likeBtn.addEventListener("click", () => ratePlugin(p.id, "LIKE", likeBtn, dislikeBtn));

    const dislikeBtn = document.createElement("button");
    dislikeBtn.type = "button";
    dislikeBtn.className = "btn-vote";
    dislikeBtn.textContent = `▼ ${dislikes}`;
    dislikeBtn.addEventListener("click", () => ratePlugin(p.id, "DISLIKE", likeBtn, dislikeBtn));

    voteBox.appendChild(likeBtn);
    voteBox.appendChild(dislikeBtn);

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const viewCodeBtn = document.createElement("button");
    viewCodeBtn.type = "button";
    viewCodeBtn.className = "btn-action-sm btn-view-code";
    viewCodeBtn.textContent = "Code";
    viewCodeBtn.addEventListener("click", () => {
      codeViewTitle.textContent = `${p.name || p.id} Code`;
      modalCodeView.value = p.code || "No code available.";
      showMenu(codeModal);
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-action-sm btn-remove";
    removeBtn.textContent = "Uninstall";
    removeBtn.addEventListener("click", async () => {
      delete installedPlugins[p.id];
      uninstalledPlugins.add(p.id);
      await browserAPI.storage.local.set({
        aggregator_installed_plugins: installedPlugins,
        aggregator_uninstalled_plugins: Array.from(uninstalledPlugins),
      });
      showToast(`Uninstalled ${p.name || p.id}`);
      await renderManagePlugins();
    });

    actions.appendChild(viewCodeBtn);
    actions.appendChild(removeBtn);

    bottom.appendChild(voteBox);
    bottom.appendChild(actions);

    card.appendChild(top);
    card.appendChild(desc);
    card.appendChild(bottom);

    managePluginsList.appendChild(card);
  }
}

if (agBtn) {
  agBtn.addEventListener("click", () => {
    browserAPI.tabs.create({
      url: browserAPI.runtime.getURL("super-website/super-website/dist/index.html"),
    });
  });
}

if (openAddPluginBtn) openAddPluginBtn.addEventListener("click", openAddPluginMenu);
if (openManagePluginsBtn) openManagePluginsBtn.addEventListener("click", openManagePluginsMenu);
if (openSettingsBtn) openSettingsBtn.addEventListener("click", openSettingsMenu);

if (btnAddCurrentSite) btnAddCurrentSite.addEventListener("click", openCurrentSiteMenu);
if (btnSearchPlugins) btnSearchPlugins.addEventListener("click", openStoreMenu);
if (btnAttemptGen) btnAttemptGen.addEventListener("click", loadGenMenu);

if (btnCurrentSiteGen) btnCurrentSiteGen.addEventListener("click", loadGenMenu);

if (addPluginBackBtn) addPluginBackBtn.addEventListener("click", loadMainMenu);
if (managePluginsBackBtn) managePluginsBackBtn.addEventListener("click", loadMainMenu);
if (currentSiteBackBtn) currentSiteBackBtn.addEventListener("click", () => showMenu(addPluginMenu));
if (storeBackBtn) storeBackBtn.addEventListener("click", () => showMenu(addPluginMenu));
if (genBackBtn) genBackBtn.addEventListener("click", () => showMenu(addPluginMenu));
if (settingsBackBtn) settingsBackBtn.addEventListener("click", loadMainMenu);
if (codeModalBackBtn) codeModalBackBtn.addEventListener("click", () => showMenu(previousMenu));

if (btnChanStable) {
  btnChanStable.addEventListener("click", () => {
    if (storeChannel !== "STABLE") {
      storeChannel = "STABLE";
      updateChannelButtons();
      storePage = 0;
      fetchStorePlugins();
    }
  });
}

if (btnChanNightly) {
  btnChanNightly.addEventListener("click", () => {
    if (storeChannel !== "NIGHTLY") {
      storeChannel = "NIGHTLY";
      updateChannelButtons();
      storePage = 0;
      fetchStorePlugins();
    }
  });
}

if (storeSearchInput) {
  let searchTimer = null;
  storeSearchInput.addEventListener("input", () => {
    storeQuery = storeSearchInput.value;
    storeSearchClear.classList.toggle("hidden", !storeQuery);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      storePage = 0;
      fetchStorePlugins();
    }, 350);
  });
}

if (storeSearchClear) {
  storeSearchClear.addEventListener("click", () => {
    storeSearchInput.value = "";
    storeQuery = "";
    storeSearchClear.classList.add("hidden");
    storePage = 0;
    fetchStorePlugins();
  });
}

if (storeSortSelect) {
  storeSortSelect.addEventListener("change", () => {
    storeSort = storeSortSelect.value;
    storePage = 0;
    fetchStorePlugins();
  });
}

if (storePrevBtn) {
  storePrevBtn.addEventListener("click", () => {
    if (storePage > 0) {
      storePage--;
      fetchStorePlugins();
    }
  });
}

if (storeNextBtn) {
  storeNextBtn.addEventListener("click", () => {
    if (storePage < storeTotalPages - 1) {
      storePage++;
      fetchStorePlugins();
    }
  });
}

if (analyzeBtn) analyzeBtn.addEventListener("click", openAnalyzer);
if (generateBtn) generateBtn.addEventListener("click", openLlmGeneratorWindow);

if (cfgGetKeyBtn) {
  cfgGetKeyBtn.addEventListener("click", () => {
    browserAPI.tabs.create({ url: "https://aistudio.google.com/app/apikey" });
  });
}
if (linkAiStudio) {
  linkAiStudio.addEventListener("click", (e) => {
    e.preventDefault();
    browserAPI.tabs.create({ url: "https://aistudio.google.com/app/apikey" });
  });
}
if (cfgSaveBtn) cfgSaveBtn.addEventListener("click", saveSettings);
if (cfgSyncEdgeBtn) cfgSyncEdgeBtn.addEventListener("click", syncEdgeCache);

async function init() {
  await loadConfig();
  checkEdgeHealth();
  detectActiveTab();
}

init();
