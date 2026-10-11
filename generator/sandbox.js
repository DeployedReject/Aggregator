let lastFetchInfo = null;

globalThis.fetch = async function (url, options) {
  const reqId = "fetch_" + Math.random().toString(36).substring(2);
  const normalizedUrl = typeof url === "string" ? url : (url?.url || "");
  const normalizedInit = {
    method: options?.method || "GET",
    headers: options?.headers || {},
    body: options?.body,
  };

  return new Promise((resolve) => {
    function handleResponse(event) {
      if (event.data?.action === "PROXY_FETCH_RESPONSE" && event.data.reqId === reqId) {
        window.removeEventListener("message", handleResponse);
        const { status, statusText, ok, headers, body } = event.data;
        lastFetchInfo = {
          url: normalizedUrl,
          method: normalizedInit.method,
          status,
          statusText,
          ok,
          bodySnippet: typeof body === "string" ? body.substring(0, 1000).replace(/\s+/g, " ").trim() : "",
        };
        resolve({
          status,
          statusText,
          ok,
          headers: new Headers(headers || {}),
          async text() {
            return body || "";
          },
          async json() {
            try {
              return JSON.parse(body || "{}");
            } catch (e) {
              return {};
            }
          },
        });
      }
    }
    window.addEventListener("message", handleResponse);
    window.parent.postMessage(
      {
        action: "PROXY_FETCH",
        reqId,
        url: normalizedUrl,
        init: normalizedInit,
      },
      "*"
    );
  });
};

const browserMock = {
  runtime: {
    async sendMessage(msg) {
      const reqId = "msg_" + Math.random().toString(36).substring(2);
      return new Promise((resolve) => {
        function handleResponse(event) {
          if (event.data?.action === "PROXY_MESSAGE_RESPONSE" && event.data.reqId === reqId) {
            window.removeEventListener("message", handleResponse);
            resolve(event.data.response);
          }
        }
        window.addEventListener("message", handleResponse);
        window.parent.postMessage(
          {
            action: "PROXY_MESSAGE",
            reqId,
            message: msg,
          },
          "*"
        );
      });
    },
  },
};
globalThis.browser = browserMock;
globalThis.chrome = browserMock;

function sanitizePluginExecutableCode(raw) {
  if (!raw) return "";
  let code = raw;
  code = code.replace(/<think>[\s\S]*?<\/think>/gi, "");
  code = code.replace(/<thought>[\s\S]*?<\/thought>/gi, "");
  code = code.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  code = code.replace(/<\/?(?:think|thought|reasoning|scratchpad|output|code)>/gi, "");
  code = code.replace(/<(?:\w+\s+)*(?:code|javascript|plugin|script|source)>/gi, "");
  code = code.replace(/_{3,}/g, "");

  // If code is wrapped in markdown code blocks, extract inner content
  const codeBlockMatch = code.match(/```(?:javascript|js)?([\s\S]*?)```/i);
  if (codeBlockMatch) {
    code = codeBlockMatch[1];
  } else {
    code = code.replace(/^```[a-z]*\s*/gim, "").replace(/```\s*$/gim, "");
  }

  // Preserve all helper functions and variables before export default
  return code
    .replace(/\bexport\s+default\s+([a-zA-Z0-9_$]+)\s*;?/g, "module.exports = $1; module.exports.default = $1;")
    .replace(/\bexport\s+default\s+/g, "module.exports = module.exports.default = ")
    .replace(/\bexport\s+(const|let|var|function|class)\s+/g, "$1 ");
}

function isInvalidTitle(title) {
  if (!title || typeof title !== "string") return true;
  const t = title.trim().toLowerCase();
  return t === "" || t === "[object object]" || t === "unknown" || t === "unknown title" || t === "null" || t === "undefined";
}

function validateMediaItem(item, contextName) {
  if (!item || typeof item !== "object") {
    throw new Error(`${contextName} returned a non-object item: ${JSON.stringify(item)}`);
  }
  if (!item.id && item.id !== 0) {
    throw new Error(`${contextName} item missing required 'id' field. Item: ${JSON.stringify(item)}`);
  }
  if (typeof item.title !== "string" || isInvalidTitle(item.title)) {
    throw new Error(
      `${contextName} item has invalid or dummy title (${JSON.stringify(item.title)}). If the source returns nested title objects (such as { english, romaji, userPreferred }), extract the string via: item.title?.english || item.title?.romaji || item.title?.userPreferred || item.title?.native || item.name || 'Untitled'. Item: ${JSON.stringify(item)}`
    );
  }
}

