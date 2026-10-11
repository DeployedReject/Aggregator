(() => {
  const browserAPI = globalThis.browser || globalThis.chrome;

  function isStreamManifestOrMedia(details) {
    if (details.type === "media") return true;
    const u = details.url.toLowerCase();
    if (u.includes(".m3u8") || u.includes(".mpd") || u.includes(".mp4") || u.includes(".webm")) {
      return true;
    }
    if (
      (details.type === "xmlhttprequest" || details.type === "fetch" || details.type === "other") &&
      (u.includes("/hls/") ||
        u.includes("/playlist") ||
        u.includes("/manifest") ||
        u.includes("master.m3u8") ||
        u.includes("index.m3u8") ||
        u.includes("/source/"))
    ) {
      return true;
    }
    return false;
  }

  function isPotentialStream(details) {
    if (isStreamManifestOrMedia(details)) return true;
    const u = details.url.toLowerCase();
    if (details.type === "sub_frame" && (u.includes("embed") || u.includes("player") || u.includes("stream"))) {
      return true;
    }
    return false;
  }

  function startSniffing(targetUrl, timeoutMs = 15000) {
    return new Promise((resolve) => {
      if (!targetUrl) {
        resolve({ status: "ERROR", error: "Missing target URL" });
        return;
      }

      browserAPI.tabs.create({ url: targetUrl, active: false }).then((bgTab) => {
        let resolved = false;
        const targetTabId = bgTab.id;
        let capturedHeaders = {};
        let fallbackCandidateUrl = null;

        function onBeforeSendHeaders(details) {
          if (details.tabId !== targetTabId) return;
          if (details.requestHeaders && Array.isArray(details.requestHeaders)) {
            const useful = details.requestHeaders.filter((h) =>
              ["referer", "origin", "user-agent", "x-requested-with"].includes(h.name.toLowerCase())
            );
            if (useful.length > 0) {
              capturedHeaders = Object.fromEntries(useful.map((h) => [h.name, h.value]));
            }
          }
        }

        function onBeforeRequest(details) {
          if (details.tabId !== targetTabId) return;

          // If a direct media stream or manifest is detected, resolve immediately
          if (isStreamManifestOrMedia(details) && !resolved) {
            resolved = true;
            cleanup();
            resolve({
              status: "FOUND",
              url: details.url,
              headers: capturedHeaders,
            });
            return;
          }

          // Keep subframe/embed as candidate fallback if no direct stream is found
          if (isPotentialStream(details) && !fallbackCandidateUrl) {
            fallbackCandidateUrl = details.url;
          }
        }

        function cleanup() {
          browserAPI.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
          if (browserAPI.webRequest.onBeforeSendHeaders) {
            browserAPI.webRequest.onBeforeSendHeaders.removeListener(onBeforeSendHeaders);
          }
          clearTimeout(triggerTimer);
          clearTimeout(timerId);
          browserAPI.tabs.remove(targetTabId).catch(() => {});
        }

        browserAPI.webRequest.onBeforeRequest.addListener(
          onBeforeRequest,
          { urls: ["<all_urls>"] }
        );

        if (browserAPI.webRequest.onBeforeSendHeaders) {
          browserAPI.webRequest.onBeforeSendHeaders.addListener(
            onBeforeSendHeaders,
            { urls: ["<all_urls>"] },
            ["requestHeaders"]
          );
        }

        // Active trigger: simulate user click/play after 1.5 seconds if tab is waiting for interaction
        const triggerTimer = setTimeout(() => {
          if (resolved) return;
          if (browserAPI.tabs.executeScript) {
            browserAPI.tabs
              .executeScript(targetTabId, {
                code: `
                  (function() {
                    const selectors = ['video', '.play-button', 'button[aria-label*="Play"]', '.vjs-big-play-button', '#player', 'iframe'];
                    selectors.forEach(sel => {
                      document.querySelectorAll(sel).forEach(el => {
                        try {
                          el.click();
                          if (el.play) el.play();
                        } catch(e) {}
                      });
                    });
                  })();
                `,
              })
              .catch(() => {});
          }
        }, 1500);

        const timerId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            if (fallbackCandidateUrl) {
              resolve({
                status: "FOUND",
                url: fallbackCandidateUrl,
                headers: capturedHeaders,
              });
            } else {
              resolve({ status: "TIMEOUT" });
            }
          }
        }, timeoutMs);
      });
    });
  }

  globalThis.Sniffer = {
    start: startSniffing,
    isPotentialStream,
    isStreamManifestOrMedia,
  };
})();
