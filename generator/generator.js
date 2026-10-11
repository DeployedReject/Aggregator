const browserAPI = globalThis.browser || globalThis.chrome;

const DEFAULT_REGISTRY_URL = "https://aggregator-registry.mishravaibhav2048.workers.dev";

const params = new URLSearchParams(window.location.search);
const domain = params.get("domain") || "unknown.com";

const genDomain = document.querySelector("#gen-domain");
const genStatus = document.querySelector("#gen-status");
const consoleLog = document.querySelector("#console-log");
const codePanel = document.querySelector("#code-panel");
const codeOutput = document.querySelector("#code-output");
const testResult = document.querySelector("#test-result");

const btnRunLoop = document.querySelector("#btn-run-loop");
const btnCancel = document.querySelector("#btn-cancel");
const btnResetSession = document.querySelector("#btn-reset-session");
const btnSaveCode = document.querySelector("#btn-save-code");
const btnDownloadCode = document.querySelector("#btn-download-code");
const btnPublishCode = document.querySelector("#btn-publish-code");
const btnExportLogs = document.querySelector("#btn-export-logs");
const btnClose = document.querySelector("#btn-close");

const trialPanel = document.querySelector("#trial-panel");
const btnLaunchTrial = document.querySelector("#btn-launch-trial");
const btnApproveTrial = document.querySelector("#btn-approve-trial");
const btnRejectTrial = document.querySelector("#btn-reject-trial");
const trialFeedbackBox = document.querySelector("#trial-feedback-box");
const trialFeedbackInput = document.querySelector("#trial-feedback-input");
const btnSubmitFeedback = document.querySelector("#btn-submit-feedback");

let recordingData = null;
let oauthToken = "";
let manualToken = "";
let geminiToken = "";
let openRouterToken = "";
let llmProvider = "AUTO";
let registryUrl = DEFAULT_REGISTRY_URL;
let isLoopRunning = false;
let currentAbortController = null;
const rawDiagnosticSessionLogs = [];

let candidateGeminiModels = [];
let candidateOpenRouterModels = [];
let activeGeminiModelIndex = 0;
let activeOpenRouterModelIndex = 0;

const unsupportedChainingModels = new Set();
const statelessModels = new Set();

// Dotted spiral spinner frames used in terminal CLI scripts
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function appendAnsiToElement(parentEl, text) {
  if (!text) return;
  const parts = text.split(/(\x1b\[[0-9;]*m)/g);
  let currentClass = "";

  for (const part of parts) {
    if (!part) continue;
    if (part === "\x1b[32m") {
      currentClass = "ansi-green";
    } else if (part === "\x1b[33m") {
      currentClass = "ansi-yellow";
    } else if (part === "\x1b[36m") {
      currentClass = "ansi-cyan";
    } else if (part === "\x1b[35m") {
      currentClass = "ansi-purple";
    } else if (part === "\x1b[31m") {
      currentClass = "ansi-red";
    } else if (part === "\x1b[34m") {
      currentClass = "ansi-blue";
    } else if (part === "\x1b[1m") {
      currentClass = "ansi-bold";
    } else if (part === "\x1b[2m") {
      currentClass = "ansi-dim";
    } else if (part === "\x1b[0m") {
      currentClass = "";
    } else if (part.startsWith("\x1b[")) {
      // ignore other escape codes
    } else {
      if (currentClass) {
        const span = document.createElement("span");
        span.className = currentClass;
        span.textContent = part;
        parentEl.appendChild(span);
      } else {
        parentEl.appendChild(document.createTextNode(part));
      }
    }
  }
}

function renderProgressBarToElement(el, time, percent, totalWidth = 20, label = "", colorClass = "ansi-green") {
  el.textContent = "";
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clamped / 100) * totalWidth);
  const empty = totalWidth - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pctStr = clamped.toString().padStart(3, " ");

  const headerSpan = document.createElement("span");
  headerSpan.textContent = `[${time}] [PROG] [`;
  el.appendChild(headerSpan);

  const barSpan = document.createElement("span");
  barSpan.className = colorClass;
  barSpan.textContent = bar;
  el.appendChild(barSpan);

  const pctSpan = document.createElement("span");
  pctSpan.textContent = `] ${pctStr}%`;
  el.appendChild(pctSpan);

  if (label) {
    const divSpan = document.createElement("span");
    divSpan.className = "ansi-dim";
    divSpan.textContent = " │ ";
    el.appendChild(divSpan);

    const lblSpan = document.createElement("span");
    lblSpan.className = colorClass;
    lblSpan.textContent = label;
    el.appendChild(lblSpan);
  }
}

function appendLog(type, text) {
  const el = document.createElement("div");
  el.className = `log-entry log-${type}`;

  const time = new Date().toLocaleTimeString().split(" ")[0];
  const tag = type.toUpperCase().padEnd(4, " ");

  const headerSpan = document.createElement("span");
  headerSpan.textContent = `[${time}] [${tag}] `;
  el.appendChild(headerSpan);

  if (text && text.includes("\x1b[")) {
    appendAnsiToElement(el, text);
  } else {
    el.appendChild(document.createTextNode(text || ""));
  }

  consoleLog.appendChild(el);
  consoleLog.scrollTop = consoleLog.scrollHeight;
  return el;
}

function appendPayloadLog(title, content, meta = "", isIncoming = false) {
  const el = document.createElement("div");
  el.className = isIncoming ? "log-entry log-resp" : "log-entry log-out";

  const time = new Date().toLocaleTimeString().split(" ")[0];
  const headerSpan = document.createElement("span");
  headerSpan.textContent = isIncoming ? `[${time}] [RECV] ` : `[${time}] [SEND] `;
  el.appendChild(headerSpan);

  const titleSpan = document.createElement("span");
  titleSpan.className = isIncoming ? "ansi-cyan ansi-bold" : "ansi-purple ansi-bold";
  titleSpan.textContent = title + (meta ? ` (${meta})` : "");
  el.appendChild(titleSpan);

  if (content) {
    const box = document.createElement("div");
    box.className = "log-payload";
    box.textContent = content.length > 2500 ? content.substring(0, 2500) + "\n... [TRUNCATED FOR DISPLAY]" : content;
    el.appendChild(box);
  }

  consoleLog.appendChild(el);
  consoleLog.scrollTop = consoleLog.scrollHeight;
  return el;
}

async function animateProgressBar(label, durationMs = 450, colorClass = "ansi-green") {
  const el = document.createElement("div");
  el.className = "log-entry log-progress";
  consoleLog.appendChild(el);

  const time = new Date().toLocaleTimeString().split(" ")[0];
  const steps = 10;
  const stepInterval = durationMs / steps;

  for (let i = 1; i <= steps; i++) {
    const pct = Math.round((i / steps) * 100);
    renderProgressBarToElement(el, time, pct, 20, label, colorClass);
    consoleLog.scrollTop = consoleLog.scrollHeight;
    await new Promise((r) => setTimeout(r, stepInterval));
  }
}

// Live Dotted Spiral Spinner Manager
const Spinner = {
  timer: null,
  frameIdx: 0,
  startTime: 0,
  activeText: "",
  consoleEl: null,

  start(text, showInConsole = true) {
    this.stop();
    this.activeText = text;
    this.frameIdx = 0;
    this.startTime = Date.now();
    genStatus.classList.remove("status-network-err");

    if (showInConsole) {
      this.consoleEl = document.createElement("div");
      this.consoleEl.className = "log-entry log-spinner";
      consoleLog.appendChild(this.consoleEl);
    }

    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % SPINNER_FRAMES.length;
      const frame = SPINNER_FRAMES[this.frameIdx];
      const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
      const min = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
      const sec = String(elapsedSec % 60).padStart(2, "0");
      const timerStr = `[${min}:${sec}]`;

      genStatus.textContent = `${frame} ${timerStr} ${this.activeText}`;

      if (this.consoleEl) {
        const time = new Date().toLocaleTimeString().split(" ")[0];
        this.consoleEl.textContent = "";

        const headerSpan = document.createElement("span");
        headerSpan.textContent = `[${time}] [WAIT] `;
        this.consoleEl.appendChild(headerSpan);

        const frameSpan = document.createElement("span");
        frameSpan.className = "ansi-cyan ansi-bold";
        frameSpan.textContent = `${frame} `;
        this.consoleEl.appendChild(frameSpan);

        const timerSpan = document.createElement("span");
        timerSpan.className = "ansi-dim";
        timerSpan.textContent = `${timerStr} `;
        this.consoleEl.appendChild(timerSpan);

        const textSpan = document.createElement("span");
        textSpan.className = "ansi-cyan";
        textSpan.textContent = this.activeText;
        this.consoleEl.appendChild(textSpan);

        consoleLog.scrollTop = consoleLog.scrollHeight;
      }
    }, 60);
  },

  update(text) {
    this.activeText = text;
  },

  succeed(text, icon = "[OK]") {
    this.stop();
    genStatus.classList.remove("status-network-err");
    genStatus.textContent = `${icon} ${text}`;
    appendLog("resp", `${icon} ${text}`);
  },

  warn(text, icon = "[WARN]") {
    this.stop();
    genStatus.classList.add("status-network-err");
    genStatus.textContent = `${icon} ${text}`;
    appendLog("warn", `${icon} ${text}`);
  },

  fail(text, icon = "[FAIL]") {
    this.stop();
    genStatus.classList.remove("status-network-err");
    genStatus.textContent = `${icon} ${text}`;
    appendLog("err", `${icon} ${text}`);
  },

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.consoleEl) {
      this.consoleEl.remove();
      this.consoleEl = null;
    }
  },
};

// Live Animated Fail / Retry Countdown Visualizer
async function runRetryCountdown(label, totalSeconds = 4, { colorClass = "ansi-yellow", isNetworkErr = false } = {}) {
  Spinner.stop();
  if (isNetworkErr) {
    genStatus.classList.add("status-network-err");
  }

  const logEl = document.createElement("div");
  logEl.className = "log-entry log-progress";
  consoleLog.appendChild(logEl);

  const totalMs = totalSeconds * 1000;
  const startTime = Date.now();
  const updateInterval = 50;

  while (true) {
    if (currentAbortController && currentAbortController.signal.aborted) {
      logEl.remove();
      throw new Error("Aborted by user");
    }

    const elapsed = Date.now() - startTime;
    const remainingMs = Math.max(0, totalMs - elapsed);
    const remainingSec = (remainingMs / 1000).toFixed(1);
    const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
    const time = new Date().toLocaleTimeString().split(" ")[0];

    renderProgressBarToElement(logEl, time, pct, 20, `${label} (${remainingSec}s)`, colorClass);
    genStatus.textContent = `[${remainingSec}s] ${label} (${pct}%)`;
    consoleLog.scrollTop = consoleLog.scrollHeight;

    if (elapsed >= totalMs) break;
    await new Promise((r) => setTimeout(r, Math.min(updateInterval, remainingMs)));
  }

  logEl.remove();
  genStatus.classList.remove("status-network-err");
}

// Resilient Network Fetcher with Backoff, Timeout, and Visual Indicators
async function fetchWithNetworkRetry(url, options = {}, { maxRetries = 3, timeoutMs = 45000, contextLabel = "API Request" } = {}) {
  let attempt = 0;

  while (attempt <= maxRetries) {
    if (!isLoopRunning || (currentAbortController && currentAbortController.signal.aborted) || (options.signal && options.signal.aborted)) {
      throw new Error("Aborted by user");
    }

    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), timeoutMs);

    const onUserAbort = () => abortCtrl.abort();
    if (options.signal) {
      options.signal.addEventListener("abort", onUserAbort);
    }
    if (currentAbortController) {
      currentAbortController.signal.addEventListener("abort", onUserAbort);
    }

    try {
      const fetchOptions = {
        ...options,
        signal: abortCtrl.signal,
      };

      const attemptLabel = attempt > 0 ? `${contextLabel} (Attempt ${attempt + 1}/${maxRetries + 1})` : contextLabel;
      Spinner.start(`${attemptLabel}: Waiting for model response...`);

      const res = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onUserAbort);
      }
      if (currentAbortController) {
        currentAbortController.signal.removeEventListener("abort", onUserAbort);
      }
      Spinner.stop();

      if (!isLoopRunning) {
        throw new Error("Aborted by user");
      }

      // Check for transient HTTP server errors (429 Rate Limit, 500, 502, 503, 504)
      const isTransientHttp = res.status === 429 || (res.status >= 500 && res.status <= 504);

      if (isTransientHttp && attempt < maxRetries && isLoopRunning) {
        attempt++;
        const backoffMs = Math.min(1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 400), 8000);
        const retrySec = Math.ceil(backoffMs / 1000);

        await runRetryCountdown(`${contextLabel}: HTTP ${res.status}`, retrySec, {
          colorClass: "ansi-yellow",
          isNetworkErr: true,
        });
        continue;
      }

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        res,
        isNetworkError: false,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener("abort", onUserAbort);
      }
      if (currentAbortController) {
        currentAbortController.signal.removeEventListener("abort", onUserAbort);
      }
      Spinner.stop();

      if (!isLoopRunning || (currentAbortController && currentAbortController.signal.aborted) || (options.signal && options.signal.aborted) || err.message === "Aborted by user") {
        throw new Error("Aborted by user");
      }

      const isNetworkFail =
        err.name === "AbortError" ||
        err.message?.includes("Failed to fetch") ||
        err.message?.includes("NetworkError") ||
        err.message?.includes("network") ||
        !navigator.onLine;

      if (isNetworkFail && attempt < maxRetries && isLoopRunning) {
        attempt++;
        const isOffline = !navigator.onLine;
        const backoffMs = Math.min(1500 * Math.pow(2, attempt) + Math.floor(Math.random() * 400), 8000);
        const retrySec = Math.ceil(backoffMs / 1000);
        const errMsg = isOffline ? "Offline / No Internet" : (err.name === "AbortError" ? "Request Timeout" : err.message);

        await runRetryCountdown(`Network Drop (${errMsg})`, retrySec, {
          colorClass: "ansi-red",
          isNetworkErr: true,
        });
        continue;
      }

      return {
        ok: false,
        status: 0,
        statusText: "Network Error",
        error: err.message || "Failed to fetch",
        isNetworkError: true,
      };
    }
  }

  return {
    ok: false,
    status: 0,
    statusText: "Max Retries Exceeded",
    error: "Network retries exhausted",
    isNetworkError: true,
  };
}