async function runPluginTestSuite(code, targetDomain) {
  const report = {
    passed: false,
    passedCount: 0,
    totalTests: 6,
    failedTests: [],
    logs: [],
    runtimeAuditSnapshot: {
      getHome: null,
      search: null,
      getEpisodes: null,
      getStreams: null,
      warnings: [],
    },
  };

  function log(type, msg) {
    report.logs.push({ type, msg });
  }

  let plugin = null;
  let sampleMediaItem = null;
  let sampleEpisodeItem = null;

  try {
    try {
      const executableCode = sanitizePluginExecutableCode(code);
      const fn = new Function("module", "exports", executableCode);
      const mockModule = { exports: {} };
      fn(mockModule, mockModule.exports);
      const sanitizedId = targetDomain.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      plugin = mockModule.exports.id
        ? mockModule.exports
        : (mockModule.exports.default || globalThis.AggregatorPlugins?.[sanitizedId]);

      if (!plugin || typeof plugin !== "object") {
        throw new Error("Plugin script did not export an object via module.exports or export default.");
      }
      report.passedCount++;
      log("resp", "\x1b[32m✓\x1b[0m Test 1/6: Syntax & Module Instantiation PASSED.");
    } catch (err) {
      report.failedTests.push({
        test: "Syntax & Module Instantiation",
        error: err.message,
        stack: err.stack || err.message,
        expected: "Plugin compiles and exports an object via module.exports or export default",
        actual: `Threw error: ${err.message}`,
      });
      log("err", `\x1b[31m✗\x1b[0m Test 1/6 FAILED: ${err.message}`);
    }

    if (plugin) {
      const missing = [];
      if (typeof plugin.id !== "string" || !plugin.id) missing.push("id (string)");
      if (typeof plugin.name !== "string" || !plugin.name) missing.push("name (string)");
      if (typeof plugin.baseUrl !== "string" || !plugin.baseUrl.startsWith("http")) missing.push("baseUrl (valid URL)");
      if (typeof plugin.search !== "function") missing.push("search (async function)");
      if (typeof plugin.getHome !== "function") missing.push("getHome (async function)");
      if (typeof plugin.getEpisodes !== "function") missing.push("getEpisodes (async function)");
      if (typeof plugin.getStreams !== "function") missing.push("getStreams (async function)");

      if (missing.length === 0) {
        report.passedCount++;
        log("resp", "\x1b[32m✓\x1b[0m Test 2/6: Schema & Interface Compliance PASSED.");
      } else {
        report.failedTests.push({
          test: "Schema & Interface Compliance",
          error: `Missing or invalid required properties: ${missing.join(", ")}`,
          stack: `SchemaError: Missing or invalid required properties: ${missing.join(", ")}`,
          expected: "id, name, baseUrl, search(), getHome(), getEpisodes(), getStreams()",
          actual: `Missing: ${missing.join(", ")}`,
        });
        log("err", `\x1b[31m✗\x1b[0m Test 2/6 FAILED: Missing ${missing.join(", ")}`);
      }
    }

    function isInvalidTitle(title) {
      if (!title || typeof title !== "string") return true;
      const t = title.trim().toLowerCase();
      return t === "" || t === "[object object]" || t === "unknown" || t === "unknown title" || t === "null" || t === "undefined";
    }

    function validateMediaItem(item, contextName) {
      if (!item || typeof item !== "object") {
        throw new Error(`${contextName} returned a non-object item: ${JSON.stringify(item)}`);
      }
      if (!item.id && item.id !== 0) {
        throw new Error(`${contextName} item missing required 'id' field. Item: ${JSON.stringify(item)}`);
      }
      if (typeof item.title !== "string" || isInvalidTitle(item.title)) {
        throw new Error(
          `${contextName} item has invalid or dummy title (${JSON.stringify(item.title)}). If the source returns nested title objects (such as { english, romaji, userPreferred }), extract the string via: item.title?.english || item.title?.romaji || item.title?.userPreferred || item.title?.native || item.name || 'Untitled'. Item: ${JSON.stringify(item)}`
        );
      }
      if (item.coverUrl && typeof item.coverUrl === "string" && item.coverUrl.startsWith("/")) {
        report.runtimeAuditSnapshot.warnings.push(
          `${contextName} item "${item.title}" has a relative coverUrl ("${item.coverUrl}"). Prepend this.baseUrl to make it absolute.`
        );
      }
    }

    if (plugin && typeof plugin.getHome === "function") {
      try {
        log("sys", "Test 3/6: Executing getHome()...");
        const homePromise = plugin.getHome();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("getHome() timed out after 15000ms")), 15000));
        const items = await Promise.race([homePromise, timeoutPromise]);

        if (!Array.isArray(items) || items.length === 0) {
          throw new Error(`getHome() must return a non-empty Array of media items, received: ${Array.isArray(items) ? "0 items" : typeof items}`);
        }
        for (let i = 0; i < Math.min(items.length, 5); i++) {
          validateMediaItem(items[i], `getHome()[${i}]`);
        }
        sampleMediaItem = items[0];
        report.runtimeAuditSnapshot.getHome = items.slice(0, 3);
        report.passedCount++;
        log("resp", `\x1b[32m✓\x1b[0m Test 3/6: getHome() PASSED (${items.length} valid items returned).`);
      } catch (err) {
        report.failedTests.push({
          test: "getHome()",
          error: err.message,
          stack: err.stack || err.message,
          expected: "Non-empty Array of items: [{ id: string, title: string, coverUrl?: string, url?: string }]",
          actual: `Error: ${err.message}`,
        });
        log("err", `\x1b[31m✗\x1b[0m Test 3/6 FAILED: ${err.message}`);
      }
    }

    let searchSampleItem = null;
    if (plugin && typeof plugin.search === "function") {
      try {
        log("sys", "Test 4/6: Executing search('One Piece')...");
        const searchPromise = plugin.search("One Piece");
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("search() timed out after 15000ms")), 15000));
        const results = await Promise.race([searchPromise, timeoutPromise]);

        if (!Array.isArray(results) || results.length === 0) {
          throw new Error(`search('One Piece') must return a non-empty Array of matching media items, received: ${Array.isArray(results) ? "0 items" : typeof results}`);
        }
        for (let i = 0; i < Math.min(results.length, 5); i++) {
          validateMediaItem(results[i], `search()[${i}]`);
        }
        searchSampleItem = results[0];
        if (!sampleMediaItem) sampleMediaItem = results[0];
        report.runtimeAuditSnapshot.search = results.slice(0, 3);
        report.passedCount++;
        log("resp", `\x1b[32m✓\x1b[0m Test 4/6: search('One Piece') PASSED (${results.length} valid items returned).`);
      } catch (err) {
        report.failedTests.push({
          test: "search('One Piece')",
          error: err.message,
          stack: err.stack || err.message,
          expected: "Non-empty Array of items: [{ id: string, title: string, coverUrl?: string, url?: string }]",
          actual: `Error: ${err.message}`,
        });
        log("err", `\x1b[31m✗\x1b[0m Test 4/6 FAILED: ${err.message}`);
      }
    }

    if (plugin && typeof plugin.getEpisodes === "function") {
      const candidatesToTry = [
        sampleMediaItem?.id,
        sampleMediaItem?.url,
        searchSampleItem?.id,
        searchSampleItem?.url,
        `https://${targetDomain}`,
      ].filter(Boolean);

      let epSuccess = false;
      let lastEpError = null;

      for (const mediaIdToTest of candidatesToTry) {
        try {
          log("sys", `Test 5/6: Executing getEpisodes("${mediaIdToTest}")...`);
          const epPromise = plugin.getEpisodes(mediaIdToTest);
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`getEpisodes("${mediaIdToTest}") timed out after 15000ms`)), 15000));
          const episodes = await Promise.race([epPromise, timeoutPromise]);

          if (!Array.isArray(episodes) || episodes.length === 0) {
            throw new Error(`getEpisodes("${mediaIdToTest}") returned ${Array.isArray(episodes) ? "0 episodes" : typeof episodes}`);
          }
          if ((sampleMediaItem?.title || "").toLowerCase().includes("one piece") && episodes.length <= 1) {
            throw new Error(`getEpisodes("${mediaIdToTest}") returned only 1 episode for One Piece. Expected full episode list (> 1000 episodes) from item.episode_counts.sub.`);
          }
          for (let i = 0; i < episodes.length; i++) {
            const ep = episodes[i];
            if (!ep || typeof ep !== "object") {
              throw new Error(`Episode at index ${i} is not an object`);
            }
            if (ep.id === undefined || ep.id === null || ep.id === "") {
              throw new Error(`Episode at index ${i} missing required 'id' field. Episode: ${JSON.stringify(ep)}`);
            }
            if (typeof ep.number !== "number" || isNaN(ep.number)) {
              throw new Error(`Episode at index ${i} has invalid 'number' (${JSON.stringify(ep.number)}). Must be an integer number (1, 2, ...).`);
            }
            if (ep.title && (typeof ep.title !== "string" || ep.title.includes("[object Object]"))) {
              throw new Error(`Episode at index ${i} has invalid title string: ${JSON.stringify(ep.title)}`);
            }
          }
          sampleEpisodeItem = episodes[0];
          report.runtimeAuditSnapshot.getEpisodes = {
            count: episodes.length,
            sample: episodes.slice(0, 3),
          };
          epSuccess = true;
          report.passedCount++;
          log("resp", `\x1b[32m✓\x1b[0m Test 5/6: getEpisodes() PASSED (${episodes.length} episodes returned).`);
          break;
        } catch (err) {
          lastEpError = err;
        }
      }

      if (!epSuccess) {
        report.failedTests.push({
          test: "getEpisodes(mediaId)",
          error: lastEpError?.message || "Failed to fetch episodes",
          stack: lastEpError?.stack || lastEpError?.message || "",
          expected: "Non-empty Array of episodes: [{ id: string, number: number, title?: string, url?: string }]",
          actual: `Error: ${lastEpError?.message}`,
        });
        log("err", `\x1b[31m✗\x1b[0m Test 5/6 FAILED: ${lastEpError?.message}`);
      }
    }

    if (plugin && typeof plugin.getStreams === "function") {
      const epCandidates = [
        sampleEpisodeItem?.id,
        sampleEpisodeItem?.url,
        sampleMediaItem?.id ? `${sampleMediaItem.id}?ep=1` : null,
        searchSampleItem?.id ? `${searchSampleItem.id}?ep=1` : null,
        "1",
        "sample-episode-1",
      ].filter(Boolean);

      let streamSuccess = false;
      let lastStreamError = null;

      for (const episodeIdToTest of epCandidates) {
        try {
          log("sys", `Test 6/6: Executing getStreams("${episodeIdToTest}")...`);
          const streamPromise = plugin.getStreams(episodeIdToTest);
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`getStreams("${episodeIdToTest}") timed out after 25000ms`)), 25000));
          const streams = await Promise.race([streamPromise, timeoutPromise]);

          if (!Array.isArray(streams) || streams.length === 0) {
            throw new Error(`getStreams("${episodeIdToTest}") returned ${Array.isArray(streams) ? "0 streams" : typeof streams}`);
          }
          for (let i = 0; i < streams.length; i++) {
            const s = streams[i];
            if (!s || typeof s !== "object") {
              throw new Error(`Stream at index ${i} is not an object.`);
            }
            if (!s.url || typeof s.url !== "string") {
              throw new Error(`Stream at index ${i} missing valid 'url' string. Received: ${JSON.stringify(s)}`);
            }
            const u = s.url.toLowerCase();
            if (
              !u.includes(".m3u8") &&
              !u.includes(".mpd") &&
              !u.includes(".mp4") &&
              !u.includes(".webm") &&
              (u.includes("embed.php") || u.includes("/player/?") || u.includes("/embed/"))
            ) {
              throw new Error(`Stream at index ${i} returned an iframe/embed page (${s.url}). Plugins must return direct stream manifests (.m3u8, .mpd, .mp4) or use background tab sniffing.`);
            }
            if (s.subtitles && Array.isArray(s.subtitles)) {
              for (const sub of s.subtitles) {
                if (!sub || typeof sub.file !== "string" || !sub.file) {
                  throw new Error(`Invalid subtitle object in stream: ${JSON.stringify(sub)}. Expected { file: string, label: string }.`);
                }
              }
            }
            if (s.headers && (typeof s.headers !== "object" || Array.isArray(s.headers))) {
              throw new Error(`Stream 'headers' must be a key-value object (e.g. { Referer: '...' }).`);
            }
          }
          report.runtimeAuditSnapshot.getStreams = streams.slice(0, 2);
          streamSuccess = true;
          report.passedCount++;
          log("resp", `\x1b[32m✓\x1b[0m Test 6/6: getStreams() PASSED (${streams.length} stream sources returned).`);
          break;
        } catch (err) {
          lastStreamError = err;
        }
      }

      if (!streamSuccess) {
        report.failedTests.push({
          test: "getStreams(episodeId)",
          error: lastStreamError?.message || "Failed to fetch streams",
          stack: lastStreamError?.stack || lastStreamError?.message || "",
          expected: "Array of stream sources: [{ url: string, quality?: string, type?: 'sub'|'dub', subtitles?: [{ file, label }], headers?: { Referer, Origin } }]",
          actual: `Error: ${lastStreamError?.message}`,
        });
        log("err", `\x1b[31m✗\x1b[0m Test 6/6 FAILED: ${lastStreamError?.message}`);
      }
    }
  } finally {
    report.passed = report.failedTests.length === 0;
  }

  return report;
}

