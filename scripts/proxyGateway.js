(() => {
  const browserAPI = globalThis.browser || globalThis.chrome;

  const customHeadersMap = new Map();
  const aggregatorTabIds = new Set();

  function registerAggregatorTab(tabId) {
    if (typeof tabId === "number" && tabId >= 0) {
      aggregatorTabIds.add(tabId);
    }
  }

  function unregisterAggregatorTab(tabId) {
    aggregatorTabIds.delete(tabId);
  }

  function isFromAggregator(details) {
    if (!details) return false;
    if (details.tabId && aggregatorTabIds.has(details.tabId)) return true;
    const origin = (details.documentUrl || details.initiator || details.originUrl || "").toLowerCase();
    const isExtension =
      origin.includes("moz-extension://") ||
      origin.includes("super-website") ||
      origin.includes("localhost:5173") ||
      origin.includes("127.0.0.1:5173");
    if (isExtension && details.tabId && details.tabId >= 0) {
      aggregatorTabIds.add(details.tabId);
      return true;
    }
    const urlLower = (details.url || "").toLowerCase();
    if (
      urlLower.includes("cdn.animeonsen.xyz") ||
      urlLower.includes("api.animeonsen.xyz") ||
      urlLower.includes("aniwatchtv.site") ||
      urlLower.includes("megavid.buzz")
    ) {
      return true;
    }
    return isExtension;
  }

  function registerHeaders(url, headers) {
    if (!url || !headers) return;
    customHeadersMap.set(url.toLowerCase(), headers);
  }

  function handleBeforeSendHeaders(details) {
    if (!isFromAggregator(details)) return;

    const requestHeaders = details.requestHeaders || [];
    let modified = false;

    const urlLower = details.url.toLowerCase();
    let matchedHeaders = customHeadersMap.get(urlLower);

    if (!matchedHeaders) {
      for (const [prefix, h] of customHeadersMap.entries()) {
        if (urlLower.startsWith(prefix)) {
          matchedHeaders = h;
          break;
        }
      }
    }

    if (!matchedHeaders) {
      if (urlLower.includes("animeonsen.xyz")) {
        matchedHeaders = {
          Referer: "https://www.animeonsen.xyz/",
          Origin: "https://www.animeonsen.xyz",
        };
      } else if (urlLower.includes("aniwatchtv.site")) {
        matchedHeaders = {
          Referer: "https://megavid.buzz/",
        };
      } else if (urlLower.includes("megavid.buzz")) {
        matchedHeaders = {
          Referer: "https://4anime.com.ro/",
        };
      } else if (urlLower.includes("4anime.com.ro")) {
        matchedHeaders = {
          Referer: "https://4anime.com.ro/",
        };
      }
    }

    if (matchedHeaders) {
      for (const [name, val] of Object.entries(matchedHeaders)) {
        const idx = requestHeaders.findIndex(
          (h) => h.name.toLowerCase() === name.toLowerCase()
        );
        if (idx >= 0) {
          requestHeaders[idx].value = val;
        } else {
          requestHeaders.push({ name, value: val });
        }
        modified = true;
      }
    } else if (details.type === "sub_frame") {
      const refIdx = requestHeaders.findIndex(
        (h) => h.name.toLowerCase() === "referer"
      );
      const hostMatch = details.url.match(/^https?:\/\/([^/]+)/);
      const hostOrigin = hostMatch ? hostMatch[0] : "";
      if (refIdx >= 0) {
        requestHeaders[refIdx].value = hostOrigin ? `${hostOrigin}/` : "https://4anime.com.ro/";
        modified = true;
      } else if (hostOrigin) {
        requestHeaders.push({ name: "Referer", value: `${hostOrigin}/` });
        modified = true;
      }
    }

    if (modified) {
      return { requestHeaders };
    }
  }

  function handleHeadersReceived(details) {
    if (!isFromAggregator(details)) return;

    let responseHeaders = details.responseHeaders || [];
    responseHeaders = responseHeaders.filter(
      (h) =>
        !["x-frame-options", "content-security-policy", "cross-origin-resource-policy"].includes(
          h.name.toLowerCase()
        )
    );

    responseHeaders.push({ name: "Access-Control-Allow-Origin", value: "*" });
    responseHeaders.push({
      name: "Access-Control-Allow-Methods",
      value: "GET, HEAD, POST, OPTIONS",
    });
    responseHeaders.push({
      name: "Access-Control-Allow-Headers",
      value: "*",
    });

    const urlLower = details.url.toLowerCase();
    if (urlLower.includes(".m3u8")) {
      const ctIdx = responseHeaders.findIndex(
        (h) => h.name.toLowerCase() === "content-type"
      );
      if (ctIdx >= 0) {
        responseHeaders[ctIdx].value = "application/vnd.apple.mpegurl";
      } else {
        responseHeaders.push({ name: "Content-Type", value: "application/vnd.apple.mpegurl" });
      }
    } else if (urlLower.includes(".mpd")) {
      const ctIdx = responseHeaders.findIndex(
        (h) => h.name.toLowerCase() === "content-type"
      );
      if (ctIdx >= 0) {
        responseHeaders[ctIdx].value = "application/dash+xml";
      } else {
        responseHeaders.push({ name: "Content-Type", value: "application/dash+xml" });
      }
    }

    return { responseHeaders };
  }

  globalThis.ProxyGateway = {
    isFromAggregator,
    registerHeaders,
    registerAggregatorTab,
    unregisterAggregatorTab,
    handleBeforeSendHeaders,
    handleHeadersReceived,
  };
})();