function parseCurlCommand(rawCmd) {
  const cmd = rawCmd.replace(/\\\r?\n/g, " ").trim();
  let method = "GET";
  let url = "";
  const headers = {};
  let body = null;

  const methodMatch = cmd.match(/(?:-X|--request)\s+([A-Z]+)/i);
  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
  }

  const headerMatches = cmd.matchAll(/(?:-H|--header)\s+(?:'([^']+)'|"([^"]+)")/g);
  for (const m of headerMatches) {
    const rawH = m[1] || m[2] || "";
    const colonIdx = rawH.indexOf(":");
    if (colonIdx > 0) {
      const hName = rawH.substring(0, colonIdx).trim();
      const hVal = rawH.substring(colonIdx + 1).trim();
      headers[hName] = hVal;
    }
  }

  const uaMatch = cmd.match(/(?:-A|--user-agent)\s+(?:'([^']+)'|"([^"]+)"|([^\s"']+))/i);
  if (uaMatch) {
    headers["User-Agent"] = uaMatch[1] || uaMatch[2] || uaMatch[3];
  }

  const cookieMatch = cmd.match(/(?:-b|--cookie)\s+(?:'([^']+)'|"([^"]+)"|([^\s"']+))/i);
  if (cookieMatch) {
    headers["Cookie"] = cookieMatch[1] || cookieMatch[2] || cookieMatch[3];
  }

  const dataMatches = [
    cmd.match(/(?:-d|--data|--data-raw|--data-binary|--data-urlencode)\s+'([\s\S]*?)'/),
    cmd.match(/(?:-d|--data|--data-raw|--data-binary|--data-urlencode)\s+"([\s\S]*?)"/),
    cmd.match(/(?:-d|--data|--data-raw|--data-binary|--data-urlencode)\s+([^\s"']+)/),
  ];
  for (const dm of dataMatches) {
    if (dm && dm[1]) {
      body = dm[1];
      if (!methodMatch) method = "POST";
      break;
    }
  }

  const quotedUrlMatch =
    cmd.match(/(?:'|")(https?:\/\/[^'"]+)(?:'|")/) ||
    cmd.match(/https?:\/\/[^\s"']+/);
  if (quotedUrlMatch) {
    url = quotedUrlMatch[1] || quotedUrlMatch[0];
  }

  if (body && !headers["Content-Type"]) {
    if (body.startsWith("{") || body.startsWith("[")) {
      headers["Content-Type"] = "application/json";
    } else if (body.includes("=")) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  }

  return { method, url, headers, body };
}

function parseProbeBlock(block) {
  const trimmed = block.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      return {
        method: (obj.method || "GET").toUpperCase(),
        url: obj.url || "",
        headers: obj.headers || {},
        body: obj.body ? (typeof obj.body === "object" ? JSON.stringify(obj.body) : String(obj.body)) : null,
      };
    } catch (e) {}
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      if (obj.url) {
        return {
          method: (obj.method || "GET").toUpperCase(),
          url: obj.url,
          headers: obj.headers || {},
          body: obj.body ? (typeof obj.body === "object" ? JSON.stringify(obj.body) : String(obj.body)) : null,
        };
      }
    } catch (e) {}
  }

  let method = "GET";
  let url = "";
  let headers = {};
  let body = null;

  const mMatch = block.match(/METHOD:\s*([A-Z]+)/i);
  if (mMatch) method = mMatch[1].toUpperCase();

  const uMatch = block.match(/URL:\s*(https?:\/\/[^\s\n]+)/i);
  if (uMatch) url = uMatch[1];

  const hMatch = block.match(/HEADERS:\s*(\{[\s\S]*?\})(?=\n[A-Z]+:|$)/i) || block.match(/HEADERS:\s*(\{[^}]+\})/i);
  if (hMatch) {
    try {
      headers = JSON.parse(hMatch[1]);
    } catch (e) {}
  }

  const bMatch = block.match(/BODY:\s*([\s\S]*?)(?=\n[A-Z]+:|$)/i) || block.match(/BODY:\s*([^\n]+)/i);
  if (bMatch) body = bMatch[1].trim();

  return { method, url, headers, body };
}

async function getEffectiveRegistryUrl() {
  try {
    const data = await browserAPI.storage.local.get("aggregator_registry_url");
    return (data.aggregator_registry_url || DEFAULT_REGISTRY_URL).replace(/\/+$/, "");
  } catch (e) {
    return DEFAULT_REGISTRY_URL;
  }
}

async function executeProbeRequest(probe) {
  if (!probe.url) {
    return { status: 0, statusText: "Invalid URL", body: "No URL specified in probe", totalLength: 0 };
  }

  const reqHeaders = { ...probe.headers };
  if (!reqHeaders["User-Agent"]) {
    reqHeaders["User-Agent"] = navigator.userAgent;
  }

  const init = {
    method: probe.method,
    headers: reqHeaders,
  };

  if (probe.body && probe.method !== "GET" && probe.method !== "HEAD") {
    init.body = probe.body;
  }

  try {
    const netResult = await fetchWithNetworkRetry(probe.url, init, {
      maxRetries: 1,
      timeoutMs: 15000,
      contextLabel: `Probe (${probe.method} ${probe.url.substring(0, 40)})`,
    });

    if (netResult.res) {
      const contentType = netResult.res.headers.get("content-type") || "";
      const rawText = await netResult.res.text();
      const snippet = rawText.length > 2500 ? rawText.substring(0, 2500) + "\n...[TRUNCATED]" : rawText;

      return {
        status: netResult.status,
        statusText: netResult.statusText,
        contentType,
        body: snippet,
        totalLength: rawText.length,
      };
    }
  } catch (err) {
    // Fall through to Edge Proxy Fallback
  }

  // Fallback: Route probe through Cloudflare Edge Worker Proxy
  try {
    const regUrl = await getEffectiveRegistryUrl();
    const proxyUrl = `${regUrl}/api/v1/proxy?url=${encodeURIComponent(probe.url)}`;
    appendLog("warn", `\x1b[33m[Proxy Fallback]\x1b[0m Direct probe unreachable. Retrying via Cloudflare Edge Proxy...`);
    const proxyRes = await fetch(proxyUrl, {
      method: probe.method,
      headers: reqHeaders,
      body: probe.body && probe.method !== "GET" && probe.method !== "HEAD" ? probe.body : undefined,
    });
    const contentType = proxyRes.headers.get("content-type") || "";
    const rawText = await proxyRes.text();
    const snippet = rawText.length > 2500 ? rawText.substring(0, 2500) + "\n...[TRUNCATED]" : rawText;
    return {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      contentType,
      body: snippet,
      totalLength: rawText.length,
    };
  } catch (proxyErr) {
    return {
      status: 500,
      statusText: "Proxy Fetch Error",
      contentType: "text/plain",
      body: `Direct fetch and Edge proxy both failed: ${proxyErr.message}`,
      totalLength: proxyErr.message.length,
    };
  }
}

function getDiagnosticLogsStorageKey(siteDomain) {
  return `aggregator_history_logs_${(siteDomain || domain || "unknown").replace(/[^a-z0-9]/gi, "_")}`;
}

async function loadPersistedSessionLogs(siteDomain = domain) {
  try {
    const key = getDiagnosticLogsStorageKey(siteDomain);
    const data = await browserAPI.storage.local.get(key);
    return Array.isArray(data[key]) ? data[key] : [];
  } catch (e) {
    return [];
  }
}

async function persistSessionLogs(siteDomain = domain) {
  try {
    const key = getDiagnosticLogsStorageKey(siteDomain);
    await browserAPI.storage.local.set({ [key]: rawDiagnosticSessionLogs });
  } catch (e) {
    console.error("Failed to persist diagnostic logs:", e);
  }
}

function appendDiagnosticTurn(entry) {
  const logEntry = {
    turnId: rawDiagnosticSessionLogs.length + 1,
    timestamp: new Date().toISOString(),
    domain,
    ...entry,
  };
  rawDiagnosticSessionLogs.push(logEntry);
  persistSessionLogs(domain);
  return logEntry;
}

function updateLastDiagnosticTurn(updates) {
  if (rawDiagnosticSessionLogs.length > 0) {
    Object.assign(rawDiagnosticSessionLogs[rawDiagnosticSessionLogs.length - 1], updates);
    persistSessionLogs(domain);
  }
}

function getCheckpointStorageKey(siteDomain) {
  return `aggregator_checkpoint_${(siteDomain || domain || "unknown").replace(/[^a-z0-9]/gi, "_")}`;
}

async function loadSessionCheckpoint(siteDomain = domain) {
  try {
    const key = getCheckpointStorageKey(siteDomain);
    const data = await browserAPI.storage.local.get(key);
    return data[key] || null;
  } catch (e) {
    return null;
  }
}

async function saveSessionCheckpoint(checkpointData, siteDomain = domain) {
  try {
    const key = getCheckpointStorageKey(siteDomain);
    const current = (await loadSessionCheckpoint(siteDomain)) || {};
    await browserAPI.storage.local.set({
      [key]: {
        ...current,
        domain: siteDomain,
        savedAt: new Date().toISOString(),
        ...checkpointData,
      },
    });
  } catch (e) {
    console.error("Failed to save session checkpoint:", e);
  }
}

async function clearSessionCheckpoint(siteDomain = domain) {
  try {
    const key = getCheckpointStorageKey(siteDomain);
    await browserAPI.storage.local.remove(key);
    if (btnResetSession) btnResetSession.classList.add("hidden");
  } catch (e) {
    console.error("Failed to clear session checkpoint:", e);
  }
}

async function resetSessionCheckpoint() {
  await clearSessionCheckpoint(domain);
  appendDiagnosticTurn({
    phase: "SESSION_RESET",
    provider: "SYSTEM",
    model: "none",
    prompt: "User clicked Reset Session. Discarding checkpoint milestones.",
    rawResponse: "Session Checkpoint Cleared.",
    cleanedResponse: "Session Checkpoint Cleared.",
  });
  appendLog("sys", `\x1b[33m[Checkpoint]\x1b[0m Saved session checkpoint for ${domain} has been reset. Next run will start fresh from Phase 1.`);
  if (btnResetSession) btnResetSession.classList.add("hidden");
}

async function init() {
  genDomain.textContent = `Site: ${domain}`;
  appendLog("sys", `Initializing modular plugin generator for ${domain}...`);

  const storageKey = `recording_${domain}`;
  const data = await browserAPI.storage.local.get([
    storageKey,
    "aggregator_registry_url",
    "aggregator_llm_provider",
    "aggregator_oauth_token",
    "aggregator_llm_token",
    "aggregator_gemini_token",
    "aggregator_openrouter_token",
  ]);

  recordingData = data[storageKey];
  if (data.aggregator_registry_url) {
    registryUrl = data.aggregator_registry_url.replace(/\/+$/, "");
  }
  if (data.aggregator_llm_provider) {
    llmProvider = data.aggregator_llm_provider;
  }
  if (data.aggregator_oauth_token) {
    oauthToken = data.aggregator_oauth_token;
  }
  if (data.aggregator_gemini_token) {
    geminiToken = data.aggregator_gemini_token;
  } else if (data.aggregator_llm_token && !data.aggregator_llm_token.startsWith("sk-")) {
    geminiToken = data.aggregator_llm_token;
  }
  if (data.aggregator_openrouter_token) {
    openRouterToken = data.aggregator_openrouter_token;
  } else if (data.aggregator_llm_token && data.aggregator_llm_token.startsWith("sk-")) {
    openRouterToken = data.aggregator_llm_token;
  }
  manualToken = geminiToken || openRouterToken || (data.aggregator_llm_token || "");

  if (recordingData && recordingData.phases) {
    let count = 0;
    for (const p of Object.values(recordingData.phases)) {
      if (Array.isArray(p)) count += p.length;
    }
    genStatus.textContent = `Trace Ready: ${count} requests captured`;
    appendLog("sys", `Loaded trace containing ${count} requests across ${Object.keys(recordingData.phases).length} phases.`);
    await animateProgressBar(`Trace synchronized (${count} requests)`, 300, "ansi-cyan");
  } else {
    genStatus.textContent = "Warning: No network trace recorded";
    appendLog("err", `No recording found under key "${storageKey}". Using heuristic analysis.`);
  }

  if (geminiToken) {
    appendLog("sys", "\x1b[32m[Key]\x1b[0m Gemini API Key loaded (Primary AI Engine).");
  } else if (oauthToken) {
    appendLog("sys", "\x1b[36m[Key]\x1b[0m Google OAuth Bearer Token loaded (Primary AI Engine).");
  }
  if (openRouterToken) {
    appendLog("sys", "\x1b[35m[Key]\x1b[0m OpenRouter API Key loaded (Automatic Fallback Engine).");
  }
  if (!geminiToken && !oauthToken && !openRouterToken) {
    appendLog("err", "No AI API keys found. Please configure in Settings.");
  }

  const savedCheckpoint = await loadSessionCheckpoint(domain);
  if (savedCheckpoint && savedCheckpoint.lastCompletedPhase) {
    appendLog("sys", `\x1b[32m[Checkpoint]\x1b[0m Found saved session checkpoint for ${domain} (${savedCheckpoint.lastCompletedPhase} completed). Next generation will resume from where you left off.`);
    if (btnResetSession) {
      btnResetSession.classList.remove("hidden");
    }
  }

  const pastLogs = await loadPersistedSessionLogs(domain);
  if (pastLogs.length > 0) {
    rawDiagnosticSessionLogs.length = 0;
    rawDiagnosticSessionLogs.push(...pastLogs);
    appendLog("sys", `\x1b[32m[Diagnostic Logs]\x1b[0m Loaded ${pastLogs.length} historical turns from previous session instances.`);
  }
}

function scoreGeminiModel(name) {
  const lower = name.toLowerCase();
  let score = 0;

  if (lower.includes("antigravity")) {
    score += 500;
    const dateMatch = lower.match(/(\d{2})-(\d{4})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1], 10);
      const year = parseInt(dateMatch[2], 10);
      score += (year - 2020) * 12 + month;
    }
    return score;
  }

  const versionMatch = lower.match(/(?:gemini-|gemma-)?(\d+(?:\.\d+)?)/);
  if (versionMatch) {
    if (lower.includes("gemma")) {
      score += parseFloat(versionMatch[1]) * 40;
    } else {
      score += parseFloat(versionMatch[1]) * 100;
    }
  }

  if (lower.includes("ultra")) {
    score += 40;
  } else if (lower.includes("pro")) {
    score += 30;
  } else if (lower.includes("flash-8b")) {
    score += 5;
  } else if (lower.includes("flash-lite")) {
    score += 10;
  } else if (lower.includes("flash")) {
    score += 20;
  }

  if (lower.includes("-it")) {
    score += 10;
  }
  const sizeMatch = lower.match(/(\d+)b/);
  if (sizeMatch) {
    score += parseInt(sizeMatch[1], 10);
  }

  if (lower.includes("latest")) score += 2;
  if (lower.includes("preview")) score += 2;
  if (lower.includes("exp")) score -= 1;

  return score;
}

async function getEligibleGeminiModels(token, isBearer) {
  const defaultChain = [
    "antigravity-preview-09-2026",
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ];

  const modelsUrl = isBearer
    ? "https://generativelanguage.googleapis.com/v1beta/models"
    : `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(token.trim())}`;

  const headers = {};
  if (isBearer) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
    headers["x-goog-user-project"] = "aggregator-510615";
  }

  try {
    const netResult = await fetchWithNetworkRetry(modelsUrl, { headers }, {
      maxRetries: 2,
      timeoutMs: 15000,
      contextLabel: "Gemini Model Discovery",
    });

    if (!netResult.ok || !netResult.res) return defaultChain;

    const data = await netResult.res.json();
    const rawModels = data?.models || [];

    const eligible = rawModels.filter((m) => {
      const methods = m.supportedGenerationMethods || [];
      const name = (m.name || "").toLowerCase();
      const isContentGen =
        methods.length === 0 ||
        methods.includes("generateContent") ||
        methods.includes("interactions") ||
        name.includes("antigravity");
      const isExcluded =
        name.includes("deep-research") ||
        name.includes("lyria") ||
        name.includes("transcribe") ||
        name.includes("image") ||
        name.includes("omni") ||
        name.includes("tts") ||
        name.includes("audio") ||
        name.includes("realtime") ||
        name.includes("embedding") ||
        name.includes("imagen") ||
        name.includes("learnlm") ||
        name.includes("robotics") ||
        name.includes("computer-use");
      return isContentGen && !isExcluded;
    });

    const modelNames = eligible.map((m) => m.name.replace(new RegExp("^models/"), ""));
    if (modelNames.length === 0) return defaultChain;

    const uniqueNames = Array.from(new Set(modelNames));
    uniqueNames.sort((a, b) => scoreGeminiModel(b) - scoreGeminiModel(a));

    return uniqueNames;
  } catch (err) {
    return defaultChain;
  }
}