const activeSandboxPlugins = new Map();

window.addEventListener("message", async (event) => {
  if (!event.data) return;

  if (event.data.action === "PING_SANDBOX") {
    window.parent.postMessage({ action: "SANDBOX_READY" }, "*");
  } else if (event.data.action === "RUN_TEST_SUITE") {
    const { code, targetDomain } = event.data;
    const report = await runPluginTestSuite(code, targetDomain);
    window.parent.postMessage(
      {
        action: "TEST_SUITE_RESULT",
        report,
      },
      "*"
    );
  } else if (event.data.action === "REGISTER_PLUGIN") {
    const { pluginId, code } = event.data;
    try {
      const executableCode = sanitizePluginExecutableCode(code);
      const fn = new Function("module", "exports", executableCode);
      const mockModule = { exports: {} };
      fn(mockModule, mockModule.exports);
      const plugin = mockModule.exports.id
        ? mockModule.exports
        : (mockModule.exports.default || mockModule.exports);

      if (plugin && typeof plugin.id === "string") {
        activeSandboxPlugins.set(plugin.id, plugin);
        window.parent.postMessage(
          {
            action: "PLUGIN_REGISTERED",
            pluginId: plugin.id,
            success: true,
            meta: {
              id: plugin.id,
              name: plugin.name || plugin.id,
              baseUrl: plugin.baseUrl || "",
              version: plugin.version || "1.0.0",
              hasHome: typeof plugin.getHome === "function",
            },
          },
          "*"
        );
      } else {
        window.parent.postMessage(
          {
            action: "PLUGIN_REGISTERED",
            pluginId,
            success: false,
            error: "Plugin did not export a valid plugin object",
          },
          "*"
        );
      }
    } catch (err) {
      window.parent.postMessage(
        {
          action: "PLUGIN_REGISTERED",
          pluginId,
          success: false,
          error: err.message,
        },
        "*"
      );
    }
  } else if (event.data.action === "EXECUTE_PLUGIN_METHOD") {
    const { reqId, pluginId, method, args } = event.data;
    const plugin = activeSandboxPlugins.get(pluginId);
    if (!plugin) {
      window.parent.postMessage(
        {
          action: "EXECUTE_PLUGIN_METHOD_RESPONSE",
          reqId,
          success: false,
          error: `Plugin ${pluginId} not found in sandbox`,
        },
        "*"
      );
      return;
    }
    if (typeof plugin[method] !== "function") {
      window.parent.postMessage(
        {
          action: "EXECUTE_PLUGIN_METHOD_RESPONSE",
          reqId,
          success: false,
          error: `Method ${method} not found on plugin ${pluginId}`,
        },
        "*"
      );
      return;
    }
    try {
      const result = await plugin[method](...(args || []));
      window.parent.postMessage(
        {
          action: "EXECUTE_PLUGIN_METHOD_RESPONSE",
          reqId,
          success: true,
          result,
        },
        "*"
      );
    } catch (err) {
      window.parent.postMessage(
        {
          action: "EXECUTE_PLUGIN_METHOD_RESPONSE",
          reqId,
          success: false,
          error: err.message,
        },
        "*"
      );
    }
  } else if (event.data.action === "RUN_METHOD_TEST") {
    const { reqId, method, code, args, baseUrl, targetDomain, helperCode } = event.data;
    try {
      const cleanMethod = (code || "").trim().replace(/;+\s*$/, "");
      let fullExecutable = `
        ${helperCode || ""}
        const targetObj = {
          baseUrl: ${JSON.stringify(baseUrl || `https://${targetDomain}`)},
          id: ${JSON.stringify(targetDomain ? targetDomain.replace(/[^a-z0-9]/gi, "_").toLowerCase() : "test_plugin")},
          name: "Test Plugin",
          ${cleanMethod}
        };
        module.exports = targetObj;
        module.exports.default = targetObj;
      `;
      const sanitized = sanitizePluginExecutableCode(fullExecutable);
      const fn = new Function("module", "exports", sanitized);
      const mockModule = { exports: {} };
      fn(mockModule, mockModule.exports);
      const inst = mockModule.exports.default || mockModule.exports;

      if (typeof inst[method] !== "function") {
        throw new Error(`Method "${method}" was not properly defined in the provided code.`);
      }

      const resultPromise = inst[method](...(args || []));
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Method "${method}" timed out after 12000ms`)), 12000));
      const res = await Promise.race([resultPromise, timeoutPromise]);

      const warnings = [];
      if (method === "search" || method === "getHome") {
        if (!Array.isArray(res) || res.length === 0) {
          throw new Error(`${method}() must return a non-empty Array of media items. Received: ${Array.isArray(res) ? "0 items" : typeof res}`);
        }
        for (let i = 0; i < Math.min(res.length, 5); i++) {
          validateMediaItem(res[i], `${method}()[${i}]`);
          if (res[i].coverUrl && typeof res[i].coverUrl === "string" && res[i].coverUrl.startsWith("/")) {
            warnings.push(`Item "${res[i].title}" has relative coverUrl ("${res[i].coverUrl}"). Prepend this.baseUrl.`);
          }
        }
      } else if (method === "getEpisodes") {
        if (!Array.isArray(res) || res.length === 0) {
          throw new Error(`getEpisodes() must return a non-empty Array of episodes. Received: ${Array.isArray(res) ? "0 episodes" : typeof res}`);
        }
        for (let i = 0; i < res.length; i++) {
          const ep = res[i];
          if (!ep || typeof ep !== "object") throw new Error(`Episode at index ${i} is not an object`);
          if (ep.id === undefined || ep.id === null || ep.id === "") throw new Error(`Episode at index ${i} missing required 'id'`);
          if (typeof ep.number !== "number" || isNaN(ep.number)) throw new Error(`Episode at index ${i} has invalid 'number'`);
        }
      } else if (method === "getStreams") {
        if (!Array.isArray(res) || res.length === 0) {
          throw new Error(`getStreams() must return a non-empty Array of stream sources. Received: ${Array.isArray(res) ? "0 streams" : typeof res}`);
        }
        for (let i = 0; i < res.length; i++) {
          const s = res[i];
          if (!s || typeof s !== "object" || !s.url) throw new Error(`Stream at index ${i} missing valid 'url'`);
        }
      }

      window.parent.postMessage({
        action: "RUN_METHOD_TEST_RESPONSE",
        reqId,
        success: true,
        result: res,
        warnings,
        lastFetch: lastFetchInfo,
      }, "*");
    } catch (err) {
      window.parent.postMessage({
        action: "RUN_METHOD_TEST_RESPONSE",
        reqId,
        success: false,
        error: err.message,
        stack: err.stack || err.message,
        lastFetch: lastFetchInfo,
      }, "*");
    }
  }
});

window.parent.postMessage({ action: "SANDBOX_READY" }, "*");
