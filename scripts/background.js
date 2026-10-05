const browserAPI = globalThis.browser || globalThis.chrome;

globalThis.session = {
  tabId: null,
  domain: null,
  activePhase: null,
  phases: {
    initial_load: [],
    search_typing: [],
    search_submit: [],
    item_select: [],
    episode_select: [],
    server_change: [],
  },
};

function isMedia(type, url) {
  if (url.includes(".m3u8")) return false;
  return ["image", "media", "font"].includes(type);
}

function normalizeRequestBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.formData) return requestBody.formData;

  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder("utf-8");
      return requestBody.raw
        .filter((part) => part.bytes)
        .map((part) => decoder.decode(part.bytes))
        .join("");
    } catch (e) {
      return `Got ${e} while decoding, probably [Media]`;
    }
  }

  return null;
}

if (globalThis.AdBlocker) {
  globalThis.AdBlocker.init();
}

browserAPI.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (
      globalThis.AdBlocker &&
      globalThis.ProxyGateway &&
      globalThis.AdBlocker.shouldBlockRequest(details, globalThis.ProxyGateway.isFromAggregator)
    ) {
      return { cancel: true };
    }

    if (!globalThis.session.activePhase) return;

    const isTargetTab = globalThis.session.tabId && details.tabId === globalThis.session.tabId;
    const isTargetDomain = globalThis.session.domain && details.url.includes(globalThis.session.domain);

    if (!isTargetTab && !isTargetDomain) return;

    const isMediaResource = isMedia(details.type, details.url);

    const capturedEntry = {
      requestId: details.requestId,
      url: details.url,
      method: details.method,
      type: details.type,
      timeStamp: details.timeStamp,
      requestBody: normalizeRequestBody(details.requestBody),
      requestHeaders: [],
      statusCode: null,
      responseHeaders: [],
      responseBody: isMediaResource ? `[Media: ${details.type}]` : null,
    };

    globalThis.session.phases[globalThis.session.activePhase].push(capturedEntry);

    if (!isMediaResource && browserAPI.webRequest.filterResponseData) {
      try {
        const filter = browserAPI.webRequest.filterResponseData(details.requestId);
        const decoder = new TextDecoder("utf-8");
        let responseText = "";

        filter.ondata = (event) => {
          filter.write(event.data);
          responseText += decoder.decode(event.data, { stream: true });
        };

        filter.onstop = () => {
          filter.close();
          if (!capturedEntry.responseBody) {
            capturedEntry.responseBody = responseText;
          }
        };

        filter.onerror = () => {
          try {
            filter.close();
          } catch (e) {}
        };
      } catch (err) {}
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestBody"]
);

