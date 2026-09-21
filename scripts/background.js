const browserAPI = globalThis.browser || globalThis.chrome;

let session = {
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

browserAPI.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!session.tabId || details.tabId !== session.tabId || !session.activePhase) return;

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

    session.phases[session.activePhase].push(capturedEntry);

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
  ["requestBody"]
);

browserAPI.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!session.tabId || details.tabId !== session.tabId || !session.activePhase) return;

    const currentList = session.phases[session.activePhase];
    const match = currentList.find((req) => req.requestId === details.requestId);
    if (match) {
      match.requestHeaders = details.requestHeaders || [];
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

browserAPI.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!session.tabId || details.tabId !== session.tabId || !session.activePhase) return;

    const currentList = session.phases[session.activePhase];
    const match = currentList.find((req) => req.requestId === details.requestId);
    if (match) {
      match.statusCode = details.statusCode;
      match.responseHeaders = details.responseHeaders || [];

      const contentTypeHeader = (details.responseHeaders || []).find(
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
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "INIT_SESSION":
      session.tabId = message.tabId;
      session.domain = message.domain;
      session.activePhase = null;
      session.phases = {
        initial_load: [],
        search_typing: [],
        search_submit: [],
        item_select: [],
        episode_select: [],
        server_change: [],
      };
      sendResponse({ status: "SESSION_INITIALIZED" });
      break;

    case "START_PHASE":
      session.activePhase = message.phase;
      sendResponse({ status: "PHASE_STARTED", phase: message.phase });
      break;

    case "STOP_PHASE":
      const currentPhase = session.activePhase;
      session.activePhase = null;
      const count = currentPhase ? session.phases[currentPhase].length : 0;
      sendResponse({ status: "PHASE_STOPPED", count });
      break;

    case "RETRY_PHASE":
      if (message.phase && session.phases[message.phase]) {
        session.phases[message.phase] = [];
      }
      session.activePhase = null;
      sendResponse({ status: "PHASE_RESET" });
      break;

    case "GET_STATUS":
      sendResponse({
        domain: session.domain,
        activePhase: session.activePhase,
        phases: session.phases,
      });
      break;

    case "SAVE_SESSION":
      const storageKey = `recording_${session.domain}`;
      browserAPI.storage.local
        .set({
          [storageKey]: {
            domain: session.domain,
            createdAt: new Date().toISOString(),
            phases: session.phases,
          },
        })
        .then(() => {
          sendResponse({ status: "SAVED", key: storageKey });
        });
      return true;
  }
});
