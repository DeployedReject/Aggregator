(() => {
  const browserAPI = globalThis.browser || globalThis.chrome;

  function isPotentialStream(details) {
    if (details.type === "media") return true;
    const u = details.url.toLowerCase();
    if (u.includes(".m3u8") || u.includes(".mpd") || u.includes(".mp4")) {
      return true;
    }
    if (details.type === "sub_frame" && (u.includes("embed") || u.includes("player"))) {
      return true;
    }
    return false;
  }

  function startSniffing(targetUrl, timeoutMs = 12000) {
    return new Promise((resolve) => {
      if (!targetUrl) {
        resolve({ status: "ERROR", error: "Missing target URL" });
        return;
      }

      browserAPI.tabs.create({ url: targetUrl, active: false }).then((bgTab) => {
        let resolved = false;
        const targetTabId = bgTab.id;

        function onBeforeRequest(details) {
          if (details.tabId !== targetTabId) return;

          if (isPotentialStream(details) && !resolved) {
            resolved = true;
            cleanup();
            resolve({ status: "FOUND", url: details.url });
          }
        }

        function cleanup() {
          browserAPI.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
          clearTimeout(timerId);
          browserAPI.tabs.remove(targetTabId).catch(() => {});
        }

        browserAPI.webRequest.onBeforeRequest.addListener(
          onBeforeRequest,
          { urls: ["<all_urls>"] }
        );

        const timerId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve({ status: "TIMEOUT" });
          }
        }, timeoutMs);
      });
    });
  }

  globalThis.Sniffer = {
    start: startSniffing,
    isPotentialStream,
  };
})();
