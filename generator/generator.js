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
const btnSaveCode = document.querySelector("#btn-save-code");
const btnPublishCode = document.querySelector("#btn-publish-code");
const btnClose = document.querySelector("#btn-close");

let recordingData = null;
let oauthToken = "";
let manualToken = "";
let registryUrl = DEFAULT_REGISTRY_URL;
let isLoopRunning = false;
let currentAbortController = null;
const unsupportedChainingModels = new Set();

function appendLog(type, text) {
  const el = document.createElement("div");
  el.className = `log-entry log-${type}`;

  const time = new Date().toLocaleTimeString().split(" ")[0];
  const tag = type.toUpperCase().padEnd(4, " ");
  el.textContent = `[${time}] [${tag}] ${text}`;

  consoleLog.appendChild(el);
  consoleLog.scrollTop = consoleLog.scrollHeight;
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

async function executeProbeRequest(probe) {
  if (!probe.url) {
    return { status: 0, statusText: "Invalid URL", body: "No URL specified in probe" };
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
    const res = await fetch(probe.url, init);
    const contentType = res.headers.get("content-type") || "";
    const rawText = await res.text();
    const snippet = rawText.length > 2500 ? rawText.substring(0, 2500) + "\n...[TRUNCATED]" : rawText;

    return {
      status: res.status,
      statusText: res.statusText,
      contentType,
      body: snippet,
      totalLength: rawText.length,
    };
  } catch (err) {
    return {
      status: 500,
      statusText: "Fetch Error",
      contentType: "text/plain",
      body: err.message,
      totalLength: err.message.length,
    };
  }
}

async function init() {
  genDomain.textContent = `Site: ${domain}`;
  appendLog("sys", `Initializing plugin generator for ${domain}...`);

  const storageKey = `recording_${domain}`;
  const data = await browserAPI.storage.local.get([
    storageKey,
    "aggregator_registry_url",
    "aggregator_oauth_token",
    "aggregator_llm_token",
  ]);

  recordingData = data[storageKey];
  if (data.aggregator_registry_url) {
    registryUrl = data.aggregator_registry_url.replace(/\/+$/, "");
  }
  if (data.aggregator_oauth_token) {
    oauthToken = data.aggregator_oauth_token;
  }
  if (data.aggregator_llm_token) {
    manualToken = data.aggregator_llm_token;
  }

  if (recordingData && recordingData.phases) {
    let count = 0;
    for (const p of Object.values(recordingData.phases)) {
      if (Array.isArray(p)) count += p.length;
    }
    genStatus.textContent = `Trace Ready: ${count} requests captured`;
    appendLog("sys", `Loaded trace containing ${count} requests.`);
  } else {
    genStatus.textContent = "Warning: No network trace recorded";
    appendLog("err", `No recording found under key "${storageKey}". Using heuristic analysis.`);
  }

  if (manualToken) {
    appendLog("sys", "Gemini API Key authenticated.");
  } else if (oauthToken) {
    appendLog("sys", "Google OAuth Bearer Token authenticated.");
  } else {
    appendLog("err", "No Gemini API key found. AI requests will fallback to local synthesis.");
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
    const res = await fetch(modelsUrl, { headers });
    if (!res.ok) return defaultChain;

    const data = await res.json();
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

  let interRes = null;
  let usedChaining = Boolean(previousInteractionId) && !unsupportedChainingModels.has(cleanModel);

  if (usedChaining) {
    const chainedBody = {
      model: cleanModel,
      input: latestTurnInput || prompt,
      previous_interaction_id: previousInteractionId,
      store: true,
    };
    try {
      interRes = await fetch(interactionsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(chainedBody),
        signal,
      });
    } catch (err) {
      interRes = null;
    }

    if (interRes && interRes.status === 400) {
      const errSnippet = await interRes.text();
      unsupportedChainingModels.add(cleanModel);
      appendLog("out", `Model ${cleanModel} does not support stateful chaining. Switched permanently to stateless mode.`);
      usedChaining = false;
      interRes = null;
    }
  }

  if (!interRes) {
    const statelessBody = {
      model: cleanModel,
      input: prompt,
      store: true,
    };
    try {
      interRes = await fetch(interactionsUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(statelessBody),
        signal,
      });
    } catch (err) {
      interRes = null;
    }
  }

  if (interRes && interRes.ok) {
    let interData = await interRes.json();
    let text = extractTextFromInteraction(interData);
    let interactionId = interData.id || interData.interaction_id || interData.interaction?.id || interData.name || "";

    if (interData.status === "in_progress" && !text && interactionId) {
      for (let poll = 0; poll < 10; poll++) {
        await new Promise((r) => setTimeout(r, 1500));
        const pollUrl = isBearer
          ? `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(interactionId)}`
          : `https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(interactionId)}?key=${encodeURIComponent(effectiveToken.trim())}`;
        const pollRes = await fetch(pollUrl, { headers });
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
        status: interRes.status,
        text,
        interactionId,
        usedInteractions: true,
      };
    }
  }

  const shouldTryGenerateContent =
    !interRes ||
    interRes.status === 404 ||
    interRes.status === 400 ||
    interRes.status === 501;

  if (shouldTryGenerateContent) {
    const genUrl = isBearer
      ? `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent`
      : `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(effectiveToken.trim())}`;

    const genHeaders = { "Content-Type": "application/json" };
    if (isBearer) {
      genHeaders["Authorization"] = `Bearer ${effectiveToken.trim()}`;
      genHeaders["x-goog-user-project"] = "aggregator-510615";
    }

    try {
      const genRes = await fetch(genUrl, {
        method: "POST",
        headers: genHeaders,
        body: JSON.stringify({ contents: conversationHistory }),
        signal,
      });

      if (genRes.ok) {
        const genData = await genRes.json();
        const genText = genData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (genText) {
          return {
            ok: true,
            status: genRes.status,
            text: genText,
            interactionId: "",
            usedInteractions: false,
          };
        }
      } else {
        const genErrText = await genRes.text();
        return {
          ok: false,
          status: genRes.status,
          error: genErrText,
          usedInteractions: false,
        };
      }
    } catch (genErr) {
      return {
        ok: false,
        status: 0,
        error: genErr.message,
        usedInteractions: false,
      };
    }
  }

  const interErrText = interRes ? await interRes.text() : "Network error";
  return {
    ok: false,
    status: interRes ? interRes.status : 0,
    error: interErrText,
    usedInteractions: true,
  };
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
  if (!isLoopRunning) return;
  isLoopRunning = false;
  if (currentAbortController) {
    try {
      currentAbortController.abort();
    } catch (e) {}
    currentAbortController = null;
  }
  appendLog("sys", "Generation canceled by user.");
  genStatus.textContent = "Status: Canceled";
  btnRunLoop.disabled = false;
  btnRunLoop.textContent = "Generate";
  btnRunLoop.classList.remove("hidden");
  btnCancel.classList.add("hidden");
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
  btnPublishCode.classList.add("hidden");

  const sanitizedId = extractDomainBaseName(domain);
  const titleName = derivePluginName(domain);

  appendLog("sys", "Starting iterative LLM synthesis pipeline...");

  const effectiveToken = manualToken || oauthToken;

  if (!effectiveToken) {
    appendLog("err", "No Gemini API key found in settings.");
    appendLog("sys", "Synthesizing scaffold plugin from captured network traces...");

    await new Promise((r) => setTimeout(r, 600));

    const scaffold = generateLocalScaffold(sanitizedId, titleName, domain, recordingData);
    codeOutput.value = scaffold;
    codePanel.classList.remove("hidden");
    btnSaveCode.classList.remove("hidden");
    btnPublishCode.classList.remove("hidden");

    appendLog("sys", "Scaffold synthesized. Ready for testing and validation.");
    genStatus.textContent = "Status: Scaffold Generated";
    btnRunLoop.disabled = false;
    btnRunLoop.textContent = "Generate";
    btnRunLoop.classList.remove("hidden");
    btnCancel.classList.add("hidden");
    isLoopRunning = false;
    currentAbortController = null;
    return;
  }

  const isBearer = (effectiveToken && effectiveToken.startsWith("ya29.")) || (!manualToken && Boolean(oauthToken));
  appendLog("sys", "Discovering eligible Gemini models from API...");
  const candidateModels = await getEligibleGeminiModels(effectiveToken, isBearer);
  let activeModelIndex = 0;
  appendLog("sys", `Available model chain: ${candidateModels.join(" -> ")}`);

  const phaseSummaries = {};
  if (recordingData && recordingData.phases) {
    for (const [phaseName, reqs] of Object.entries(recordingData.phases)) {
      if (Array.isArray(reqs)) {
        phaseSummaries[phaseName] = reqs.slice(0, 6).map((r) => ({
          url: r.url,
          method: r.method,
          type: r.type,
          statusCode: r.statusCode,
          requestHeaders: (r.requestHeaders || []).filter((h) => ["referer", "origin", "user-agent", "x-requested-with"].includes(h.name.toLowerCase())),
        }));
      }
    }
  }

  const systemInstruction = `You are the Aggregator Plugin AI Agent.
Analyze recorded network traffic from "${domain}" and synthesize a production-ready Aggregator JavaScript media provider plugin.

ARCHITECTURAL SPECIFICATION:
The plugin must export an object conforming exactly to this specification:
const plugin = {
  id: "${sanitizedId}",
  name: "${titleName}",
  baseUrl: "https://${domain}",
  version: "1.0.0",

  async getHome() {
    return [{ id: "...", title: "...", coverUrl: "...", url: "..." }];
  },

  async search(query) {
    return [{ id: "...", title: "...", coverUrl: "...", url: "..." }];
  },

  async getEpisodes(mediaId) {
    return [{ id: "...", number: 1, title: "...", url: "..." }];
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
globalThis.AggregatorPlugins["${sanitizedId}"] = plugin;
if (typeof module !== "undefined") module.exports = plugin;
export default plugin;

CORE IMPLEMENTATION RULES:
1. Environment: Runs inside modern WebExtension/browser environments with full cross-origin fetch() privileges.
2. DOM & Regex: Use new DOMParser().parseFromString(html, "text/html") or robust regular expressions.
3. Null Safety: Never access properties of null/undefined matches (always check if (match) before accessing match[1]).
4. Relative URLs: Always prepend this.baseUrl when extracted links start with "/".
5. Decoding: Clean up HTML entities in titles.
6. Clean JSON: Parse JSON responses safely with try/catch.
7. Dependencies: Do NOT import external npm packages. Use native browser APIs only.
8. Video Stream Extraction & Background Tab Sniffing Scheme:
- Video streaming in Aggregator strictly relies on direct stream manifests/files (HLS .m3u8, MPEG-DASH .mpd, or direct MP4/WebM).
- Video sites typically protect or dynamically generate media URLs inside embedded player scripts or iframes. For streaming, use the WebExtension background tab sniffing API inside getStreams(episodeId):
  const browserAPI = globalThis.browser || globalThis.chrome;
  if (browserAPI?.runtime?.sendMessage) {
    const res = await browserAPI.runtime.sendMessage({ action: "STREAM_BACKGROUND_TAB", url: watchUrl });
    if (res?.status === "FOUND" && res.url) return [{ quality: "Auto", url: res.url, type: "sub" }];
  }
- Alternatively, if a direct deterministic stream API exists (e.g. direct DASH manifest or clean HLS API endpoint), you may return direct streams.
- NEVER return web page embeds, iframe player links, or fake embed URLs (e.g. embed.php, player.html, megavid.buzz/embed).
- The 'quality' field must represent ONLY clean video resolution ('1080p', '720p', '480p', '360p', 'Auto', 'Default').
- The 'type' field should indicate audio language: 'sub' or 'dub' (default 'sub').

CONVERSATION & PROBING PROTOCOL:
You are allowed only TWO response formats:

Format A - Send a live cURL probe command to test endpoints or inspect live HTML/API responses:
STARTOFCURL
curl -X GET "https://${domain}/api/..." -H "User-Agent: Mozilla/5.0..."
ENDOFCURL

Format B - Send the completed JavaScript plugin code:
STARTOFPLUGIN
________________
<complete raw javascript code>
________________
ENDOFPLUGIN`;

  const initialUserPrompt = `${systemInstruction}\n\nCaptured Traces for ${domain}:\n${JSON.stringify(phaseSummaries, null, 2)}\n\nBegin investigation. Issue a probe command or return the completed plugin.`;

  const conversationHistory = [
    {
      role: "user",
      parts: [
        {
          text: initialUserPrompt,
        },
      ],
    },
  ];

  let activeInteractionId = "";
  let latestTurnInput = initialUserPrompt;
  let loopTurn = 0;
  const maxTurns = 35;

  while (loopTurn < maxTurns) {
    if (!isLoopRunning) break;
    loopTurn++;
    let candidateResponse = "";

    while (activeModelIndex < candidateModels.length) {
      if (!isLoopRunning) break;
      const currentModel = candidateModels[activeModelIndex];
      appendLog("out", `Turn ${loopTurn}: Sending context to ${currentModel}...`);
      genStatus.textContent = `Turn ${loopTurn} (${currentModel}): Synthesizing...`;

      let currentPrompt = "";
      if (conversationHistory.length === 1) {
        currentPrompt = conversationHistory[0].parts[0].text;
      } else {
        currentPrompt = conversationHistory
          .map((h) => `${h.role === "user" ? "USER" : "MODEL"}:\n${h.parts[0].text}`)
          .join("\n\n---\n\n");
      }

      const callResult = await callGeminiApi({
        model: currentModel,
        prompt: currentPrompt,
        latestTurnInput,
        previousInteractionId: activeInteractionId,
        conversationHistory,
        effectiveToken,
        isBearer,
        signal: currentAbortController ? currentAbortController.signal : undefined,
      });

      if (!isLoopRunning) break;

      if (callResult.ok) {
        candidateResponse = callResult.text;
        activeInteractionId = unsupportedChainingModels.has(currentModel)
          ? ""
          : (callResult.interactionId || "");
        break;
      }

      const nextIndex = activeModelIndex + 1;
      activeInteractionId = "";
      if (nextIndex < candidateModels.length) {
        const nextModel = candidateModels[nextIndex];
        const errSnippet = (callResult.error || "").substring(0, 100).replace(/\s+/g, " ");
        appendLog("out", `Model ${currentModel} failed (HTTP ${callResult.status}${errSnippet ? ": " + errSnippet : ""}). Degrading to ${nextModel}...`);
        activeModelIndex = nextIndex;
        continue;
      } else {
        appendLog("err", `All candidate models exhausted. Last error on ${currentModel}: HTTP ${callResult.status}: ${callResult.error?.substring(0, 120)}`);
        break;
      }
    }

    if (!isLoopRunning) break;

    if (!candidateResponse) {
      appendLog("err", "Failed to retrieve candidate response from Gemini model chain.");
      break;
    }

    conversationHistory.push({
      role: "model",
      parts: [{ text: candidateResponse }],
    });

    const hasPluginDelimiters = candidateResponse.includes("STARTOFPLUGIN") && candidateResponse.includes("ENDOFPLUGIN");
    const hasPluginCode = candidateResponse.includes("const plugin =") || candidateResponse.includes("globalThis.AggregatorPlugins");

    if (hasPluginDelimiters || hasPluginCode) {
      appendLog("sys", "Detected synthesized plugin block. Running verification test suite...");

      let rawCode = "";
      const underscoreMatch = candidateResponse.match(/________________([\s\S]*?)________________/);
      if (underscoreMatch) {
        rawCode = underscoreMatch[1];
      } else if (hasPluginDelimiters) {
        const startIdx = candidateResponse.indexOf("STARTOFPLUGIN") + "STARTOFPLUGIN".length;
        const endIdx = candidateResponse.indexOf("ENDOFPLUGIN");
        rawCode = candidateResponse.substring(startIdx, endIdx);
      } else {
        const codeBlockMatch = candidateResponse.match(/```(?:javascript|js)?([\s\S]*?)```/i);
        if (codeBlockMatch) {
          rawCode = codeBlockMatch[1];
        } else {
          rawCode = candidateResponse;
        }
      }

      rawCode = rawCode.replace(new RegExp("^```[a-z]*\\s*", "i"), "").replace(new RegExp("```$"), "").trim();

      testResult.classList.remove("hidden");
      testResult.textContent = "Testing plugin methods & monitoring network calls...";
      testResult.style.color = "#facc15";

      const suiteReport = await runPluginTestSuite(rawCode, domain, recordingData);

      if (suiteReport.passed) {
        codeOutput.value = rawCode;
        codePanel.classList.remove("hidden");
        btnSaveCode.classList.remove("hidden");
        btnPublishCode.classList.remove("hidden");

        appendLog("resp", `All 6/6 tests PASSED! Plugin verified (${rawCode.length} bytes).`);
        genStatus.textContent = "Status: Verified & Ready";
        testResult.textContent = `PASS: All 6 test cases passed for "${domain}"!`;
        testResult.style.color = "#a7f3d0";

        appendLog("sys", `Automatically submitting "${sanitizedId}" to backend...`);
        publishPluginToEdge();
        break;
      } else {
        appendLog("err", `Test suite FAILED (${suiteReport.passedCount}/${suiteReport.totalTests} tests passed).`);
        testResult.textContent = `FAILED: ${suiteReport.failedTests.length} tests failed (${suiteReport.passedCount}/6 passed)`;
        testResult.style.color = "#fca5a5";

        let failurePrompt = `TEST SUITE EXECUTION FAILED (${suiteReport.passedCount}/${suiteReport.totalTests} passed):
The plugin you generated failed verification checks. Fix all failed tests and stack traces:

${suiteReport.failedTests.map((f, idx) => `${idx + 1}. [FAILED] Test: ${f.test}
   Error: ${f.error}
   Stack Trace:
   ${f.stack}
   Expected: ${f.expected}
   Actual: ${f.actual}`).join("\n\n")}`;

        if (suiteReport.httpErrors.length > 0) {
          failurePrompt += `\n\nNON-200 HTTP RESPONSES CAUSED BY PLUGIN CALLS:
${suiteReport.httpErrors.map((h, idx) => `${idx + 1}. [HTTP ${h.status} ${h.statusText}] ${h.method} ${h.url}
   Body snippet: ${h.body}`).join("\n")}`;
        }

        failurePrompt += `\n\nPlease fix the errors above. Ensure robust parsing, proper regex matching, null checking, and correct API endpoints/headers.
Return the corrected plugin:
STARTOFPLUGIN
________________
<javascript code>
________________
ENDOFPLUGIN`;

        appendLog("sys", "Reprompting Gemini with test failures, stack traces, and HTTP error traces...");
        latestTurnInput = failurePrompt;
        conversationHistory.push({
          role: "user",
          parts: [{ text: failurePrompt }],
        });
        continue;
      }
    }

    let probeCmd = null;
    let isCurl = false;

    if (candidateResponse.includes("STARTOFCURL") && candidateResponse.includes("ENDOFCURL")) {
      const startIdx = candidateResponse.indexOf("STARTOFCURL") + "STARTOFCURL".length;
      const endIdx = candidateResponse.indexOf("ENDOFCURL");
      probeCmd = candidateResponse.substring(startIdx, endIdx).trim();
      isCurl = true;
    } else if (candidateResponse.includes("STARTOFPROBE") && candidateResponse.includes("ENDOFPROBE")) {
      const startIdx = candidateResponse.indexOf("STARTOFPROBE") + "STARTOFPROBE".length;
      const endIdx = candidateResponse.indexOf("ENDOFPROBE");
      probeCmd = candidateResponse.substring(startIdx, endIdx).trim();
      isCurl = false;
    } else if (candidateResponse.includes("curl ") || candidateResponse.includes("curl -")) {
      const curlMatch = candidateResponse.match(/curl\s+[^\n`]+/);
      if (curlMatch) {
        probeCmd = curlMatch[0].trim();
        isCurl = true;
      }
    }

    if (probeCmd) {
      appendLog("probe", `LLM requested probe: ${probeCmd.substring(0, 100)}`);

      const probe = isCurl ? parseCurlCommand(probeCmd) : parseProbeBlock(probeCmd);
      appendLog("sys", `Executing ${probe.method} ${probe.url}...`);

      const result = await executeProbeRequest(probe);
      appendLog("resp", `Probe returned HTTP ${result.status} ${result.statusText} (${result.totalLength} bytes).`);

      const observation = `PROBE_RESULT:
STATUS: ${result.status} ${result.statusText}
CONTENT-TYPE: ${result.contentType}
BODY:
${result.body}

Continue analysis. Either issue another probe (STARTOFCURL ... ENDOFCURL) or finalize the plugin:
STARTOFPLUGIN
________________
<javascript code>
________________
ENDOFPLUGIN`;

      latestTurnInput = observation;
      conversationHistory.push({
        role: "user",
        parts: [{ text: observation }],
      });
    } else {
      appendLog("out", "Prompting model to adhere to probe or plugin protocol...");
      const reminder = `Your response did not include a probe command (STARTOFCURL ... ENDOFCURL) or a plugin (STARTOFPLUGIN ... ENDOFPLUGIN).
Please respond using one of the required formats:
Format A:
STARTOFCURL
curl -X GET "https://${domain}/..."
ENDOFCURL

Format B:
STARTOFPLUGIN
________________
<javascript code>
________________
ENDOFPLUGIN`;
      latestTurnInput = reminder;
      conversationHistory.push({
        role: "user",
        parts: [{ text: reminder }],
      });
    }
  }

  if (loopTurn >= maxTurns && !codeOutput.value && isLoopRunning) {
    appendLog("err", "Reached maximum conversational probing limit without final plugin.");
    const scaffold = generateLocalScaffold(sanitizedId, titleName, domain, recordingData);
    codeOutput.value = scaffold;
    codePanel.classList.remove("hidden");
    btnSaveCode.classList.remove("hidden");
    btnPublishCode.classList.remove("hidden");
  }

  btnRunLoop.disabled = false;
  btnRunLoop.textContent = "Generate";
  btnRunLoop.classList.remove("hidden");
  btnCancel.classList.add("hidden");
  isLoopRunning = false;
  currentAbortController = null;
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
    try {
      const res = await fetch(url, init);
      const body = await res.text();
      const headers = {};
      res.headers.forEach((val, key) => {
        headers[key] = val;
      });

      if (!res.ok) {
        recordedHttpErrors.push({
          url,
          method: init?.method || "GET",
          status: res.status,
          statusText: res.statusText,
          body: body.substring(0, 300).replace(/\s+/g, " ").trim(),
        });
      }

      const frame = document.querySelector("#sandbox-frame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(
          {
            action: "PROXY_FETCH_RESPONSE",
            reqId,
            status: res.status,
            statusText: res.statusText,
            ok: res.ok,
            headers,
            body,
          },
          "*"
        );
      }
    } catch (err) {
      recordedHttpErrors.push({
        url,
        method: init?.method || "GET",
        status: 500,
        statusText: "Fetch Error",
        body: err.message,
      });

      const frame = document.querySelector("#sandbox-frame");
      if (frame && frame.contentWindow) {
        frame.contentWindow.postMessage(
          {
            action: "PROXY_FETCH_RESPONSE",
            reqId,
            status: 500,
            statusText: "Fetch Error",
            ok: false,
            headers: {},
            body: err.message,
          },
          "*"
        );
      }
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
  appendLog("resp", `Plugin "${sanitizedId}" saved to local extension storage.`);
  btnSaveCode.textContent = "Saved Locally ✓";
  setTimeout(() => {
    btnSaveCode.textContent = "Save Locally";
  }, 2000);
}

async function publishPluginToEdge() {
  const code = codeOutput.value.trim();
  if (!code) return;

  btnPublishCode.disabled = true;
  btnPublishCode.textContent = "Publishing...";

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
    const res = await fetch(`${registryUrl}/api/v1/plugins`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      appendLog("resp", `Successfully published "${sanitizedId}" to Edge & Git!`);
      btnPublishCode.textContent = "Published ✓";
      await savePluginLocally();
    } else {
      appendLog("err", `Publish failed: HTTP ${res.status}`);
      btnPublishCode.textContent = "Publish to Edge";
      btnPublishCode.disabled = false;
    }
  } catch (err) {
    appendLog("err", `Publish network error: ${err.message}`);
    btnPublishCode.textContent = "Publish to Edge";
    btnPublishCode.disabled = false;
  }
}

if (btnRunLoop) btnRunLoop.addEventListener("click", runAiGenerationLoop);
if (btnCancel) btnCancel.addEventListener("click", cancelAiGenerationLoop);
if (btnSaveCode) btnSaveCode.addEventListener("click", savePluginLocally);
if (btnPublishCode) btnPublishCode.addEventListener("click", publishPluginToEdge);
if (btnClose) btnClose.addEventListener("click", () => window.close());

init();