function scoreOpenRouterModel(name) {
  const lower = name.toLowerCase();
  let score = 0;

  if (lower === "openrouter/free" || lower.includes("openrouter/free")) return 5000;
  if (lower.includes("gemini-2.5-pro")) score += 1200;
  else if (lower.includes("gemini-2.5-flash")) score += 1100;
  else if (lower.includes("gemini-2.0-flash")) score += 1000;
  else if (lower.includes("gemini-2.0-pro")) score += 950;
  else if (lower.includes("gemini")) score += 900;
  else if (lower.includes("deepseek-r1")) score += 850;
  else if (lower.includes("deepseek-chat")) score += 800;
  else if (lower.includes("deepseek")) score += 750;
  else if (lower.includes("qwen-2.5-coder")) score += 700;
  else if (lower.includes("qwen")) score += 650;
  else if (lower.includes("llama-3.3-70b")) score += 600;
  else if (lower.includes("llama-3.1-70b")) score += 550;
  else if (lower.includes("mistral-small-24b")) score += 500;
  else if (lower.includes("llama-3")) score += 450;
  else if (lower.includes("mistral")) score += 400;
  else if (lower.includes("openrouter/auto")) score += 350;

  if (lower.includes("coder") || lower.includes("code")) score += 40;
  if (lower.includes("instruct")) score += 20;
  if (lower.includes("70b") || lower.includes("72b")) score += 30;
  if (lower.includes("32b") || lower.includes("24b")) score += 20;
  if (lower.includes("8b") || lower.includes("7b")) score += 10;
  if (lower.includes("exp") || lower.includes("preview")) score += 5;

  return score;
}

async function getEligibleOpenRouterModels(token) {
  const defaultChain = [
    "openrouter/free",
    "google/gemini-2.0-flash-exp:free",
    "google/gemini-2.0-pro-exp-02-05:free",
    "deepseek/deepseek-r1:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-small-24b-instruct-2501:free",
    "openrouter/auto",
  ];

  try {
    const netResult = await fetchWithNetworkRetry("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${token.trim()}`,
        "HTTP-Referer": "https://aggregator.app",
        "X-Title": "Aggregator Extension",
      },
    }, {
      maxRetries: 2,
      timeoutMs: 15000,
      contextLabel: "OpenRouter Model Discovery",
    });

    if (!netResult.ok || !netResult.res) return defaultChain;

    const data = await netResult.res.json();
    const rawModels = data?.data || [];

    const freeModels = rawModels.filter((m) => {
      const id = (m.id || "").toLowerCase();
      if (id === "openrouter/free") return true;

      // Exclude audio, video, vision-only, moderation, safety, and embedding models
      const isExcluded =
        id.includes("lyria") ||
        id.includes("clip") ||
        id.includes("tts") ||
        id.includes("audio") ||
        id.includes("speech") ||
        id.includes("whisper") ||
        id.includes("transcribe") ||
        id.includes("embedding") ||
        id.includes("safety") ||
        id.includes("guard") ||
        id.includes("moderation") ||
        id.includes("content-safety") ||
        id.includes("note-preview");

      if (isExcluded) return false;

      const isFreeTag = id.endsWith(":free") || id.includes(":free");
      const isFreePrice = m.pricing && (m.pricing.prompt === "0" || m.pricing.prompt === 0 || m.pricing.prompt === "0.0") &&
        (m.pricing.completion === "0" || m.pricing.completion === 0 || m.pricing.completion === "0.0");
      return isFreeTag || isFreePrice;
    });

    const modelNames = freeModels.map((m) => m.id);
    if (modelNames.length === 0) return defaultChain;

    let uniqueNames = Array.from(new Set(modelNames));
    uniqueNames.sort((a, b) => scoreOpenRouterModel(b) - scoreOpenRouterModel(a));

    // Ensure openrouter/free is always #1 in the chain
    uniqueNames = ["openrouter/free", ...uniqueNames.filter((n) => n !== "openrouter/free")];

    if (!uniqueNames.includes("openrouter/auto")) {
      uniqueNames.push("openrouter/auto");
    }

    return uniqueNames;
  } catch (err) {
    return defaultChain;
  }
}

function extractTextFromInteraction(data) {
  if (!data) return "";
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  if (typeof data.outputText === "string" && data.outputText) return data.outputText;
  if (typeof data.interaction?.output_text === "string" && data.interaction.output_text) return data.interaction.output_text;
  if (typeof data.interaction?.outputText === "string" && data.interaction.outputText) return data.interaction.outputText;

  let text = "";
  const steps = data.steps || data.interaction?.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (typeof step === "string") {
        text += step + "\n";
      } else if (step?.content) {
        if (typeof step.content === "string") {
          text += step.content + "\n";
        } else if (Array.isArray(step.content)) {
          for (const part of step.content) {
            if (typeof part === "string") text += part + "\n";
            else if (part?.text) text += part.text + "\n";
          }
        }
      } else if (step?.text) {
        text += step.text + "\n";
      }
    }
  }

  if (!text) {
    const outputs = data.outputs || data.interaction?.outputs;
    if (Array.isArray(outputs)) {
      for (const out of outputs) {
        if (typeof out === "string") text += out + "\n";
        else if (out?.text) text += out.text + "\n";
      }
    }
  }

  if (!text && data.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = data.candidates[0].content.parts[0].text;
  }

  return text.trim();
}

// Compact long conversations to prevent token limit overflow and rate-limiting
function compactConversationHistory(history, maxRecent = 6) {
  if (!Array.isArray(history) || history.length <= 8) {
    return history;
  }

  const initial = history[0];
  const middle = history.slice(1, history.length - maxRecent);
  const recent = history.slice(history.length - maxRecent);

  const summaryParts = [];
  for (let i = 0; i < middle.length; i++) {
    const item = middle[i];
    let text = "";
    if (Array.isArray(item.parts)) {
      text = item.parts.map((p) => (typeof p === "string" ? p : p?.text || "")).join("\n");
    } else if (typeof item.content === "string") {
      text = item.content;
    }

    if (text.includes("PROBE_RESULT:")) {
      const statusMatch = text.match(/STATUS:\s*([^\n]+)/);
      const ctMatch = text.match(/CONTENT-TYPE:\s*([^\n]+)/);
      summaryParts.push(`- Turn ${i + 2} Probe Result: ${statusMatch ? statusMatch[1] : "OK"} (${ctMatch ? ctMatch[1] : "unknown"})`);
    } else if (text.includes("STARTOFPROBE")) {
      const probeMatch = text.match(/STARTOFPROBE\s*([\s\S]*?)\s*ENDOFPROBE/);
      if (probeMatch) {
        summaryParts.push(`- Turn ${i + 2} Model Probe: ${probeMatch[1].replace(/\s+/g, " ").substring(0, 100)}`);
      }
    } else if (text.includes("TEST SUITE EXECUTION FAILED")) {
      summaryParts.push(`- Turn ${i + 2} Test Verification: Failed (Reprompted with test errors)`);
    }
  }

  const compactedSummaryText = `[PREVIOUS PROBE LOG DIGEST (Turns 2-${middle.length + 1})]\n${summaryParts.join("\n") || "Multiple exploratory network probes completed."}\n\n[CONTINUING INVESTIGATION WITH RECENT TURNS]`;
  const compactedMiddleUser = {
    role: "user",
    parts: [{ text: compactedSummaryText }],
    content: compactedSummaryText,
  };

  return [initial, compactedMiddleUser, ...recent];
}

// Ensure alternating user/model roles and clean text parts for Gemini generateContent
function sanitizeConversationHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [{ role: "user", parts: [{ text: "Synthesize the Aggregator plugin." }] }];
  }

  const compacted = compactConversationHistory(history);
  const sanitized = [];

  for (const item of compacted) {
    const role = item.role === "model" ? "model" : "user";
    let combinedText = "";

    if (Array.isArray(item.parts)) {
      const texts = [];
      for (const p of item.parts) {
        if (typeof p === "string" && p.trim()) texts.push(p);
        else if (p?.text && typeof p.text === "string" && p.text.trim()) texts.push(p.text);
      }
      combinedText = texts.join("\n").trim();
    } else if (typeof item.content === "string" && item.content.trim()) {
      combinedText = item.content.trim();
    }

    if (!combinedText) continue;

    // Merge consecutive turns with identical role to satisfy Gemini API requirements
    if (sanitized.length > 0 && sanitized[sanitized.length - 1].role === role) {
      sanitized[sanitized.length - 1].parts[0].text += "\n\n" + combinedText;
    } else {
      sanitized.push({
        role,
        parts: [{ text: combinedText }],
      });
    }
  }

  // Ensure first turn is role "user"
  if (sanitized.length === 0 || sanitized[0].role !== "user") {
    sanitized.unshift({ role: "user", parts: [{ text: "Analyze and synthesize plugin." }] });
  }

  return sanitized;
}

async function callGeminiApi({
  model,
  prompt,
  latestTurnInput,
  previousInteractionId,
  conversationHistory,
  effectiveToken,
  isBearer,
  signal,
}) {
  const cleanModel = model.replace(new RegExp("^models/"), "");

  const interactionsUrl = isBearer
    ? "https://generativelanguage.googleapis.com/v1beta/interactions"
    : `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(effectiveToken.trim())}`;

  const headers = {
    "Content-Type": "application/json",
  };
  if (isBearer) {
    headers["Authorization"] = `Bearer ${effectiveToken.trim()}`;
    headers["x-goog-user-project"] = "aggregator-510615";
  } else {
    headers["x-goog-api-key"] = effectiveToken.trim();
  }

  const isModelStateless = statelessModels.has(cleanModel) || unsupportedChainingModels.has(cleanModel);

  // 1. Primary path: Interactions API (/v1beta/interactions)
  if (!isModelStateless) {
    const interactionBody = {
      model: cleanModel,
      input: (previousInteractionId ? latestTurnInput : prompt) || latestTurnInput || prompt,
      store: true,
    };

    if (previousInteractionId) {
      interactionBody.previous_interaction_id = previousInteractionId;
    }

    const netResult = await fetchWithNetworkRetry(interactionsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(interactionBody),
      signal,
    }, {
      maxRetries: 2,
      timeoutMs: 120000,
      contextLabel: `Interactions API (${cleanModel})`,
    });

    if (netResult.res && netResult.ok) {
      const interData = await netResult.res.json();
      let text = extractTextFromInteraction(interData);
      let interactionId = interData.id || interData.interaction_id || interData.interaction?.id || interData.name || "";

      if (interData.status === "in_progress" && !text && interactionId) {
        for (let poll = 0; poll < 45; poll++) {
          await new Promise((r) => setTimeout(r, 2000));
          if (currentAbortController && currentAbortController.signal.aborted) {
            throw new Error("Aborted by user");
          }
          Spinner.update(`Processing interaction (${poll + 1}/45)...`);
          const pollUrl = isBearer
            ? `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(interactionId)}`
            : `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(interactionId)}?key=${encodeURIComponent(effectiveToken.trim())}`;
          const pollRes = await fetch(pollUrl, { headers, signal });
          if (pollRes.ok) {
            const pollData = await pollRes.json();
            const polledText = extractTextFromInteraction(pollData);
            if (polledText) {
              text = polledText;
              break;
            }
            if (pollData.status === "completed" || pollData.status === "failed") break;
          } else {
            break;
          }
        }
      }

      if (text) {
        return {
          ok: true,
          status: netResult.status,
          text,
          interactionId,
          usedInteractions: true,
        };
      }
    } else {
      let errDetail = "";
      if (netResult.res) {
        try {
          errDetail = await netResult.res.text();
        } catch (e) {}
      } else if (netResult.error) {
        errDetail = netResult.error;
      }

      // If Interactions API returned 400/404/405/501 (or client-side formatting issue), switch to normal generateContent API
      unsupportedChainingModels.add(cleanModel);
      statelessModels.add(cleanModel);
      appendLog("warn", `Interactions API returned HTTP ${netResult.status}${errDetail ? ": " + errDetail.substring(0, 100).replace(/\s+/g, " ") : ""}. Switching to normal generateContent API...`);
    }
  }

  // 2. Normal API fallback: generateContent (/v1beta/models/{model}:generateContent)
  const genUrl = isBearer
    ? `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`
    : `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(effectiveToken.trim())}`;

  const genHeaders = { "Content-Type": "application/json" };
  if (isBearer) {
    genHeaders["Authorization"] = `Bearer ${effectiveToken.trim()}`;
    genHeaders["x-goog-user-project"] = "aggregator-510615";
  }

  const sanitizedContents = sanitizeConversationHistory(conversationHistory);

  const genNetResult = await fetchWithNetworkRetry(genUrl, {
    method: "POST",
    headers: genHeaders,
    body: JSON.stringify({ contents: sanitizedContents }),
    signal,
  }, {
    maxRetries: 2,
    timeoutMs: 120000,
    contextLabel: `Normal API generateContent (${cleanModel})`,
  });

  if (genNetResult.ok && genNetResult.res) {
    const genData = await genNetResult.res.json();
    const genText = genData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (genText) {
      return {
        ok: true,
        status: genNetResult.status,
        text: genText,
        interactionId: "",
        usedInteractions: false,
      };
    }
  }

  let errorText = "Network or API error";
  if (genNetResult.res) {
    try {
      errorText = await genNetResult.res.text();
    } catch (e) {
      errorText = genNetResult.statusText;
    }
  } else if (genNetResult.error) {
    errorText = genNetResult.error;
  }

  // Both Interactions API and Normal generateContent API have now failed
  return {
    ok: false,
    status: genNetResult.status || 0,
    error: errorText,
    isNetworkError: genNetResult.isNetworkError,
    usedInteractions: false,
  };
}

function formatOpenRouterMessages(history, fallbackPrompt) {
  if (!Array.isArray(history) || history.length === 0) {
    return [{ role: "user", content: fallbackPrompt || "Synthesize the Aggregator plugin." }];
  }

  const msgs = [];
  for (const item of history) {
    const role = (item.role === "model" || item.role === "assistant") ? "assistant" : "user";
    let combinedText = "";

    if (Array.isArray(item.parts)) {
      const texts = [];
      for (const p of item.parts) {
        if (typeof p === "string" && p.trim()) texts.push(p);
        else if (p?.text && typeof p.text === "string" && p.text.trim()) texts.push(p.text);
      }
      combinedText = texts.join("\n").trim();
    } else if (typeof item.content === "string" && item.content.trim()) {
      combinedText = item.content.trim();
    } else if (typeof item.parts === "string" && item.parts.trim()) {
      combinedText = item.parts.trim();
    }

    if (!combinedText) continue;

    if (msgs.length > 0 && msgs[msgs.length - 1].role === role) {
      msgs[msgs.length - 1].content += "\n\n" + combinedText;
    } else {
      msgs.push({ role, content: combinedText });
    }
  }

  if (msgs.length === 0 || msgs[0].role !== "user") {
    msgs.unshift({ role: "user", content: fallbackPrompt || "Synthesize the Aggregator plugin." });
  }

  return msgs;
}