browserAPI.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    let result;
    if (globalThis.ProxyGateway) {
      result = globalThis.ProxyGateway.handleBeforeSendHeaders(details);
    }

    if (globalThis.session.activePhase) {
      const currentList = globalThis.session.phases[globalThis.session.activePhase];
      if (currentList) {
        const match = currentList.find((req) => req.requestId === details.requestId);
        if (match) {
          match.requestHeaders = (result && result.requestHeaders) || details.requestHeaders || [];
        }
      }
    }

    if (result) {
      return result;
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

browserAPI.webRequest.onHeadersReceived.addListener(
  (details) => {
    let result;
    if (globalThis.ProxyGateway) {
      result = globalThis.ProxyGateway.handleHeadersReceived(details);
    }

    if (globalThis.session.activePhase) {
      const currentList = globalThis.session.phases[globalThis.session.activePhase];
      if (currentList) {
        const match = currentList.find((req) => req.requestId === details.requestId);
        if (match) {
          match.statusCode = details.statusCode;
          match.responseHeaders = (result && result.responseHeaders) || details.responseHeaders || [];

          const contentTypeHeader = match.responseHeaders.find(
            (h) => h.name.toLowerCase() === "content-type"
          );

          if (contentTypeHeader && contentTypeHeader.value) {
            const typeVal = contentTypeHeader.value.toLowerCase();
            const isBinaryMime =
              typeVal.includes("image/") ||
              typeVal.includes("video/") ||
              typeVal.includes("audio/") ||
              typeVal.includes("font/") ||
              typeVal.includes("octet-stream");

            if (isBinaryMime && !match.url.includes(".m3u8")) {
              match.responseBody = `[Media: ${typeVal}]`;
            }
          }
        }
      }
    }

    if (result) {
      return result;
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking", "responseHeaders"]
);

browserAPI.tabs.onCreated.addListener((tab) => {
  if (globalThis.AdBlocker && globalThis.ProxyGateway) {
    globalThis.AdBlocker.handleTabCreated(tab, globalThis.ProxyGateway.isFromAggregator);
  }
});

browserAPI.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (globalThis.AdBlocker && globalThis.ProxyGateway) {
    if (changeInfo.url) {
      globalThis.AdBlocker.handleTabCreated({ id: tabId, url: changeInfo.url }, globalThis.ProxyGateway.isFromAggregator);
    }
  }
});

browserAPI.tabs.onRemoved.addListener((tabId) => {
  if (globalThis.ProxyGateway) {
    globalThis.ProxyGateway.unregisterAggregatorTab(tabId);
  }
});

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender && sender.tab && sender.tab.id && globalThis.ProxyGateway) {
    globalThis.ProxyGateway.registerAggregatorTab(sender.tab.id);
  }

  switch (message.action) {
    case "SYNC_AD_RULES":
      if (globalThis.AdBlocker) {
        globalThis.AdBlocker.sync(message.serverUrl).then((res) => {
          sendResponse(res);
        });
        return true;
      }
      sendResponse({ status: "UNAVAILABLE" });
      break;

    case "GET_INSTALLED_PLUGINS":
      browserAPI.storage.local.get("aggregator_installed_plugins").then((data) => {
        sendResponse(data.aggregator_installed_plugins || {});
      });
      return true;

    case "REGISTER_STREAM_HEADERS":
      if (globalThis.ProxyGateway && message.url && message.headers) {
        globalThis.ProxyGateway.registerHeaders(message.url, message.headers);
        sendResponse({ status: "REGISTERED" });
      } else {
        sendResponse({ status: "ERROR" });
      }
      return true;

    case "STREAM_BACKGROUND_TAB":
      if (globalThis.Sniffer) {
        globalThis.Sniffer.start(message.url).then((res) => {
          sendResponse(res);
        });
        return true;
      }
      sendResponse({ status: "UNAVAILABLE" });
      return true;

    case "START_GOOGLE_AUTH":
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(message.clientId)}&response_type=token&redirect_uri=${encodeURIComponent(message.redirectUrl)}&scope=${message.scope}&prompt=consent`;

      if (browserAPI.identity && browserAPI.identity.launchWebAuthFlow) {
        browserAPI.identity
          .launchWebAuthFlow({
            url: authUrl,
            interactive: true,
          })
          .then(async (responseUrl) => {
            if (responseUrl) {
              const urlObj = new URL(responseUrl);
              let token = "";
              if (urlObj.hash) {
                const hashParams = new URLSearchParams(urlObj.hash.substring(1));
                token = hashParams.get("access_token");
              }
              if (!token && urlObj.search) {
                token = urlObj.searchParams.get("access_token");
              }

              if (token) {
                await browserAPI.storage.local.set({ aggregator_oauth_token: token });
                sendResponse({ status: "SUCCESS", token });
              } else {
                sendResponse({ status: "NO_TOKEN", responseUrl });
              }
            } else {
              sendResponse({ status: "NO_URL" });
            }
          })
          .catch((err) => {
            sendResponse({ status: "ERROR", message: err.message });
          });
        return true;
      }
      sendResponse({ status: "UNAVAILABLE" });
      return true;

    case "INIT_SESSION":
      globalThis.session.tabId = message.tabId;
      globalThis.session.domain = message.domain;
      globalThis.session.activePhase = null;
      globalThis.session.phases = {
        initial_load: [],
        search_typing: [],
        search_submit: [],
        item_select: [],
        episode_select: [],
        server_change: [],
      };
      sendResponse({ status: "SESSION_INITIALIZED" });
      return true;

    case "START_PHASE":
      if (message.tabId !== undefined && message.tabId !== null) {
        globalThis.session.tabId = message.tabId;
      }
      if (message.domain) globalThis.session.domain = message.domain;
      globalThis.session.activePhase = message.phase;
      sendResponse({ status: "PHASE_STARTED", phase: message.phase });
      return true;

    case "STOP_PHASE":
      const currentPhase = globalThis.session.activePhase;
      globalThis.session.activePhase = null;
      const count = currentPhase && globalThis.session.phases[currentPhase] ? globalThis.session.phases[currentPhase].length : 0;
      sendResponse({ status: "PHASE_STOPPED", count });
      return true;

    case "RETRY_PHASE":
      if (message.phase && globalThis.session.phases[message.phase]) {
        globalThis.session.phases[message.phase] = [];
      }
      globalThis.session.activePhase = null;
      sendResponse({ status: "PHASE_RESET" });
      return true;

    case "GET_STATUS":
      sendResponse({
        domain: globalThis.session.domain,
        activePhase: globalThis.session.activePhase,
        phases: globalThis.session.phases,
      });
      return true;

    case "SAVE_SESSION":
      const storageKey = `recording_${globalThis.session.domain}`;
      browserAPI.storage.local
        .set({
          [storageKey]: {
            domain: globalThis.session.domain,
            createdAt: new Date().toISOString(),
            phases: globalThis.session.phases,
          },
        })
        .then(() => {
          sendResponse({ status: "SAVED", key: storageKey });
        });
      return true;
  }
});
