(() => {
  const browserAPI = globalThis.browser || globalThis.chrome;
  const DEFAULT_REGISTRY_URL = "https://aggregator-registry.mishravaibhav2048.workers.dev";

  const defaultAdList = [
    "teniacites.com",
    "histats.com",
    "popads",
    "adcash",
    "propellerads",
    "adsterra",
    "onclickprediction",
    "trafficjunky",
    "exoclick",
    "juicyads",
    "clickadu",
    "monetag",
    "richpush",
    "yadro.ru",
    "deloton.com",
    "alwingulla.com",
    "highperformancegate.com",
    "bidgear.com",
    "syndication.exdynsrv.com",
    "ad-delivery.net",
    "doubleclick.net",
    "google-analytics.com",
    "scorecardresearch.com",
    "adnxs.com",
    "criteo.com",
    "taboola.com",
    "outbrain.com",
    "mgid.com",
    "rtmark.net",
    "videomega.tv",
    "streamtape.com/ad",
  ];

  let activeDomains = new Set(defaultAdList);

  function normalizeDomain(d) {
    if (!d || typeof d !== "string") return "";
    return d.trim().toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "")
      .replace(/^\|+/, "")
      .replace(/\^+$/, "");
  }

  async function initAdBlocker() {
    try {
      const data = await browserAPI.storage.local.get(["aggregator_ad_domains", "aggregator_registry_url"]);
      if (data && Array.isArray(data.aggregator_ad_domains) && data.aggregator_ad_domains.length > 0) {
        activeDomains = new Set(data.aggregator_ad_domains.map(normalizeDomain).filter(Boolean));
      } else {
        await browserAPI.storage.local.set({ aggregator_ad_domains: defaultAdList });
      }

      // Automatically query backend in background to refresh local cache
      const serverUrl = data.aggregator_registry_url || DEFAULT_REGISTRY_URL;
      syncAdRules(serverUrl).catch(() => {});
    } catch (err) {
      activeDomains = new Set(defaultAdList);
    }
  }

  async function syncAdRules(serverUrl) {
    const baseUrl = (serverUrl || DEFAULT_REGISTRY_URL).replace(/\/+$/, "");
    const target = baseUrl.includes("/api/v1/adblock/rules") ? baseUrl : `${baseUrl}/api/v1/adblock/rules`;

    try {
      const res = await fetch(target, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data) ? data : (Array.isArray(data.rules) ? data.rules : []);
        if (rawList.length > 0) {
          const cleaned = Array.from(new Set([
            ...defaultAdList,
            ...rawList.map(normalizeDomain).filter(Boolean),
          ]));
          activeDomains = new Set(cleaned);
          await browserAPI.storage.local.set({
            aggregator_ad_domains: cleaned,
            aggregator_ad_synced_at: Date.now(),
          });
          return { status: "SYNCED", count: cleaned.length };
        }
      }
    } catch (err) {}

    try {
      const data = await browserAPI.storage.local.get("aggregator_ad_domains");
      if (data && Array.isArray(data.aggregator_ad_domains) && data.aggregator_ad_domains.length > 0) {
        activeDomains = new Set(data.aggregator_ad_domains.map(normalizeDomain).filter(Boolean));
        return { status: "CACHED", count: activeDomains.size };
      }
    } catch (err) {}

    activeDomains = new Set(defaultAdList);
    return { status: "FALLBACK", count: defaultAdList.length };
  }

  async function addDomains(domains) {
    if (!Array.isArray(domains) || domains.length === 0) return 0;
    let addedCount = 0;
    for (const d of domains) {
      const norm = normalizeDomain(d);
      if (norm && norm.includes(".") && !activeDomains.has(norm)) {
        activeDomains.add(norm);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      const list = Array.from(activeDomains);
      await browserAPI.storage.local.set({ aggregator_ad_domains: list }).catch(() => {});
    }
    return addedCount;
  }

  async function reportToBackend(domains, registryUrl) {
    if (!Array.isArray(domains) || domains.length === 0) return { status: "EMPTY" };
    const cleaned = domains.map(normalizeDomain).filter((d) => d && d.includes("."));
    if (cleaned.length === 0) return { status: "EMPTY" };

    // 1. Immediately cache locally
    await addDomains(cleaned);

    // 2. Submit to backend registry
    const baseUrl = (registryUrl || DEFAULT_REGISTRY_URL).replace(/\/+$/, "");
    const endpoint = `${baseUrl}/api/v1/adblock/report`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: cleaned }),
      });
      if (res.ok) {
        const data = await res.json();
        return { status: "SUBMITTED", added: data.added || 0, total: data.total || activeDomains.size };
      }
    } catch (err) {}

    return { status: "LOCAL_ONLY", count: cleaned.length };
  }

  function isAdUrl(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    for (const domain of activeDomains) {
      if (u.includes(domain)) return true;
    }
    return false;
  }

  function shouldBlockRequest(details, isFromAggregator) {
    if (!isFromAggregator(details)) return false;
    return isAdUrl(details.url);
  }

  function handleTabCreated(tab, isFromAggregator) {
    const targetUrl = (tab.url || tab.pendingUrl || "").toLowerCase();
    if (targetUrl && isAdUrl(targetUrl)) {
      browserAPI.tabs.remove(tab.id).catch(() => {});
    }
  }

  globalThis.AdBlocker = {
    init: initAdBlocker,
    sync: syncAdRules,
    addDomains,
    reportToBackend,
    isAdUrl,
    shouldBlockRequest,
    handleTabCreated,
  };
})();