async function callOpenRouterApi({
  model,
  prompt,
  latestTurnInput,
  conversationHistory,
  effectiveToken,
  signal,
}) {
  const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${effectiveToken.trim()}`,
    "HTTP-Referer": "https://aggregator.app",
    "X-Title": "Aggregator Extension",
    "Content-Type": "application/json",
  };

  const messages = formatOpenRouterMessages(conversationHistory, prompt || latestTurnInput);

  const netResult = await fetchWithNetworkRetry(openRouterUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
    }),
    signal,
  }, {
    maxRetries: 2,
    timeoutMs: 45000,
    contextLabel: `OpenRouter (${model})`,
  });

  if (netResult.ok && netResult.res) {
    try {
      const data = await netResult.res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (text) {
        return {
          ok: true,
          status: netResult.status,
          text,
          interactionId: "",
          usedInteractions: false,
        };
      }
    } catch (e) {}
  }

  let errorText = "Network or API error";
  if (netResult.res) {
    try {
      const rawErr = await netResult.res.text();
      try {
        const jsonErr = JSON.parse(rawErr);
        errorText = jsonErr.error?.message || rawErr;
      } catch {
        errorText = rawErr;
      }
    } catch (e) {
      errorText = netResult.statusText;
    }
  } else if (netResult.error) {
    errorText = netResult.error;
  }

  return {
    ok: false,
    status: netResult.status || 0,
    error: errorText,
    isNetworkError: netResult.isNetworkError,
    usedInteractions: false,
  };
}

function cleanExtractedPluginCode(text) {
  if (!text) return "";
  let code = text;

  // 1. Strip reasoning blocks from reasoning models (<think>...</think>, <reasoning>...</reasoning>)
  code = code.replace(/<think>[\s\S]*?<\/think>/gi, "");
  code = code.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  code = code.replace(/<\/?(?:think|reasoning|scratchpad|output|code)>/gi, "");

  // 2. Strip underscore borders
  code = code.replace(/_{3,}/g, "");

  // 3. Strip placeholder tags like <javascript code>, <raw javascript code>, <plugin code>
  code = code.replace(/<(?:\w+\s+)*(?:code|javascript|plugin|script|source)>/gi, "");

  // 4. Strip markdown code block markers
  code = code.replace(/^```[a-z]*\s*/gim, "").replace(/```\s*$/gim, "");

  // 5. Extract actual code block if buried inside conversational text
  const match = code.match(/(?:export\s+default\s*\{|module\.exports\s*=|const\s+plugin\s*=|globalThis\.AggregatorPlugins)[\s\S]*/);
  if (match) {
    code = match[0];
  }

  return code.trim();
}

function extractDomainBaseName(rawDomain) {
  if (!rawDomain) return "custom";
  let clean = rawDomain.toLowerCase().trim();
  clean = clean.replace(/^(https?:\/\/)?(www\.)?/, "");
  clean = clean.replace(/:\d+$/, "");
  const parts = clean.split(".");
  if (parts.length >= 2) {
    const tlds = ["com", "net", "org", "xyz", "to", "ro", "ru", "io", "tv", "me", "co", "cc", "is", "app", "top"];
    if (tlds.includes(parts[parts.length - 1])) {
      parts.pop();
    }
  }
  const base = parts.join("_").replace(/[^a-z0-9]/gi, "_");
  return base || "custom";
}

function derivePluginName(rawDomain) {
  const base = extractDomainBaseName(rawDomain);
  return base
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parsePluginMetaFromCode(code, fallbackDomain) {
  let id = extractDomainBaseName(fallbackDomain);
  let name = derivePluginName(fallbackDomain);

  if (code) {
    const idMatch = code.match(/\bid\s*:\s*["'`]([^"'`]+)["'`]/);
    if (idMatch && idMatch[1] && !idMatch[1].startsWith("www_")) {
      id = idMatch[1].replace(/[^a-z0-9_]/gi, "").toLowerCase();
    }

    const nameMatch = code.match(/\bname\s*:\s*["'`]([^"'`]+)["'`]/);
    if (nameMatch && nameMatch[1] && !nameMatch[1].toUpperCase().startsWith("WWW")) {
      name = nameMatch[1].trim();
    }
  }

  return { id, name };
}

function cancelAiGenerationLoop() {
  isLoopRunning = false;
  Spinner.stop();
  if (currentAbortController) {
    try {
      currentAbortController.abort();
    } catch (e) {}
    currentAbortController = null;
  }
  appendLog("sys", "Generation canceled by user.");
  genStatus.classList.remove("status-network-err");
  genStatus.textContent = "Status: Canceled";
  btnRunLoop.disabled = false;
  btnRunLoop.textContent = "Generate";
  btnRunLoop.classList.remove("hidden");
  btnCancel.classList.add("hidden");
}

function stripModelThinking(raw) {
  if (!raw) return "";
  let text = raw;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  text = text.replace(/<thought>[\s\S]*?<\/thought>/gi, "");
  text = text.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  text = text.replace(/<\/?(?:think|thought|reasoning|scratchpad)>/gi, "");
  return text.trim();
}

function extractBalancedMethod(code, methodName) {
  if (!code) return "";
  
  const sigRegex = new RegExp(`(?:async\\s+)?(?:function\\s+)?\\b${methodName}\\s*\\([^)]*\\)\\s*\\{`, "i");
  const match = sigRegex.exec(code);
  if (!match) return "";

  const startIdx = match.index;
  let braceStart = code.indexOf("{", startIdx);
  if (braceStart === -1) return "";

  let depth = 0;
  let inString = null;
  let inTemplate = false;
  let inComment = false;
  let inLineComment = false;
  let inRegex = false;
  let inCharClass = false;
  let endIdx = -1;

  for (let i = braceStart; i < code.length; i++) {
    const char = code[i];
    const prevChar = i > 0 ? code[i - 1] : "";
    const nextChar = i < code.length - 1 ? code[i + 1] : "";

    if (inRegex) {
      if (prevChar === "\\") continue;
      if (char === "[") inCharClass = true;
      else if (char === "]") inCharClass = false;
      else if (char === "/" && !inCharClass) inRegex = false;
      continue;
    }

    if (!inString && !inTemplate) {
      if (inLineComment) {
        if (char === "\n") inLineComment = false;
        continue;
      }
      if (inComment) {
        if (prevChar === "*" && char === "/") inComment = false;
        continue;
      }
      if (char === "/" && nextChar === "/") {
        inLineComment = true;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        inComment = true;
        continue;
      }

      // Detect start of regex literal (e.g. /regex/flags)
      if (char === "/") {
        let prevNonWhite = "";
        for (let j = i - 1; j >= braceStart; j--) {
          if (!/\s/.test(code[j])) {
            prevNonWhite = code[j];
            break;
          }
        }
        if (/[-=(:[!&|?,;~{^+*%]/.test(prevNonWhite) || prevNonWhite === "") {
          inRegex = true;
          inCharClass = false;
          continue;
        }
      }
    }

    if (!inComment && !inLineComment) {
      if (char === "'" || char === '"') {
        if (inString === char && prevChar !== "\\") {
          inString = null;
        } else if (!inString && !inTemplate) {
          inString = char;
        }
        continue;
      }

      if (char === "`") {
        if (inTemplate && prevChar !== "\\") {
          inTemplate = false;
        } else if (!inString && !inTemplate) {
          inTemplate = true;
        }
        continue;
      }
    }

    if (inString || inTemplate || inComment || inLineComment) {
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
    }
  }

  if (endIdx !== -1) {
    let extracted = code.substring(startIdx, endIdx).trim();
    extracted = extracted.replace(/^function\s+/, "");
    if (!extracted.startsWith("async")) {
      extracted = "async " + extracted;
    }
    return extracted;
  }

  return "";
}

function extractTopLevelHelpers(code, methodName) {
  if (!code) return [];
  const helpers = [];
  const helperRegex = /(function\s+[a-zA-Z0-9_$]+\s*\([^)]*\)\s*\{)/g;
  let m;
  while ((m = helperRegex.exec(code)) !== null) {
    const fnName = m[0].replace(/function\s+/, "").split("(")[0].trim();
    if (fnName && fnName !== methodName) {
      const fullFn = extractBalancedMethod(code.substring(m.index), fnName);
      if (fullFn) {
        helpers.push(fullFn.startsWith("async ") ? fullFn : "function " + fullFn);
      }
    }
  }
  return helpers;
}

function extractPhaseTraceSummary(phaseName, recData, targetDomain) {
  if (!recData || !recData.phases) return "No network trace available.";
  
  let phasesToInclude = [];
  if (phaseName === "all") {
    phasesToInclude = Object.keys(recData.phases);
  } else if (phaseName === "search_submit") {
    phasesToInclude = ["search_submit", "search_typing", "item_select"].filter((k) => recData.phases[k]);
  } else if (phaseName === "details_load") {
    phasesToInclude = ["item_select", "details_load", "episode_select"].filter((k) => recData.phases[k]);
  } else if (phaseName === "video_play") {
    phasesToInclude = ["video_play", "server_change", "episode_select"].filter((k) => recData.phases[k]);
  } else if (phaseName === "initial_load") {
    phasesToInclude = ["initial_load", "home"].filter((k) => recData.phases[k]);
  } else {
    phasesToInclude = [phaseName];
  }

  if (phasesToInclude.length === 0) {
    phasesToInclude = Object.keys(recData.phases);
  }

  const results = [];
  const targetHost = (targetDomain || "").toLowerCase().replace(/^www\./, "");
  const ignoredExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".css", ".woff", ".woff2", ".ttf", ".ico"];
  const maxTotalResults = phaseName === "all" ? 30 : 15;

  for (const p of phasesToInclude) {
    const reqs = recData.phases[p];
    if (!Array.isArray(reqs)) continue;

    for (const r of reqs) {
      if (!r.url) continue;
      const lowerUrl = r.url.toLowerCase();
      if (ignoredExts.some((ext) => lowerUrl.includes(ext))) continue;
      if (lowerUrl.includes("google-analytics") || lowerUrl.includes("doubleclick") || lowerUrl.includes("facebook.net") || lowerUrl.includes("clarity.ms")) continue;
      // Skip pure static JS vendor bundles unless they contain data or endpoints
      if ((lowerUrl.includes("_app/immutable/chunks/") || lowerUrl.includes("static/js/")) && !lowerUrl.includes("data") && !lowerUrl.includes("api")) continue;

      const reqObj = {
        phase: p,
        url: r.url,
        method: r.method || "GET",
        status: r.statusCode || 200,
        type: r.type,
      };

      if (r.requestHeaders && Array.isArray(r.requestHeaders)) {
        const kept = r.requestHeaders.filter((h) =>
          ["referer", "origin", "user-agent", "x-requested-with", "content-type", "accept", "authorization"].includes(h.name.toLowerCase())
        );
        if (kept.length > 0) reqObj.headers = Object.fromEntries(kept.map((h) => [h.name, h.value]));
      }

      if (r.requestBody) {
        reqObj.requestBody = typeof r.requestBody === "string" ? r.requestBody.substring(0, 500) : r.requestBody;
      }

      if (r.responseBody) {
        reqObj.responsePreview = typeof r.responseBody === "string" ? r.responseBody.substring(0, 1500) : r.responseBody;
      }

      results.push(reqObj);
      if (results.length >= maxTotalResults) break;
    }
    if (results.length >= maxTotalResults) break;
  }

  return JSON.stringify(results, null, 2);
}

function extractCodeAndHelpers(responseText, methodName) {
  let cleaned = stripModelThinking(responseText);
  
  if (cleaned.includes("STARTOFCODE") && cleaned.includes("ENDOFCODE")) {
    const s = cleaned.indexOf("STARTOFCODE") + "STARTOFCODE".length;
    const e = cleaned.indexOf("ENDOFCODE", s);
    cleaned = cleaned.substring(s, e !== -1 ? e : undefined).trim();
  } else {
    const codeMatch = cleaned.match(/```(?:javascript|js)?([\s\S]*?)```/i);
    if (codeMatch) cleaned = codeMatch[1].trim();
  }

  const helpers = extractTopLevelHelpers(cleaned, methodName);
  let methodCode = extractBalancedMethod(cleaned, methodName);

  if (!methodCode) {
    let fallback = cleaned.replace(/^export\s+default\s+/g, "").trim();
    if (fallback.startsWith("{") && fallback.endsWith("}")) {
      methodCode = fallback.substring(1, fallback.length - 1).trim();
    } else {
      const alreadyHasMethod = new RegExp(`^(?:async\\s+)?(?:function\\s+)?\\b${methodName}\\s*\\(`, "i").test(fallback);
      if (alreadyHasMethod) {
        methodCode = fallback.replace(/^function\s+/, "");
        if (!methodCode.startsWith("async")) {
          methodCode = "async " + methodCode;
        }
      } else {
        methodCode = `async ${methodName}(${methodName === "search" ? "query" : methodName === "getEpisodes" ? "mediaId" : methodName === "getStreams" ? "episodeId" : ""}) {\n${fallback}\n}`;
      }
    }
  }

  return { methodCode, helpers: helpers.join("\n\n") };
}

async function runSandboxMethodTest({ method, code, args = [], baseUrl, targetDomain, helperCode = "" }) {
  let frame = document.querySelector("#sandbox-frame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "sandbox-frame";
    frame.src = "sandbox.html";
    frame.style.display = "none";
    document.body.appendChild(frame);
    await new Promise((r) => setTimeout(r, 200));
  }

  const reqId = "method_test_" + Math.random().toString(36).substring(2);
  return new Promise((resolve) => {
    function handleResult(event) {
      if (event.data?.action === "RUN_METHOD_TEST_RESPONSE" && event.data.reqId === reqId) {
        window.removeEventListener("message", handleResult);
        resolve(event.data);
      }
    }
    window.addEventListener("message", handleResult);
    frame.contentWindow.postMessage({
      action: "RUN_METHOD_TEST",
      reqId,
      method,
      code,
      args,
      baseUrl: baseUrl || `https://${targetDomain}`,
      targetDomain,
      helperCode,
    }, "*");
  });
}

async function dispatchUnifiedLlm({
  prompt,
  systemPrompt = "",
  contextLabel = "AI Synthesis",
  signal,
}) {
  let fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  fullPrompt = stripModelThinking(fullPrompt);

  const effectiveGemini = geminiToken || (manualToken && !manualToken.startsWith("sk-") ? manualToken : "") || oauthToken;
  const effectiveOpenRouter = openRouterToken || (manualToken && manualToken.startsWith("sk-") ? manualToken : "");

  // 1. Try Gemini first
  if (effectiveGemini) {
    const isBearer = (effectiveGemini.startsWith("ya29.")) || (!geminiToken && Boolean(oauthToken));
    if (candidateGeminiModels.length === 0) {
      candidateGeminiModels = await getEligibleGeminiModels(effectiveGemini, isBearer);
    }

    for (let i = activeGeminiModelIndex; i < candidateGeminiModels.length; i++) {
      if (signal?.aborted) throw new Error("Aborted by user");
      const model = candidateGeminiModels[i];
      Spinner.start(`${contextLabel} (Gemini: ${model})...`);
      
      const res = await callGeminiApi({
        model,
        prompt: fullPrompt,
        latestTurnInput: fullPrompt,
        conversationHistory: [{ role: "user", parts: [{ text: fullPrompt }] }],
        effectiveToken: effectiveGemini,
        isBearer,
        signal,
      });
      Spinner.stop();

      if (res.ok && res.text) {
        activeGeminiModelIndex = i;
        const cleaned = stripModelThinking(res.text);
        appendDiagnosticTurn({
          phase: contextLabel,
          provider: "GEMINI",
          model,
          prompt: fullPrompt,
          rawResponse: res.text,
          cleanedResponse: cleaned,
        });
        return { ok: true, text: cleaned, provider: "GEMINI", model };
      }

      appendLog("warn", `Gemini model ${model} failed (HTTP ${res.status}).`);
      if (i + 1 < candidateGeminiModels.length) {
        appendLog("sys", `Degrading to next Gemini model: ${candidateGeminiModels[i + 1]}...`);
      }
    }
    appendLog("warn", "All Gemini models exhausted. Attempting fallback to OpenRouter...");
  }

  // 2. Fall back to OpenRouter
  if (effectiveOpenRouter) {
    appendLog("sys", "\x1b[35m[FALLBACK] Dispatching request to OpenRouter...\x1b[0m");
    if (candidateOpenRouterModels.length === 0) {
      candidateOpenRouterModels = await getEligibleOpenRouterModels(effectiveOpenRouter);
    }

    for (let j = activeOpenRouterModelIndex; j < candidateOpenRouterModels.length; j++) {
      if (signal?.aborted) throw new Error("Aborted by user");
      const model = candidateOpenRouterModels[j];
      Spinner.start(`${contextLabel} (OpenRouter: ${model})...`);

      const res = await callOpenRouterApi({
        model,
        prompt: fullPrompt,
        latestTurnInput: fullPrompt,
        conversationHistory: [{ role: "user", content: fullPrompt }],
        effectiveToken: effectiveOpenRouter,
        signal,
      });
      Spinner.stop();

      if (res.ok && res.text) {
        activeOpenRouterModelIndex = j;
        const cleaned = stripModelThinking(res.text);
        appendDiagnosticTurn({
          phase: contextLabel,
          provider: "OPENROUTER",
          model,
          prompt: fullPrompt,
          rawResponse: res.text,
          cleanedResponse: cleaned,
        });
        return { ok: true, text: cleaned, provider: "OPENROUTER", model };
      }

      appendLog("warn", `OpenRouter model ${model} failed (HTTP ${res.status}).`);
      if (j + 1 < candidateOpenRouterModels.length) {
        appendLog("sys", `Degrading to next OpenRouter model: ${candidateOpenRouterModels[j + 1]}...`);
      }
    }
  }

  return { ok: false, error: "All AI providers and models exhausted without successful response." };
}

