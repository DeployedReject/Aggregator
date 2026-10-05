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

async function runPluginTestSuite(code, targetDomain) {
  const report = {
    passed: false,
    passedCount: 0,
    totalTests: 6,
    failedTests: [],
    logs: [],
  };

  function log(type, msg) {
    report.logs.push({ type, msg });
  }

  let plugin = null;
  let sampleMediaItem = null;
  let sampleEpisodeItem = null;

  try {
    try {
      const executableCode = code
        .replace(/\bexport\s+default\s+([a-zA-Z0-9_$]+)\s*;?/g, "module.exports = $1; module.exports.default = $1;")
        .replace(/\bexport\s+default\s+/g, "module.exports.default = ")
        .replace(/\bexport\s+(const|let|var|function|class)\s+/g, "$1 ");
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
      log("sys", "Test 1/6: Syntax & Module Instantiation PASSED.");
    } catch (err) {
      report.failedTests.push({
        test: "Syntax & Module Instantiation",
        error: err.message,
        stack: err.stack || err.message,
        expected: "Plugin compiles and exports an object via module.exports or export default",
        actual: `Threw error: ${err.message}`,
      });
      log("err", `Test 1/6 FAILED: ${err.message}`);
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
        log("sys", "Test 2/6: Schema & Interface Compliance PASSED.");
      } else {
        report.failedTests.push({
          test: "Schema & Interface Compliance",
          error: `Missing or invalid required properties: ${missing.join(", ")}`,
          stack: `SchemaError: Missing or invalid required properties: ${missing.join(", ")}`,
          expected: "id, name, baseUrl, search(), getHome(), getEpisodes(), getStreams()",
          actual: `Missing: ${missing.join(", ")}`,
        });
        log("err", `Test 2/6 FAILED: Missing ${missing.join(", ")}`);
      }
    }

    if (plugin && typeof plugin.getHome === "function") {
      try {
        log("sys", "Test 3/6: Executing getHome()...");
        const homePromise = plugin.getHome();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timed out after 10000ms")), 10000));
        const items = await Promise.race([homePromise, timeoutPromise]);

        if (!Array.isArray(items)) {
          throw new Error(`getHome() must return an Array, received: ${typeof items}`);
        }
        if (items.length > 0) {
          sampleMediaItem = items[0];
          const missingFields = ["id", "title"].filter((f) => !sampleMediaItem[f]);
          if (missingFields.length > 0) {
            throw new Error(`Items in getHome() missing required fields: ${missingFields.join(", ")}. Sample item: ${JSON.stringify(sampleMediaItem)}`);
          }
        }
        report.passedCount++;
        log("resp", `Test 3/6: getHome() PASSED (${items.length} items returned).`);
      } catch (err) {
        report.failedTests.push({
          test: "getHome()",
          error: err.message,
          stack: err.stack || err.message,
          expected: "Array of items: [{ id: string, title: string, coverUrl?: string, url?: string }]",
          actual: `Error: ${err.message}`,
        });
        log("err", `Test 3/6 FAILED: ${err.message}`);
      }
    }

    if (plugin && typeof plugin.search === "function") {
      try {
        log("sys", "Test 4/6: Executing search('a')...");
        const searchPromise = plugin.search("a");
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timed out after 10000ms")), 10000));
        const results = await Promise.race([searchPromise, timeoutPromise]);

        if (!Array.isArray(results)) {
          throw new Error(`search() must return an Array, received: ${typeof results}`);
        }
        if (results.length > 0 && !sampleMediaItem) {
          sampleMediaItem = results[0];
        }
        report.passedCount++;
        log("resp", `Test 4/6: search() PASSED (${results.length} results returned).`);
      } catch (err) {
        report.failedTests.push({
          test: "search(query)",
          error: err.message,
          stack: err.stack || err.message,
          expected: "Array of items: [{ id: string, title: string, coverUrl?: string, url?: string }]",
          actual: `Error: ${err.message}`,
        });
        log("err", `Test 4/6 FAILED: ${err.message}`);
      }
    }

    if (plugin && typeof plugin.getEpisodes === "function") {
      const mediaIdToTest = sampleMediaItem?.id || sampleMediaItem?.url || `https://${targetDomain}`;
      try {
        log("sys", `Test 5/6: Executing getEpisodes("${mediaIdToTest}")...`);
        const epPromise = plugin.getEpisodes(mediaIdToTest);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timed out after 10000ms")), 10000));
        const episodes = await Promise.race([epPromise, timeoutPromise]);

        if (!Array.isArray(episodes)) {
          throw new Error(`getEpisodes() must return an Array, received: ${typeof episodes}`);
        }
        if (episodes.length > 0) {
          sampleEpisodeItem = episodes[0];
          if (sampleEpisodeItem.id === undefined) {
            throw new Error(`Episodes returned by getEpisodes() missing required 'id' field. Sample: ${JSON.stringify(sampleEpisodeItem)}`);
          }
        }
        report.passedCount++;
        log("resp", `Test 5/6: getEpisodes() PASSED (${episodes.length} episodes returned).`);
      } catch (err) {
        report.failedTests.push({
          test: "getEpisodes(mediaId)",
          error: err.message,
          stack: err.stack || err.message,
          expected: "Array of episodes: [{ id: string, number: number, title?: string, url?: string }]",
          actual: `Error: ${err.message}`,
        });
        log("err", `Test 5/6 FAILED: ${err.message}`);
      }
    }

    if (plugin && typeof plugin.getStreams === "function") {
      const episodeIdToTest = sampleEpisodeItem?.id || sampleEpisodeItem?.url || `https://${targetDomain}`;
      try {
        log("sys", `Test 6/6: Executing getStreams("${episodeIdToTest}")...`);
        const streamPromise = plugin.getStreams(episodeIdToTest);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Execution timed out after 10000ms")), 10000));
        const streams = await Promise.race([streamPromise, timeoutPromise]);

        if (!Array.isArray(streams)) {
          throw new Error(`getStreams() must return an Array, received: ${typeof streams}`);
        }
        if (streams.length > 0) {
          const firstStream = streams[0];
          if (!firstStream || !firstStream.url) {
            throw new Error(`Streams in getStreams() must have 'url'. Received: ${JSON.stringify(firstStream)}`);
          }
          const u = firstStream.url.toLowerCase();
          if (
            !u.includes(".m3u8") &&
            !u.includes(".mpd") &&
            !u.includes(".mp4") &&
            !u.includes(".webm") &&
            (u.includes("embed.php") || u.includes("/player/?") || u.includes("/embed/"))
          ) {
            throw new Error(`getStreams() returned an iframe/embed page (${firstStream.url}). Plugins must use background tab sniffing or direct stream manifests (.m3u8, .mpd, .mp4).`);
          }
        }
        report.passedCount++;
        log("resp", `Test 6/6: getStreams() PASSED (${streams.length} stream sources returned).`);
      } catch (err) {
        report.failedTests.push({
          test: "getStreams(episodeId)",
          error: err.message,
          stack: err.stack || err.message,
          expected: "Array of stream sources: [{ url: string, quality?: string, type?: 'sub'|'dub' }]",
          actual: `Error: ${err.message}`,
        });
        log("err", `Test 6/6 FAILED: ${err.message}`);
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
      const executableCode = code
        .replace(/\bexport\s+default\s+([a-zA-Z0-9_$]+)\s*;?/g, "module.exports = $1; module.exports.default = $1;")
        .replace(/\bexport\s+default\s+/g, "module.exports.default = ")
        .replace(/\bexport\s+(const|let|var|function|class)\s+/g, "$1 ");
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
  }
});

window.parent.postMessage({ action: "SANDBOX_READY" }, "*");