async function runAiGenerationLoop() {
  if (isLoopRunning) return;
  isLoopRunning = true;
  currentAbortController = new AbortController();
  btnRunLoop.classList.add("hidden");
  btnCancel.classList.remove("hidden");
  codePanel.classList.add("hidden");
  testResult.classList.add("hidden");
  btnSaveCode.classList.add("hidden");
  btnDownloadCode.classList.add("hidden");
  btnPublishCode.classList.add("hidden");

  const sanitizedId = extractDomainBaseName(domain);
  const titleName = derivePluginName(domain);
  const baseUrl = `https://${domain}`;

  appendLog("sys", `Starting staged modular synthesis for ${domain}...`);

  const effectiveGemini = geminiToken || (manualToken && !manualToken.startsWith("sk-") ? manualToken : "") || oauthToken;
  const effectiveOpenRouter = openRouterToken || (manualToken && manualToken.startsWith("sk-") ? manualToken : "");

  if (!effectiveGemini && !effectiveOpenRouter) {
    appendLog("err", "No AI API keys configured. Synthesizing heuristic local scaffold...");
    await animateProgressBar("Synthesizing local scaffold plugin", 500, "ansi-yellow");
    const scaffold = generateLocalScaffold(sanitizedId, titleName, domain, recordingData);
    codeOutput.value = scaffold;
    codePanel.classList.remove("hidden");
    btnSaveCode.classList.remove("hidden");
    btnDownloadCode.classList.remove("hidden");
    btnPublishCode.classList.remove("hidden");
    genStatus.textContent = "Status: Scaffold Generated";
    btnRunLoop.disabled = false;
    btnRunLoop.textContent = "Generate";
    btnRunLoop.classList.remove("hidden");
    btnCancel.classList.add("hidden");
    isLoopRunning = false;
    currentAbortController = null;
    return;
  }

  try {
    const savedCheckpoint = await loadSessionCheckpoint(domain);
    let globalHelpers = Array.isArray(savedCheckpoint?.globalHelpers) ? [...savedCheckpoint.globalHelpers] : [];
    let apiBlueprint = savedCheckpoint?.apiBlueprint || "";
    let searchMethodCode = savedCheckpoint?.searchMethodCode || "";
    let getEpisodesMethodCode = savedCheckpoint?.getEpisodesMethodCode || "";
    let getStreamsMethodCode = savedCheckpoint?.getStreamsMethodCode || "";
    let getHomeMethodCode = savedCheckpoint?.getHomeMethodCode || "";
    let sampleMediaItem = savedCheckpoint?.sampleMediaItem || null;
    let sampleEpisodeItem = savedCheckpoint?.sampleEpisodeItem || null;

    if (savedCheckpoint && savedCheckpoint.lastCompletedPhase) {
      appendLog("sys", `\x1b[32m[Checkpoint]\x1b[0m Resuming synthesis session from last verified checkpoint: \x1b[1m${savedCheckpoint.lastCompletedPhase}\x1b[0m`);
    }

    // ==========================================
    // PHASE 1: API Understanding & Blueprint
    // ==========================================
    if (apiBlueprint) {
      appendLog("resp", `\x1b[32m✓ [Phase 1/5 - Resumed]\x1b[0m Architectural Blueprint loaded from saved checkpoint.`);
      appendPayloadLog("Phase 1 Blueprint (Restored)", apiBlueprint, "Restored Checkpoint", true);
    } else {
      appendLog("sys", "\x1b[36m[Phase 1/5]\x1b[0m Generating Architectural Blueprint from sniffed traffic...");
      genStatus.textContent = "Status: Phase 1 - Analyzing API Architecture";

      const allTraceSummary = extractPhaseTraceSummary("all", recordingData, domain);
      const blueprintPrompt = `You are the Aggregator Plugin AI Architect.
Analyze the captured network trace summary for "${domain}" (Base URL: ${baseUrl}) and construct a comprehensive Architectural Blueprint.

SNIFFED NETWORK TRAFFIC SUMMARY:
${allTraceSummary}

Analyze the traffic and classify the website architecture into one of two models:
1. ARCHITECTURE CLASSIFICATION:
   - State clearly whether this site is TYPE_B_API_SPA (uses REST / GraphQL / JSON APIs, SvelteKit / Nuxt / Next data endpoints, __data.json) OR TYPE_A_SSR_HTML (traditional server-rendered HTML pages where media items and episodes are in static HTML markup).
   - Detail the primary JSON base URL / path prefixes (e.g. /api/..., /ajax/..., /v1/...).

2. SEARCH MECHANISM:
   - Endpoint URL & HTTP Method (e.g. GET /api/search/browse?q={q} or POST /api/search or GET /search?q={q})
   - Parameters & Required Headers (Referer, Accept, Content-Type)
   - Response structure (JSON path to items array e.g. data.results, or HTML selectors/regex for items)

3. MEDIA DETAILS & EPISODES:
   - URL pattern for anime info / details (e.g. /info/{id}/{slug} or /api/anime/{id})
   - Episode extraction strategy: Does the site have an episodes JSON endpoint, SvelteKit data chunk, or episode counts in search/info (e.g. episode_counts.sub / total_episodes) to construct episodes dynamically?
   - What is the exact watch route slug pattern (e.g. /watch/{id}/{slug}?ep={ep} vs /watch/{id}?ep={ep})?

4. VIDEO PLAYBACK & STREAMS:
   - Direct video stream APIs if present in trace (e.g. /api/sources?ep=... returning m3u8/mp4)
   - Watch URL format for the background tab sniffer (e.g. \`\${this.baseUrl}/watch/\${mediaId}/\${slug}?ep=\${epNumber}\` or \`\${this.baseUrl}/watch/\${episodeId}\`)

5. HOMEPAGE / CATALOG:
   - Sniffed catalog / popular / trending JSON API endpoint (e.g. GET /api/search/browse?sort=TRENDING_DESC or /api/home) or homepage HTML selectors

Output format:
STARTOFBLUEPRINT
<Your architectural blueprint>
ENDOFBLUEPRINT`;

      const blueprintRes = await dispatchUnifiedLlm({
        prompt: blueprintPrompt,
        contextLabel: "Phase 1: Analyzing API Architecture",
        signal: currentAbortController.signal,
      });

      if (!blueprintRes.ok || !blueprintRes.text) {
        throw new Error(`Phase 1 Failed: ${blueprintRes.error || "No response from AI"}`);
      }

      if (blueprintRes.text.includes("STARTOFBLUEPRINT")) {
        const s = blueprintRes.text.indexOf("STARTOFBLUEPRINT") + "STARTOFBLUEPRINT".length;
        const e = blueprintRes.text.indexOf("ENDOFBLUEPRINT", s);
        apiBlueprint = blueprintRes.text.substring(s, e !== -1 ? e : undefined).trim();
      } else {
        apiBlueprint = blueprintRes.text.trim();
      }

      appendLog("resp", `\x1b[32m✓ [Phase 1/5]\x1b[0m Architectural Blueprint established.`);
      appendPayloadLog("Phase 1 Blueprint", apiBlueprint, `${blueprintRes.model} │ ${apiBlueprint.length} chars`, true);

      await saveSessionCheckpoint({
        apiBlueprint,
        globalHelpers,
        searchMethodCode,
        sampleMediaItem,
        getEpisodesMethodCode,
        sampleEpisodeItem,
        getStreamsMethodCode,
        getHomeMethodCode,
        lastCompletedPhase: "Phase 1: Blueprint",
      });
      if (btnResetSession) btnResetSession.classList.remove("hidden");
    }

    // ==========================================
    // PHASE 2: Search Function (search(query))
    // ==========================================
    if (searchMethodCode && sampleMediaItem) {
      appendLog("resp", `\x1b[32m✓ [Phase 2/5 - Resumed]\x1b[0m search(query) loaded from saved checkpoint.`);
      appendPayloadLog("Phase 2 Verified search() (Restored)", searchMethodCode, `Sample: ${sampleMediaItem.title} (ID: ${sampleMediaItem.id})`, true);
    } else {
      appendLog("sys", "\x1b[36m[Phase 2/5]\x1b[0m Synthesizing and verifying search(query)...");
      genStatus.textContent = "Status: Phase 2 - Synthesizing Search Function";

      const searchTrace = extractPhaseTraceSummary("search_submit", recordingData, domain);
      let searchSuccess = false;
      let searchAttempts = 0;
      let searchErrorFeedback = "";

      while (!searchSuccess && isLoopRunning) {
        if (!isLoopRunning) break;
        searchAttempts++;

        const searchPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

RELEVANT SNIFFED SEARCH REQUESTS & GROUND-TRUTH RESPONSES:
${searchTrace}
${searchErrorFeedback ? `\nPREVIOUS TEST FAILURE (FIX THIS):\n${searchErrorFeedback}\n` : ""}
TASK: Write ONLY the async search(query) method for "${domain}".

UNIVERSAL 2-TIER SCRAPING RULES:
1. TYPE B (API / SPA): If the site uses REST/GraphQL or JSON endpoints (e.g. /api/..., /ajax/..., GraphQL):
   - Fetch the sniffed JSON endpoint with exact sniffed parameters (e.g. limit=8) and headers.
   - Parse items directly from the JSON response (e.g. json.data || json.results || json.items || json).
   - Extract item fields:
     * slug: (item.slug || item.external_ids?.anime_planet?.[0] || (typeof item.title === 'string' ? item.title : (item.title?.english || item.title?.romaji || 'anime'))).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
     * totalEpisodes: item.episode_counts?.sub || item.episode_counts?.raw || item.total_episodes || item.episode_count || 1
     * id: \`\${item.id}/\${slug}:\${totalEpisodes}\` (Encode anime ID, accurate slug, and episode count into id so getEpisodes and getStreams have full route context!)
     * title: item.title?.english || item.title?.romaji || item.title?.userPreferred || item.title?.native || (typeof item.title === 'string' ? item.title : '') || item.name || 'Untitled'
     * coverUrl: item.cover_url || item.banner_url || item.coverImage?.extraLarge || item.coverImage?.large || item.coverImage?.medium || item.poster || item.image || item.thumbnail || "" (must be absolute; if it doesn't start with "http", prepend \`\${this.baseUrl}\`)
     * url: item.url || (item.slug ? \`/info/\${item.id}/\${item.slug}\` : \`/info/\${item.id}\`)

2. TYPE A (SSR / HTML): If the site is traditional server-rendered HTML:
   - Fetch the search URL and parse items using regex or DOMParser.
   - Extract id/url, title, and coverUrl from search result cards. Prepend this.baseUrl to relative URLs.

3. DATA CONTRACT:
   - Must return a Promise resolving to an Array of objects: [{ id: string, title: string, coverUrl?: string, url?: string }]
   - MUST extract coverUrl (check item.cover_url in snake_case).
   - STRICTLY NO HARDCODING. Use live fetch(). Must return real results for "One Piece".

Format:
STARTOFCODE
async search(query) {
  // your implementation
}
ENDOFCODE`;

        const searchAiRes = await dispatchUnifiedLlm({
          prompt: searchPrompt,
          contextLabel: `Phase 2 (Attempt ${searchAttempts}): Synthesizing search(query)`,
          signal: currentAbortController.signal,
        });

        if (!searchAiRes.ok || !searchAiRes.text) {
          throw new Error(`Phase 2 Failed: ${searchAiRes.error}`);
        }

        const { methodCode, helpers } = extractCodeAndHelpers(searchAiRes.text, "search");
        if (helpers) globalHelpers.push(helpers);

        Spinner.start("Testing search('One Piece') in isolated sandbox...");
        const testRes = await runSandboxMethodTest({
          method: "search",
          code: methodCode,
          args: ["One Piece"],
          baseUrl,
          targetDomain: domain,
          helperCode: globalHelpers.join("\n\n"),
        });
        Spinner.stop();

        if (testRes.success && Array.isArray(testRes.result) && testRes.result.length > 0) {
          if (!testRes.result[0].coverUrl) {
            testRes.success = false;
            testRes.error = "Search items missing coverUrl! Make sure to extract item.cover_url (snake_case) or item.banner_url.";
          }
        }

        updateLastDiagnosticTurn({
          sandboxTest: {
            phase: "Phase 2: search",
            attempt: searchAttempts,
            extractedMethod: methodCode,
            success: testRes.success,
            error: testRes.error,
            stack: testRes.stack,
            lastFetch: testRes.lastFetch,
            resultSample: Array.isArray(testRes.result) ? testRes.result.slice(0, 3) : testRes.result,
          },
        });

        if (testRes.success && Array.isArray(testRes.result) && testRes.result.length > 0) {
          searchMethodCode = methodCode;
          sampleMediaItem = testRes.result[0];
          searchSuccess = true;
          appendLog("resp", `\x1b[32m✓ [Phase 2/5]\x1b[0m search('One Piece') PASSED (${testRes.result.length} items returned).`);
          appendPayloadLog("Phase 2 Verified search()", methodCode, `Sample: ${sampleMediaItem.title} (ID: ${sampleMediaItem.id})`, true);

          await saveSessionCheckpoint({
            apiBlueprint,
            globalHelpers,
            searchMethodCode,
            sampleMediaItem,
            getEpisodesMethodCode,
            sampleEpisodeItem,
            getStreamsMethodCode,
            getHomeMethodCode,
            lastCompletedPhase: "Phase 2: search",
          });
          if (btnResetSession) btnResetSession.classList.remove("hidden");
        } else {
          let fetchDiag = "";
          if (testRes.lastFetch) {
            fetchDiag = `\nLAST TEST FETCH EXECUTED: ${testRes.lastFetch.method || "GET"} ${testRes.lastFetch.url} (Status ${testRes.lastFetch.status || "Unknown"})\nACTUAL RESPONSE BODY SNIPPET RECEIVED:\n${testRes.lastFetch.bodySnippet || "(Empty response)"}\n`;
          }
          searchErrorFeedback = `search('One Piece') threw error: ${testRes.error || "Returned 0 items"}\nStack: ${testRes.stack || ""}${fetchDiag}`;
          appendLog("warn", `[Phase 2/5] Attempt ${searchAttempts} failed: ${testRes.error || "No items returned"}. Self-correcting...`);
          await runRetryCountdown(`search() test failed → Self-Correcting (Attempt ${searchAttempts})`, 2, { colorClass: "ansi-yellow" });
        }
      }

      if (!searchSuccess) {
        throw new Error(`Synthesis cancelled or failed to produce a working search() function.`);
      }
    }

    // ==========================================
    // PHASE 3: Episode Extraction (getEpisodes(mediaId))
    // ==========================================
    if (getEpisodesMethodCode && sampleEpisodeItem) {
      appendLog("resp", `\x1b[32m✓ [Phase 3/5 - Resumed]\x1b[0m getEpisodes(mediaId) loaded from saved checkpoint.`);
      appendPayloadLog("Phase 3 Verified getEpisodes() (Restored)", getEpisodesMethodCode, `Sample Ep: ${sampleEpisodeItem.title || "Ep " + sampleEpisodeItem.number} (ID: ${sampleEpisodeItem.id})`, true);
    } else {
      appendLog("sys", "\x1b[36m[Phase 3/5]\x1b[0m Synthesizing and verifying getEpisodes(mediaId)...");
      genStatus.textContent = "Status: Phase 3 - Synthesizing Episodes Function";

      const detailsTrace = extractPhaseTraceSummary("details_load", recordingData, domain);
      let epSuccess = false;
      let epAttempts = 0;
      let epErrorFeedback = "";

      while (!epSuccess && isLoopRunning) {
        if (!isLoopRunning) break;
        epAttempts++;

        const epPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

WORKING SAMPLE MEDIA ITEM (from your verified search function):
${JSON.stringify(sampleMediaItem, null, 2)}

RELEVANT SNIFFED DETAILS & EPISODE REQUESTS:
${detailsTrace}
${epErrorFeedback ? `\nPREVIOUS TEST FAILURE (FIX THIS):\n${epErrorFeedback}\n` : ""}
TASK: Write ONLY the async getEpisodes(mediaId) method for "${domain}".

UNIVERSAL 2-TIER EPISODE RULES:
1. TYPE B (API / SPA):
   - DO NOT scrape static HTML for episode links, because in SPAs the HTML has no episode links!
   - Extract id, slug, and total from mediaId:
     // mediaId may be "id/slug" or "id/slug:count"
     let id = mediaId, slug = 'anime', totalEpisodes = 1;
     if (mediaId.includes(':')) {
       const [pathPart, countPart] = mediaId.split(':');
       totalEpisodes = parseInt(countPart, 10) || 1;
       mediaId = pathPart;
     }
     if (mediaId.includes('/')) {
       const parts = mediaId.split('/');
       id = parts[0];
       slug = parts[1];
     }
   - If totalEpisodes <= 1:
     Query the API to get the real episode count:
     const apiRes = await fetch(\`\${this.baseUrl}/api/search/browse?q=\${encodeURIComponent(slug.replace(/-/g, ' '))}&limit=8&type=ANIME\`);
     const apiData = await apiRes.json();
     const match = apiData.data?.find(d => d.id === id) || apiData.data?.[0];
     totalEpisodes = match?.episode_counts?.sub || match?.episode_counts?.raw || match?.total_episodes || 1;
   - Generate all episodes:
     return Array.from({ length: totalEpisodes }, (_, i) => ({
       id: \`\${id}/\${slug}?ep=\${i + 1}\`,
       number: i + 1,
       title: \`Episode \${i + 1}\`,
       url: \`\${this.baseUrl}/watch/\${id}/\${slug}?ep=\${i + 1}\`
     }));
   - REJECTION CRITERIA: A single 1-episode array for a multi-episode anime like "One Piece" is an automatic failure!

2. TYPE A (SSR / HTML):
   - Fetch the info page HTML and extract all episode links/buttons using regex or DOMParser.
   - Extract episode number (integer), title string, and episode ID/URL.

3. DATA CONTRACT:
   - Must return an Array of episode objects: [{ id: string, number: number, title?: string, url?: string }]
   - 'number' MUST be an integer number (1, 2, 3...).
   - 'id' or 'url' MUST contain whatever path/params getStreams() needs to fetch the stream or load the watch tab.
   - BROWSER STREAM COMPATIBILITY: Browsers CANNOT natively play .mkv or .avi files inside HTML5 video elements (and opening them triggers a browser file download). When selecting video files from an archive or metadata (e.g. archive.org), ALWAYS prioritize browser-streamable formats (.mp4 with H.264, .webm). If an item lists an original .mkv/.avi alongside an auto-generated .mp4 derivative, choose the .mp4 derivative.

Format:
STARTOFCODE
async getEpisodes(mediaId) {
  // your implementation
}
ENDOFCODE`;

        const epAiRes = await dispatchUnifiedLlm({
          prompt: epPrompt,
          contextLabel: `Phase 3 (Attempt ${epAttempts}): Synthesizing getEpisodes(mediaId)`,
          signal: currentAbortController.signal,
        });

        if (!epAiRes.ok || !epAiRes.text) {
          throw new Error(`Phase 3 Failed: ${epAiRes.error}`);
        }

        const { methodCode, helpers } = extractCodeAndHelpers(epAiRes.text, "getEpisodes");
        if (helpers) globalHelpers.push(helpers);

        Spinner.start(`Testing getEpisodes("${sampleMediaItem.id}")...`);
        const testRes = await runSandboxMethodTest({
          method: "getEpisodes",
          code: methodCode,
          args: [sampleMediaItem.id],
          baseUrl,
          targetDomain: domain,
          helperCode: globalHelpers.join("\n\n"),
        });
        Spinner.stop();

        if (testRes.success && Array.isArray(testRes.result) && testRes.result.length > 0) {
          const isMultiEp = (sampleMediaItem?.title || "").toLowerCase().includes("one piece");
          if (isMultiEp && testRes.result.length <= 1) {
            testRes.success = false;
            testRes.error = `getEpisodes returned only 1 episode for One Piece (expected > 1000 episodes from item.episode_counts.sub). SPAs do not render episodes in static HTML; parse total from mediaId or /api/search/browse.`;
          }
        }

        updateLastDiagnosticTurn({
          sandboxTest: {
            phase: "Phase 3: getEpisodes",
            attempt: epAttempts,
            extractedMethod: methodCode,
            success: testRes.success,
            error: testRes.error,
            stack: testRes.stack,
            lastFetch: testRes.lastFetch,
            resultSample: Array.isArray(testRes.result) ? testRes.result.slice(0, 3) : testRes.result,
          },
        });

        if (testRes.success && Array.isArray(testRes.result) && testRes.result.length > 0) {
          getEpisodesMethodCode = methodCode;
          sampleEpisodeItem = testRes.result[0];
          epSuccess = true;
          appendLog("resp", `\x1b[32m✓ [Phase 3/5]\x1b[0m getEpisodes("${sampleMediaItem.id}") PASSED (${testRes.result.length} episodes returned).`);
          appendPayloadLog("Phase 3 Verified getEpisodes()", methodCode, `Sample Ep: ${sampleEpisodeItem.title || "Ep " + sampleEpisodeItem.number} (ID: ${sampleEpisodeItem.id})`, true);

          await saveSessionCheckpoint({
            apiBlueprint,
            globalHelpers,
            searchMethodCode,
            sampleMediaItem,
            getEpisodesMethodCode,
            sampleEpisodeItem,
            getStreamsMethodCode,
            getHomeMethodCode,
            lastCompletedPhase: "Phase 3: getEpisodes",
          });
          if (btnResetSession) btnResetSession.classList.remove("hidden");
        } else {
          let fetchDiag = "";
          if (testRes.lastFetch) {
            fetchDiag = `\nLAST TEST FETCH EXECUTED: ${testRes.lastFetch.method || "GET"} ${testRes.lastFetch.url} (Status ${testRes.lastFetch.status || "Unknown"})\nACTUAL RESPONSE BODY SNIPPET RECEIVED:\n${testRes.lastFetch.bodySnippet || "(Empty response)"}\n`;
          }
          epErrorFeedback = `getEpisodes("${sampleMediaItem.id}") threw error: ${testRes.error || "Returned 0 episodes"}\nStack: ${testRes.stack || ""}${fetchDiag}`;
          appendLog("warn", `[Phase 3/5] Attempt ${epAttempts} failed: ${testRes.error || "No episodes returned"}. Self-correcting...`);
          await runRetryCountdown(`getEpisodes() test failed → Self-Correcting (Attempt ${epAttempts})`, 2, { colorClass: "ansi-yellow" });
        }
      }

      if (!epSuccess) {
        throw new Error(`Synthesis cancelled or failed to produce a working getEpisodes() function.`);
      }
    }

    // ==========================================
    // PHASE 4: Video Streams (getStreams(episodeId))
    // ==========================================
    if (getStreamsMethodCode) {
      appendLog("resp", `\x1b[32m✓ [Phase 4/5 - Resumed]\x1b[0m getStreams(episodeId) loaded from saved checkpoint.`);
      appendPayloadLog("Phase 4 Verified getStreams() (Restored)", getStreamsMethodCode, "Restored Checkpoint", true);
    } else {
      appendLog("sys", "\x1b[36m[Phase 4/5]\x1b[0m Synthesizing and verifying getStreams(episodeId)...");
      genStatus.textContent = "Status: Phase 4 - Synthesizing Video Streams Function";

      const videoTrace = extractPhaseTraceSummary("video_play", recordingData, domain);
      let streamSuccess = false;
      let streamAttempts = 0;
      let streamErrorFeedback = "";

      while (!streamSuccess && isLoopRunning) {
        if (!isLoopRunning) break;
        streamAttempts++;

        const streamPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

WORKING SAMPLE EPISODE ITEM (from your verified getEpisodes):
${JSON.stringify(sampleEpisodeItem, null, 2)}

RELEVANT SNIFFED VIDEO & PLAYER REQUESTS (Pay close attention to Headers & Watch URLs):
${videoTrace}
${streamErrorFeedback ? `\nPREVIOUS TEST FAILURE (FIX THIS):\n${streamErrorFeedback}\n` : ""}
TASK: Write ONLY the async getStreams(episodeId) method for "${domain}".

UNIVERSAL 2-TIER STREAM EXTRACTION STRATEGIES:
1. STRATEGY 1 (Direct API / Sniffed Stream Source):
   - If sniffed traffic reveals a direct API returning .m3u8, .mpd, .mp4, or player source JSON (e.g. /api/sources?ep=... or /ajax/v2/episode/servers):
     Fetch that endpoint and return [{ quality: "1080p", url: streamUrl, type: "sub", headers?: { Referer, Origin } }].

2. STRATEGY 2 (Universal Background Tab Sniffer for Obfuscated / Iframe Players):
   - Use the background tab sniffer to load the watch page and automatically capture the stream URL:
     const browserAPI = globalThis.browser || globalThis.chrome;
     if (browserAPI?.runtime?.sendMessage) {
       // Construct exact watch URL matching the site's routing structure
       let watchUrl = episodeId;
       if (!watchUrl.startsWith("http")) {
         watchUrl = episodeId.startsWith("/") ? \`\${this.baseUrl}\${episodeId}\` : \`\${this.baseUrl}/watch/\${episodeId}\`;
       }
       // If URL contains placeholder "anime" slug, resolve the real redirected slug
       if (watchUrl.includes("/anime?")) {
         try {
           const tmpRes = await fetch(watchUrl);
           const finalUrl = tmpRes.url;
           const canonicalMatch = finalUrl.match(/<link rel="canonical" href="([^"]+)"/i);
           if (canonicalMatch) {
             watchUrl = canonicalMatch[1];
           } else if (finalUrl && !finalUrl.includes("/anime?")) {
             watchUrl = finalUrl;
           } else {
             const parts = new URL(finalUrl).pathname.split("/");
             const realSlug = parts[parts.length - 2] || parts[parts.length - 1];
             if (realSlug && realSlug !== "anime") {
               watchUrl = watchUrl.replace("/anime?", \`/\${realSlug}?\`);
             }
           }
         } catch (e) {}
       }
       const res = await browserAPI.runtime.sendMessage({ action: "STREAM_BACKGROUND_TAB", url: watchUrl });
       if (res?.status === "FOUND" && res.url) {
         return [{ quality: "Auto", url: res.url, type: "sub", headers: res.headers || {} }];
       }
     }
     return [];

3. DATA CONTRACT:
   - Must return a non-empty Array of stream objects: [{ url: string, quality?: string, type?: "sub"|"dub", subtitles?: [{ file, label }], headers?: object }]
   - Do NOT return embed/iframe HTML URLs. Return direct media stream URLs (.m3u8, .mp4) or use the background tab sniffer.
   - BROWSER STREAM COMPATIBILITY: Direct streams MUST be browser-playable formats (.mp4, .m3u8, .webm). Browsers cannot play .mkv or .avi files (they trigger file downloads). If episodeId has a .mkv or .avi extension, map it to the corresponding .mp4 derivative (e.g. episodeId.replace(/\.(mkv|avi)$/i, '.mp4')) or use the site's streaming route (e.g. for archive.org, prefer https://archive.org/serve/... or /download/... with .mp4).

Format:
STARTOFCODE
async getStreams(episodeId) {
  // your implementation
}
ENDOFCODE`;

        const streamAiRes = await dispatchUnifiedLlm({
          prompt: streamPrompt,
          contextLabel: `Phase 4 (Attempt ${streamAttempts}): Synthesizing getStreams(episodeId)`,
          signal: currentAbortController.signal,
        });

        if (!streamAiRes.ok || !streamAiRes.text) {
          throw new Error(`Phase 4 Failed: ${streamAiRes.error}`);
        }

        const { methodCode, helpers } = extractCodeAndHelpers(streamAiRes.text, "getStreams");
        if (helpers) globalHelpers.push(helpers);

        Spinner.start(`Testing getStreams("${sampleEpisodeItem.id}")...`);
        const testRes = await runSandboxMethodTest({
          method: "getStreams",
          code: methodCode,
          args: [sampleEpisodeItem.id],
          baseUrl,
          targetDomain: domain,
          helperCode: globalHelpers.join("\n\n"),
        });
        Spinner.stop();

        updateLastDiagnosticTurn({
          sandboxTest: {
            phase: "Phase 4: getStreams",
            attempt: streamAttempts,
            extractedMethod: methodCode,
            success: testRes.success,
            error: testRes.error,
            stack: testRes.stack,
            lastFetch: testRes.lastFetch,
            resultSample: Array.isArray(testRes.result) ? testRes.result.slice(0, 3) : testRes.result,
          },
        });

        if (testRes.success && Array.isArray(testRes.result) && testRes.result.length > 0) {
          getStreamsMethodCode = methodCode;
          streamSuccess = true;
          appendLog("resp", `\x1b[32m✓ [Phase 4/5]\x1b[0m getStreams("${sampleEpisodeItem.id}") PASSED (${testRes.result.length} stream sources returned).`);
          appendPayloadLog("Phase 4 Verified getStreams()", methodCode, `Stream URL: ${testRes.result[0]?.url?.substring(0, 60)}...`, true);

          await saveSessionCheckpoint({
            apiBlueprint,
            globalHelpers,
            searchMethodCode,
            sampleMediaItem,
            getEpisodesMethodCode,
            sampleEpisodeItem,
            getStreamsMethodCode,
            getHomeMethodCode,
            lastCompletedPhase: "Phase 4: getStreams",
          });
          if (btnResetSession) btnResetSession.classList.remove("hidden");
        } else {
          let fetchDiag = "";
          if (testRes.lastFetch) {
            fetchDiag = `\nLAST TEST FETCH EXECUTED: ${testRes.lastFetch.method || "GET"} ${testRes.lastFetch.url} (Status ${testRes.lastFetch.status || "Unknown"})\nACTUAL RESPONSE BODY SNIPPET RECEIVED:\n${testRes.lastFetch.bodySnippet || "(Empty response)"}\n`;
          }
          streamErrorFeedback = `getStreams("${sampleEpisodeItem.id}") threw error: ${testRes.error || "Returned 0 streams"}\nStack: ${testRes.stack || ""}${fetchDiag}`;
          appendLog("warn", `[Phase 4/5] Attempt ${streamAttempts} failed: ${testRes.error || "No streams returned"}. Self-correcting...`);
          await runRetryCountdown(`getStreams() test failed → Self-Correcting (Attempt ${streamAttempts})`, 2, { colorClass: "ansi-yellow" });
        }
      }

      if (!streamSuccess) {
        throw new Error(`Synthesis cancelled or failed to produce a working getStreams() function.`);
      }
    }

    // ==========================================
    // PHASE 5: Home Catalog (getHome())
    // ==========================================
    if (getHomeMethodCode) {
      appendLog("resp", `\x1b[32m✓ [Phase 5/5 - Resumed]\x1b[0m getHome() loaded from saved checkpoint.`);
      appendPayloadLog("Phase 5 Verified getHome() (Restored)", getHomeMethodCode, "Restored Checkpoint", true);
    } else {
      appendLog("sys", "\x1b[36m[Phase 5/5]\x1b[0m Synthesizing and verifying getHome()...");
      genStatus.textContent = "Status: Phase 5 - Synthesizing Home Catalog Function";

      const homeTrace = extractPhaseTraceSummary("initial_load", recordingData, domain);
      let homeSuccess = false;
      let homeAttempts = 0;
      let homeErrorFeedback = "";

      while (!homeSuccess && isLoopRunning) {
        if (!isLoopRunning) break;
        homeAttempts++;

        const homePrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

RELEVANT SNIFFED INITIAL LOAD / HOMEPAGE REQUESTS & GROUND-TRUTH RESPONSES:
${homeTrace}
${homeErrorFeedback ? `\nPREVIOUS TEST FAILURE (FIX THIS):\n${homeErrorFeedback}\n` : ""}
TASK: Write ONLY the async getHome() method for "${domain}".

UNIVERSAL 2-TIER HOMEPAGE RULES:
1. TYPE B (API / SPA):
   - STRICT PARAMETER FIDELITY: When calling sniffed browse/search APIs, adhere strictly to the exact parameter names and values verified in the trace. For example, if the trace shows \`limit=8\`, use \`limit=8\` — do NOT inflate to 20 or 30 or omit required parameters (like q), as APIs will reject unapproved parameters with HTTP 400 Bad Request ("Unsupported browse request").
   - DELEGATION PATTERN: You can directly delegate to your already-verified search function to populate catalog items if the site has no dedicated home API:
     const items = await this.search('a'); // or another popular query / letter
     return items;
   - If initial HTML contains embedded state (like SvelteKit __data.json, Next.js __NEXT_DATA__, Nuxt window.__NUXT__), parse it.

2. TYPE A (SSR / HTML):
   - Fetch \`\${this.baseUrl}\` and extract featured / trending / latest anime cards using regex or DOMParser.

3. DATA CONTRACT:
   - Must return a non-empty Array of media objects: [{ id: string, title: string, coverUrl?: string, url?: string }]
   - 'title' must be a valid string: item.title?.english || item.title?.romaji || item.title?.userPreferred || (typeof item.title === 'string' ? item.title : '') || item.name || 'Untitled'
   - 'coverUrl' must be an absolute URL. Prepend this.baseUrl if relative.
   - STRICTLY NO HARDCODING. Use live fetch().

Format:
STARTOFCODE
async getHome() {
  // your implementation
}
ENDOFCODE`;

        const homeAiRes = await dispatchUnifiedLlm({
          prompt: homePrompt,
          contextLabel: `Phase 5 (Attempt ${homeAttempts}): Synthesizing getHome()`,
          signal: currentAbortController.signal,
        });

        if (!homeAiRes.ok || !homeAiRes.text) {
          throw new Error(`Phase 5 Failed: ${homeAiRes.error}`);
        }

        const { methodCode, helpers } = extractCodeAndHelpers(homeAiRes.text, "getHome");
        if (helpers) globalHelpers.push(helpers);

        Spinner.start("Testing getHome() in isolated sandbox...");
        const testRes = await runSandboxMethodTest({
          method: "getHome",
          code: methodCode,
          args: [],
          baseUrl,
          targetDomain: domain,
          helperCode: globalHelpers.join("\n\n"),
        });
        Spinner.stop();

        updateLastDiagnosticTurn({
          sandboxTest: {
            phase: "Phase 5: getHome",
            attempt: homeAttempts,
            extractedMethod: methodCode,
            success: testRes.success,
            error: testRes.error,
            stack: testRes.stack,
            lastFetch: testRes.lastFetch,
            resultSample: Array.isArray(testRes.result) ? testRes.result.slice(0, 3) : testRes.result,
          },
        });

        if (testRes.success && Array.isArray(testRes.result) && testRes.result.length > 0) {
          getHomeMethodCode = methodCode;
          homeSuccess = true;
          appendLog("resp", `\x1b[32m✓ [Phase 5/5]\x1b[0m getHome() PASSED (${testRes.result.length} catalog items returned).`);
          appendPayloadLog("Phase 5 Verified getHome()", methodCode, `Sample: ${testRes.result[0]?.title}`, true);

          await saveSessionCheckpoint({
            apiBlueprint,
            globalHelpers,
            searchMethodCode,
            sampleMediaItem,
            getEpisodesMethodCode,
            sampleEpisodeItem,
            getStreamsMethodCode,
            getHomeMethodCode,
            lastCompletedPhase: "Phase 5: getHome",
          });
          if (btnResetSession) btnResetSession.classList.remove("hidden");
        } else {
          let fetchDiag = "";
          if (testRes.lastFetch) {
            fetchDiag = `\nLAST TEST FETCH EXECUTED: ${testRes.lastFetch.method || "GET"} ${testRes.lastFetch.url} (Status ${testRes.lastFetch.status || "Unknown"})\nACTUAL RESPONSE BODY SNIPPET RECEIVED:\n${testRes.lastFetch.bodySnippet || "(Empty response)"}\n`;
          }
          homeErrorFeedback = `getHome() threw error: ${testRes.error || "Returned 0 items"}\nStack: ${testRes.stack || ""}${fetchDiag}`;
          appendLog("warn", `[Phase 5/5] Attempt ${homeAttempts} failed: ${testRes.error || "No items returned"}. Self-correcting...`);
          await runRetryCountdown(`getHome() test failed → Self-Correcting (Attempt ${homeAttempts})`, 2, { colorClass: "ansi-yellow" });
        }
      }

      if (!homeSuccess) {
        throw new Error(`Synthesis cancelled or failed to produce a working getHome() function.`);
      }
    }

    // ==========================================
    // PHASE 6: Assemble Complete Plugin & Full 6/6 Verification
    // ==========================================
    appendLog("sys", "\x1b[36m[Phase 6]\x1b[0m Assembling full plugin and executing comprehensive 6/6 test suite...");
    genStatus.textContent = "Status: Phase 6 - Full Verification Test Suite";

    let suiteSuccess = false;
    let suiteAttempts = 0;
    let assembledPlugin = "";
    let lastSuiteReport = null;

    while (!suiteSuccess && isLoopRunning) {
      if (!isLoopRunning) break;
      suiteAttempts++;

      const uniqueHelpers = Array.from(new Set(globalHelpers.filter(Boolean)));
      assembledPlugin = `${uniqueHelpers.length > 0 ? uniqueHelpers.join("\n\n") + "\n\n" : ""}export default {
  id: "${sanitizedId}",
  name: "${titleName}",
  baseUrl: "${baseUrl}",
  version: "1.0.0",

  ${getHomeMethodCode},

  ${searchMethodCode},

  ${getEpisodesMethodCode},

  ${getStreamsMethodCode},
};`;

      codeOutput.value = assembledPlugin;
      codePanel.classList.remove("hidden");
      btnSaveCode.classList.remove("hidden");
      btnDownloadCode.classList.remove("hidden");

      Spinner.start(`Running full 6/6 sandbox test suite (Attempt ${suiteAttempts})...`);
      const suiteReport = await runPluginTestSuite(assembledPlugin, domain, recordingData);
      lastSuiteReport = suiteReport;
      Spinner.stop();

      if (suiteReport.passed) {
        suiteSuccess = true;
        appendLog("resp", `\x1b[32m✓\x1b[0m Comprehensive test suite PASSED (6/6 tests passed).`);
        testResult.classList.remove("hidden");
        testResult.textContent = `PASS: All 6 unit tests passed. Launch Phase 7 Live Trial below!`;
        testResult.style.color = "#67e8f9";

        await saveSessionCheckpoint({
          apiBlueprint,
          globalHelpers,
          searchMethodCode,
          sampleMediaItem,
          getEpisodesMethodCode,
          sampleEpisodeItem,
          getStreamsMethodCode,
          getHomeMethodCode,
          lastCompletedPhase: "Phase 6: Full Suite Passed",
        });
        if (btnResetSession) btnResetSession.classList.remove("hidden");

        // ==========================================
        // PHASE 7: Interactive Live Trial
        // ==========================================
        appendLog("sys", `\x1b[36m[Phase 7] Launching Interactive Trial Mode for "${titleName}"...\x1b[0m`);
        genStatus.textContent = "Status: Phase 7 - Trial Active";

        await browserAPI.storage.local.set({
          aggregator_trial_plugin: {
            id: sanitizedId,
            name: titleName,
            baseUrl: `https://${domain}`,
            code: assembledPlugin,
            version: "1.0.0",
          },
        }).catch(() => {});

        trialPanel.classList.remove("hidden");
        trialFeedbackBox.classList.add("hidden");
        trialFeedbackInput.value = "";

        btnLaunchTrial.onclick = () => {
          const trialUrl = browserAPI.runtime.getURL(
            `super-website/super-website/dist/index.html?trial=true&trialPluginId=${encodeURIComponent(sanitizedId)}`
          );
          browserAPI.tabs.create({ url: trialUrl }).catch(() => {
            window.open(trialUrl, "_blank");
          });
          appendLog("out", `Opened Aggregator in isolated Trial Mode.`);
        };

        btnApproveTrial.onclick = async () => {
          trialPanel.classList.add("hidden");
          trialFeedbackBox.classList.add("hidden");
          await browserAPI.storage.local.remove("aggregator_trial_plugin").catch(() => {});
          await clearSessionCheckpoint(domain);
          appendLog("resp", `\x1b[32m[Phase 7] User APPROVED plugin! Finalizing installation...\x1b[0m`);
          genStatus.textContent = "Status: Verified & Approved";
          testResult.textContent = `SUCCESS: Plugin for "${domain}" approved and installed!`;
          testResult.style.color = "#a7f3d0";
          await savePluginLocally();
          await publishPluginToEdge();
          btnSaveCode.classList.remove("hidden");
          btnPublishCode.classList.remove("hidden");
        };

        btnRejectTrial.onclick = () => {
          trialFeedbackBox.classList.remove("hidden");
          trialFeedbackInput.focus();
        };

        btnSubmitFeedback.onclick = async () => {
          const feedbackText = trialFeedbackInput.value.trim();
          if (!feedbackText) return;
          trialPanel.classList.add("hidden");
          trialFeedbackBox.classList.add("hidden");
          appendLog("warn", `[Phase 7] User reported feedback: "${feedbackText}". Please rerun generation with adjustments.`);
        };
        break;
      }

      // If suite failed, diagnose the failing tests and trigger self-correction
      appendLog("warn", `[Phase 6] Full test suite attempt ${suiteAttempts} failed (${suiteReport.passedCount}/6 passed). Analyzing failures to self-correct...`);

      const failedTests = suiteReport.failedTests || [];
      const failureDescriptions = failedTests.map((f) => `- Test: ${f.test}\n  Error: ${f.error}\n  Expected: ${f.expected || ""}\n  Actual: ${f.actual || ""}`).join("\n\n");

      let httpErrContext = "";
      if (Array.isArray(suiteReport.httpErrors) && suiteReport.httpErrors.length > 0) {
        httpErrContext = `\nHTTP ERRORS ENCOUNTERED DURING SUITE:\n` + JSON.stringify(suiteReport.httpErrors.slice(-3), null, 2) + "\n";
      }

      const failedGetStreams = failedTests.some((f) => f.test.toLowerCase().includes("stream"));
      const failedGetEpisodes = failedTests.some((f) => f.test.toLowerCase().includes("episode"));
      const failedGetHome = failedTests.some((f) => f.test.toLowerCase().includes("home"));
      const failedSearch = failedTests.some((f) => f.test.toLowerCase().includes("search"));

      let fixTargetMethod = "assembled plugin";
      let specificPrompt = "";

      if (failedGetStreams) {
        fixTargetMethod = "getStreams(episodeId)";
        const videoTrace = extractPhaseTraceSummary("video_play", recordingData, domain);
        specificPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

THE INTEGRATION TEST SUITE FAILED ON TEST 6/6: getStreams(episodeId).
FAILURE DETAILS:
${failureDescriptions}
${httpErrContext}
CURRENT getStreams CODE:
${getStreamsMethodCode}

RELEVANT SNIFFED VIDEO REQUESTS:
${videoTrace}

TASK: Rewrite ONLY the async getStreams(episodeId) method for "${domain}" to fix this failure.
Rules:
- Strategy 1 (Direct APIs): If the sniffed traffic reveals a direct API returning .m3u8, .mp4, or stream sources, fetch that endpoint and return [{ quality: "1080p", url: streamUrl, type: "sub" }].
- Strategy 2 (Robust Fallback for Obfuscated / Iframe Players): Use the Background Tab Sniffer:
  const browserAPI = globalThis.browser || globalThis.chrome;
  if (browserAPI?.runtime?.sendMessage) {
    let watchUrl = episodeId;
    if (!watchUrl.startsWith("http")) {
      watchUrl = episodeId.startsWith("/") ? \`\${this.baseUrl}\${episodeId}\` : \`\${this.baseUrl}/watch/\${episodeId}\`;
    }
    const res = await browserAPI.runtime.sendMessage({ action: "STREAM_BACKGROUND_TAB", url: watchUrl });
    if (res?.status === "FOUND" && res.url) {
      return [{ quality: "Auto", url: res.url, type: "sub", headers: res.headers || {} }];
    }
  }
  return [];
- Must return a non-empty Array of stream objects [{ quality?: string, url: string, type?: "sub" }].

Format:
STARTOFCODE
async getStreams(episodeId) {
  // your implementation
}
ENDOFCODE`;
      } else if (failedGetEpisodes) {
        fixTargetMethod = "getEpisodes(mediaId)";
        const detailsTrace = extractPhaseTraceSummary("details_load", recordingData, domain);
        specificPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

THE INTEGRATION TEST SUITE FAILED ON TEST 5/6: getEpisodes(mediaId).
FAILURE DETAILS:
${failureDescriptions}
${httpErrContext}
CURRENT getEpisodes CODE:
${getEpisodesMethodCode}

RELEVANT SNIFFED EPISODE REQUESTS:
${detailsTrace}

TASK: Rewrite ONLY the async getEpisodes(mediaId) method for "${domain}" to fix this failure.
- Must return Array of episode objects: [{ id: string, number: number, title?: string, url?: string }].
- DYNAMIC SPA PATTERN:
  let id = mediaId;
  let slug = 'anime';
  let totalEpisodes = 1;
  if (mediaId.includes(':')) {
    const [pathPart, countPart] = mediaId.split(':');
    totalEpisodes = parseInt(countPart, 10) || 1;
    mediaId = pathPart;
  }
  if (mediaId.includes('/')) {
    const parts = mediaId.split('/');
    id = parts[0];
    slug = parts[1];
  }
  if (totalEpisodes <= 1) {
    const apiRes = await fetch(\`\${this.baseUrl}/api/search/browse?q=\${encodeURIComponent(slug.replace(/-/g, ' '))}&limit=8&type=ANIME\`);
    const apiData = await apiRes.json();
    const match = apiData.data?.find(d => d.id === id) || apiData.data?.[0];
    totalEpisodes = match?.episode_counts?.sub || match?.episode_counts?.raw || match?.total_episodes || 1;
  }
  return Array.from({ length: totalEpisodes }, (_, i) => ({
    id: \`\${id}/\${slug}?ep=\${i + 1}\`,
    number: i + 1,
    title: \`Episode \${i + 1}\`,
    url: \`\${this.baseUrl}/watch/\${id}/\${slug}?ep=\${i + 1}\`
  }));
- REJECTION CRITERIA: A single 1-episode array for a multi-episode anime like One Piece is invalid.

Format:
STARTOFCODE
async getEpisodes(mediaId) {
  // your implementation
}
ENDOFCODE`;
      } else if (failedGetHome) {
        fixTargetMethod = "getHome()";
        const homeTrace = extractPhaseTraceSummary("initial_load", recordingData, domain);
        specificPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

THE INTEGRATION TEST SUITE FAILED ON TEST 3/6: getHome().
FAILURE DETAILS:
${failureDescriptions}
${httpErrContext}
CURRENT getHome CODE:
${getHomeMethodCode}

RELEVANT SNIFFED HOMEPAGE REQUESTS:
${homeTrace}

TASK: Rewrite ONLY the async getHome() method for "${domain}" to fix this failure.
- Must return a non-empty Array of media items: [{ id: string, title: string, coverUrl?: string, url?: string }].
- For Type B SPA sites, keep exact sniffed parameters (e.g. limit=8) or delegate directly:
  return await this.search('a'); // or other popular query using your verified search() method
- Prepend this.baseUrl for relative cover URLs.

Format:
STARTOFCODE
async getHome() {
  // your implementation
}
ENDOFCODE`;
      } else if (failedSearch) {
        fixTargetMethod = "search(query)";
        const searchTrace = extractPhaseTraceSummary("search_submit", recordingData, domain);
        specificPrompt = `ARCHITECTURAL BLUEPRINT:
${apiBlueprint}

THE INTEGRATION TEST SUITE FAILED ON TEST 4/6: search(query).
FAILURE DETAILS:
${failureDescriptions}
${httpErrContext}
CURRENT search CODE:
${searchMethodCode}

RELEVANT SNIFFED SEARCH REQUESTS:
${searchTrace}

TASK: Rewrite ONLY the async search(query) method for "${domain}" to fix this failure.
- Must return Array of media items: [{ id: string, title: string, coverUrl?: string, url?: string }].
- For Type B SPA sites, fetch the sniffed search JSON API and extract title, coverUrl, id.

Format:
STARTOFCODE
async search(query) {
  // your implementation
}
ENDOFCODE`;
      } else {
        fixTargetMethod = "assembled plugin syntax/schema";
        specificPrompt = `THE INTEGRATION TEST SUITE FAILED ON SYNTAX / SCHEMA:
FAILURE DETAILS:
${failureDescriptions}

CURRENT ASSEMBLED CODE:
${assembledPlugin}

TASK: Fix the syntax error, export format, or schema in the plugin code. Return the corrected methods.`;
      }

      await runRetryCountdown(`Suite failure in ${fixTargetMethod} → Self-Correcting (Attempt ${suiteAttempts})`, 2, { colorClass: "ansi-yellow" });

      const fixAiRes = await dispatchUnifiedLlm({
        prompt: specificPrompt,
        contextLabel: `Phase 6 (Attempt ${suiteAttempts}): Self-correcting ${fixTargetMethod}`,
        signal: currentAbortController.signal,
      });

      if (fixAiRes.ok && fixAiRes.text) {
        if (failedGetStreams) {
          const { methodCode, helpers } = extractCodeAndHelpers(fixAiRes.text, "getStreams");
          if (methodCode) getStreamsMethodCode = methodCode;
          if (helpers) globalHelpers.push(helpers);
        } else if (failedGetEpisodes) {
          const { methodCode, helpers } = extractCodeAndHelpers(fixAiRes.text, "getEpisodes");
          if (methodCode) getEpisodesMethodCode = methodCode;
          if (helpers) globalHelpers.push(helpers);
        } else if (failedGetHome) {
          const { methodCode, helpers } = extractCodeAndHelpers(fixAiRes.text, "getHome");
          if (methodCode) getHomeMethodCode = methodCode;
          if (helpers) globalHelpers.push(helpers);
        } else if (failedSearch) {
          const { methodCode, helpers } = extractCodeAndHelpers(fixAiRes.text, "search");
          if (methodCode) searchMethodCode = methodCode;
          if (helpers) globalHelpers.push(helpers);
        }

        await saveSessionCheckpoint({
          apiBlueprint,
          globalHelpers,
          searchMethodCode,
          sampleMediaItem,
          getEpisodesMethodCode,
          sampleEpisodeItem,
          getStreamsMethodCode,
          getHomeMethodCode,
          lastCompletedPhase: `Phase 6: Fixed ${fixTargetMethod}`,
        });
      }
    }

    if (!suiteSuccess) {
      throw new Error(`Synthesis cancelled or failed full verification test suite (${lastSuiteReport?.passedCount || 0}/6 passed).`);
    }
  } catch (err) {
    appendLog("err", `Synthesis error: ${err.message}`);
    genStatus.textContent = "Status: Error";
  } finally {
    btnRunLoop.disabled = false;
    btnRunLoop.textContent = "Generate";
    btnRunLoop.classList.remove("hidden");
    btnCancel.classList.add("hidden");
    isLoopRunning = false;
    currentAbortController = null;
  }
}

function generateLocalScaffold(id, name, siteDomain, rec) {
  let homeEndpoint = `https://${siteDomain}`;
  let searchEndpoint = `https://${siteDomain}/search?keyword=`;

  if (rec && rec.phases) {
    if (rec.phases.initial_load && rec.phases.initial_load.length > 0) {
      homeEndpoint = rec.phases.initial_load[0].url;
    }
    if (rec.phases.search_submit && rec.phases.search_submit.length > 0) {
      searchEndpoint = rec.phases.search_submit[0].url;
    }
  }

  return `const plugin = {
  id: "${id}",
  name: "${name}",
  baseUrl: "https://${siteDomain}",
  version: "1.0.0",

  async getHome() {
    const res = await fetch("${homeEndpoint}");
    const html = await res.text();
    return [];
  },

  async search(query) {
    const url = "${searchEndpoint}" + encodeURIComponent(query);
    const res = await fetch(url);
    const html = await res.text();
    return [];
  },

  async getEpisodes(mediaId) {
    const url = \`\${this.baseUrl}/anime/\${mediaId}\`;
    const res = await fetch(url);
    const html = await res.text();
    return [];
  },

  async getStreams(episodeId) {
    const watchUrl = episodeId.startsWith("http") ? episodeId : \`\${this.baseUrl}/watch/\${episodeId}\`;
    const browserAPI = globalThis.browser || globalThis.chrome;
    if (browserAPI?.runtime?.sendMessage) {
      const res = await browserAPI.runtime.sendMessage({
        action: "STREAM_BACKGROUND_TAB",
        url: watchUrl,
      });
      if (res?.status === "FOUND" && res.url) {
        return [{ quality: "Auto", url: res.url, type: "sub" }];
      }
    }
    return [];
  }
};

globalThis.AggregatorPlugins = globalThis.AggregatorPlugins || {};
globalThis.AggregatorPlugins["${id}"] = plugin;
if (typeof module !== "undefined") module.exports = plugin;`;
}

let recordedHttpErrors = [];

window.addEventListener("message", async (event) => {
  if (event.data?.action === "PROXY_MESSAGE") {
    const { reqId, message } = event.data;
    try {
      const response = await browserAPI.runtime.sendMessage(message);
      const frame = document.querySelector("#sandbox-frame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(
          {
            action: "PROXY_MESSAGE_RESPONSE",
            reqId,
            response,
          },
          "*"
        );
      }
    } catch (err) {
      const frame = document.querySelector("#sandbox-frame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(
          {
            action: "PROXY_MESSAGE_RESPONSE",
            reqId,
            response: { status: "ERROR", error: err.message },
          },
          "*"
        );
      }
    }
  } else if (event.data?.action === "PROXY_FETCH") {
    const { reqId, url, init } = event.data;
    let status = 200;
    let statusText = "OK";
    let ok = true;
    let headers = {};
    let body = "";

    try {
      const res = await fetch(url, init);
      body = await res.text();
      res.headers.forEach((val, key) => {
        headers[key] = val;
      });
      status = res.status;
      statusText = res.statusText;
      ok = res.ok;
    } catch (err) {
      // Fallback to Cloudflare Edge Proxy if direct fetch fails / drops
      try {
        const regUrl = await getEffectiveRegistryUrl();
        const proxyUrl = `${regUrl}/api/v1/proxy?url=${encodeURIComponent(url)}`;
        const proxyRes = await fetch(proxyUrl, init);
        body = await proxyRes.text();
        headers = {};
        proxyRes.headers.forEach((val, key) => {
          headers[key] = val;
        });
        status = proxyRes.status;
        statusText = proxyRes.statusText;
        ok = proxyRes.ok;
      } catch (proxyErr) {
        status = 500;
        statusText = "Fetch Error";
        ok = false;
        body = proxyErr.message;
      }
    }

    if (!ok) {
      recordedHttpErrors.push({
        url,
        method: init?.method || "GET",
        status,
        statusText,
        body: body.substring(0, 300).replace(/\s+/g, " ").trim(),
      });
    }

    const frame = document.querySelector("#sandbox-frame");
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(
        {
          action: "PROXY_FETCH_RESPONSE",
          reqId,
          status,
          statusText,
          ok,
          headers,
          body,
        },
        "*"
      );
    }
  }
});

async function runPluginTestSuite(code, targetDomain, recData) {
  recordedHttpErrors = [];
  let frame = document.querySelector("#sandbox-frame");
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "sandbox-frame";
    frame.src = "sandbox.html";
    frame.style.display = "none";
    document.body.appendChild(frame);
    await new Promise((r) => setTimeout(r, 200));
  }

  return new Promise((resolve) => {
    function handleResult(event) {
      if (event.data?.action === "TEST_SUITE_RESULT") {
        window.removeEventListener("message", handleResult);
        const report = event.data.report || {};
        report.httpErrors = recordedHttpErrors;
        if (Array.isArray(report.logs)) {
          for (const l of report.logs) {
            appendLog(l.type, l.msg);
          }
        }
        resolve(report);
      }
    }

    window.addEventListener("message", handleResult);
    frame.contentWindow.postMessage(
      {
        action: "RUN_TEST_SUITE",
        code,
        targetDomain,
      },
      "*"
    );
  });
}

async function savePluginLocally() {
  const code = codeOutput.value.trim();
  if (!code) return;

  const { id: sanitizedId, name: pluginName } = parsePluginMetaFromCode(code, domain);

  const data = await browserAPI.storage.local.get("aggregator_installed_plugins");
  const installed = data.aggregator_installed_plugins || {};

  installed[sanitizedId] = {
    id: sanitizedId,
    name: pluginName,
    baseUrl: `https://${domain}`,
    version: "1.0.0",
    author: "AI:Gemini",
    channel: "NIGHTLY",
    code,
    installedAt: Date.now(),
  };

  await browserAPI.storage.local.set({ aggregator_installed_plugins: installed });
  await animateProgressBar(`Saved "${sanitizedId}" locally`, 350, "ansi-green");
  appendLog("resp", `Plugin "${sanitizedId}" saved to local extension storage.`);
  btnSaveCode.textContent = "Saved Locally [OK]";
  setTimeout(() => {
    btnSaveCode.textContent = "Save Locally";
  }, 2000);
}

function downloadPluginFile() {
  const code = codeOutput.value.trim();
  if (!code) return;

  const { id: sanitizedId } = parsePluginMetaFromCode(code, domain);
  const blob = new Blob([code], { type: "application/javascript;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = `${sanitizedId}.plugin.js`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);

  appendLog("resp", `Downloaded "${sanitizedId}.plugin.js" to local machine.`);
  btnDownloadCode.textContent = "Downloaded [OK]";
  setTimeout(() => {
    btnDownloadCode.textContent = "Download .js";
  }, 2000);
}

async function publishPluginToEdge() {
  const code = codeOutput.value.trim();
  if (!code) return;

  btnPublishCode.disabled = true;
  btnPublishCode.textContent = "Publishing...";
  Spinner.start("Publishing plugin to Edge Registry & Git...");

  const { id: sanitizedId, name: pluginName } = parsePluginMetaFromCode(code, domain);

  const payload = {
    id: sanitizedId,
    name: pluginName,
    description: `AI-synthesized plugin for ${domain}`,
    baseUrl: `https://${domain}`,
    version: "1.0.0",
    author: "AI:Gemini",
    code,
  };

  try {
    const netResult = await fetchWithNetworkRetry(`${registryUrl}/api/v1/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, {
      maxRetries: 3,
      timeoutMs: 25000,
      contextLabel: "Edge Publish",
    });

    Spinner.stop();

    if (netResult.ok) {
      await animateProgressBar(`Published "${sanitizedId}" to Edge Registry`, 400, "ansi-purple");
      appendLog("resp", `Successfully published "${sanitizedId}" to Edge & Git!`);
      btnPublishCode.textContent = "Published [OK]";
      await savePluginLocally();
    } else {
      appendLog("err", `Publish failed: HTTP ${netResult.status}`);
      btnPublishCode.textContent = "Publish to Edge";
      btnPublishCode.disabled = false;
    }
  } catch (err) {
    Spinner.stop();
    appendLog("err", `Publish network error: ${err.message}`);
    btnPublishCode.textContent = "Publish to Edge";
    btnPublishCode.disabled = false;
  }
}

async function exportDiagnosticLogs() {
  const persistedLogs = await loadPersistedSessionLogs(domain);
  const combinedLogs = (persistedLogs && persistedLogs.length > 0) ? persistedLogs : rawDiagnosticSessionLogs;
  const savedCheckpoint = await loadSessionCheckpoint(domain);

  const exportData = {
    domain,
    exportedAt: new Date().toISOString(),
    totalTurns: combinedLogs.length,
    activeCheckpoint: savedCheckpoint || null,
    sessionLogs: combinedLogs,
    currentConsoleHistory: Array.from(consoleLog.querySelectorAll(".log-entry")).map((el) => el.textContent),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json;charset=utf-8" });
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = downloadUrl;
  a.download = `aggregator_full_history_${(domain || "site").replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);

  appendLog("resp", `✓ Full historical session logs exported (${combinedLogs.length} turns across all session instances).`);
}

if (btnRunLoop) btnRunLoop.addEventListener("click", runAiGenerationLoop);
if (btnCancel) btnCancel.addEventListener("click", cancelAiGenerationLoop);
if (btnResetSession) btnResetSession.addEventListener("click", resetSessionCheckpoint);
if (btnSaveCode) btnSaveCode.addEventListener("click", savePluginLocally);
if (btnDownloadCode) btnDownloadCode.addEventListener("click", downloadPluginFile);
if (btnPublishCode) btnPublishCode.addEventListener("click", publishPluginToEdge);
if (btnExportLogs) btnExportLogs.addEventListener("click", exportDiagnosticLogs);
if (btnClose) btnClose.addEventListener("click", () => window.close());

init();
